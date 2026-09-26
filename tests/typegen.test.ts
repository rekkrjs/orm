import { expect, test, describe, beforeAll, afterAll, readText, writeText } from "./harness.js";
import { mkdir, readdir, rm, writeFile } from "fs/promises";
import { join, relative } from "path";
import { Migrator, Schema, TypeGenerator, TypeMapper, discoverModelTables } from "../src/index.js";
import { makeTypesGenerateCommand } from "../src/cli/TypesGenerateCommand.js";
import type { OrmConfig } from "../src/config/OrmConfig.js";
import { setupTestDb } from "./helpers.js";

const OUT_DIR = join(process.cwd(), "tests", "temp_types");
const DECL_OUT_DIR = join(process.cwd(), "tests", "temp_type_declarations");
const MODEL_ROOT_A = join(process.cwd(), "tests", "temp_models_a");
const MODEL_ROOT_B = join(process.cwd(), "tests", "temp_models_b");
const MODEL_DISCOVERY_DIR = join(process.cwd(), "tests", "temp_model_discovery");
const DATE_CAST_MODEL_DIR = join(process.cwd(), "tests", "temp_date_cast_models");
const MODEL_LOWERCASE_DIR = join(process.cwd(), "tests", "temp_model_lowercase");
const TSCONFIG_JSONC_DIR = join(process.cwd(), "tests", "temp_tsconfig_jsonc");

describe("TypeGenerator", () => {
  let connection: ReturnType<typeof setupTestDb>;

  beforeAll(async () => {
    connection = setupTestDb();
    await Schema.create("users", (table) => {
      table.increments("id");
      table.string("name");
      table.string("email").nullable();
      table.boolean("active").default(true);
      table.integer("login_count").default(0);
      table.json("metadata").nullable();
      table.timestamps();
      table.timestamp("deleted_at").nullable();
    });
    await Schema.create("blog_posts", (table) => {
      table.increments("id");
      table.string("title");
      table.timestamps();
    });
  });

  afterAll(async () => {
    for (const dir of [OUT_DIR, DECL_OUT_DIR, MODEL_ROOT_A, MODEL_ROOT_B, MODEL_DISCOVERY_DIR, DATE_CAST_MODEL_DIR, MODEL_LOWERCASE_DIR, TSCONFIG_JSONC_DIR]) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("generates interfaces and stubs from database schema", async () => {
    const generator = new TypeGenerator(connection, { outDir: OUT_DIR, stubs: true });
    await generator.generate();

    const files = await readdir(OUT_DIR);
    expect(files).toContain("users.ts");
    expect(files).toContain("index.ts");

    const content = await readText(join(OUT_DIR, "users.ts"));
    expect(content).toContain("export interface UsersAttributes {");
    expect(content).toContain("id: number;");
    expect(content).toContain("name: string;");
    expect(content).toContain("email?: string | null;");
    // SQLite stores boolean as INTEGER
    expect(content).toContain("active: number;");
    expect(content).toContain("login_count: number;");
    // SQLite stores JSON as TEXT
    expect(content).toContain("metadata?: string | null;");
    // Timestamp columns decode to Date at runtime, so the generated types say
    // Date. The stub below extends Model, which has timestamps on by default.
    expect(content).toContain("created_at?: Date | null;");
    expect(content).toContain("updated_at?: Date | null;");
    expect(content).toContain("deleted_at?: string | null;");
    expect(content).toContain("get created_at(): Date | null | undefined {");

    // Stubs
    expect(content).toContain("export class UsersBase extends Model<UsersAttributes> {");
    expect(content).toContain('static override table = "users";');
    expect(content).toContain("get id(): number {");
    expect(content).toContain("set id(value: number) {");
  });

  test("generates declaration files that augment existing models", async () => {
    const generator = new TypeGenerator(connection, {
      outDir: DECL_OUT_DIR,
      declarations: true,
      modelDeclarations: {
        users: {
          path: "../models/User",
          className: "User",
        },
      },
    });
    await generator.generate();

    const files = await readdir(DECL_OUT_DIR);
    expect(files).toContain("users.d.ts");
    expect(files).toContain("index.d.ts");

    const content = await readText(join(DECL_OUT_DIR, "users.d.ts"));
    expect(content).toContain("export interface UsersAttributes {");
    expect(content).not.toContain("extends Model");
    expect(content).toContain('declare module "../models/User" {');
    expect(content).toContain("interface User extends UsersAttributes {");
    expect(content).toContain("getAttribute<K extends keyof UsersAttributes>");
    expect(content).toContain("name: string;");
    // Without a discovered model, declarations cannot assume its timestamp or
    // soft-delete configuration. Keep the SQLite driver's raw type.
    expect(content).toContain("created_at?: string | null;");
    expect(content).toContain("updated_at?: string | null;");
    expect(content).toContain("deleted_at?: string | null;");
  });

  test("uses effective read casts rather than driver date columns", async () => {
    await Schema.create("typegen_cast_records", (table) => {
      table.increments("id");
      table.timestamp("created_at").nullable();
      table.timestamp("updated_at").nullable();
      table.timestamp("deleted_at").nullable();
      table.timestamp("stored_timestamp").nullable();
      table.timestamp("decoded_datetime").nullable();
    });
    await mkdir(DATE_CAST_MODEL_DIR, { recursive: true });
    await writeText(
      join(DATE_CAST_MODEL_DIR, "DateCastRecord.ts"),
      `import { Model } from "../../src/index.js";
export class DateCastRecord extends Model {
  static table = "typegen_cast_records";
  static casts = {
    created_at: "string",
    stored_timestamp: "timestamp",
    decoded_datetime: "datetime",
  };
}
`,
    );

    const generator = new TypeGenerator(connection, {
      outDir: join(DATE_CAST_MODEL_DIR, "types"),
      declarations: true,
      modelDirectories: [DATE_CAST_MODEL_DIR],
      allowedTables: ["typegen_cast_records"],
    });
    await generator.generate();

    const content = await readText(join(DATE_CAST_MODEL_DIR, "types", "typegen_cast_records.d.ts"));
    expect(content).toContain("created_at?: string | null;");
    expect(content).toContain("updated_at?: Date | null;");
    expect(content).toContain("deleted_at?: string | null;");
    expect(content).toContain("stored_timestamp?: Date | null;");
    expect(content).toContain("decoded_datetime?: Date | null;");
  });

  // A soft-deleting model reads deleted_at as a Date on every driver, as its
  // timestamps are; a model without soft deletes gets the driver's raw type.
  test("types deleted_at as a Date only on a soft-deleting model", async () => {
    for (const table of ["typegen_soft_records", "typegen_hard_records"]) {
      await Schema.create(table, (t) => {
        t.increments("id");
        t.timestamps();
        t.timestamp("deleted_at").nullable();
      });
    }
    const dir = join(DATE_CAST_MODEL_DIR, "soft");
    await mkdir(dir, { recursive: true });
    await writeText(
      join(dir, "SoftRecord.ts"),
      `import { Model } from "../../../src/index.js";
export class SoftRecord extends Model {
  static table = "typegen_soft_records";
  static softDeletes = true;
}
export class HardRecord extends Model {
  static table = "typegen_hard_records";
}
`,
    );

    await new TypeGenerator(connection, {
      outDir: join(dir, "types"),
      declarations: true,
      modelDirectories: [dir],
      allowedTables: ["typegen_soft_records", "typegen_hard_records"],
    }).generate();

    const soft = await readText(join(dir, "types", "typegen_soft_records.d.ts"));
    expect(soft).toContain("deleted_at?: Date | null;");
    expect(soft).toContain("created_at?: Date | null;");
    expect(soft).not.toContain("deleted_at?: string");
    const hard = await readText(join(dir, "types", "typegen_hard_records.d.ts"));
    expect(hard).toContain("deleted_at?: string | null;");
    expect(hard).toContain("created_at?: Date | null;");

    // The generated types must describe what the same models read back.
    const { SoftRecord, HardRecord } = await import(join(dir, "SoftRecord.ts"));
    const deletedAt = new Date("2024-02-29T23:59:58.123Z");
    for (const model of [SoftRecord, HardRecord]) await model.query().insert({ deleted_at: deletedAt });
    const softRow = await SoftRecord.withTrashed().firstOrFail();
    expect(softRow.getAttribute("deleted_at")).toEqual(deletedAt);
    expect(softRow.getAttribute("created_at")).toBeNull();
    const hardRow = await HardRecord.firstOrFail();
    expect(typeof hardRow.getAttribute("deleted_at")).toBe("string");
  });

  // TypeScript cannot merge a `declare module` interface into a default
  // export, so the generated file would type nothing. Say so, from every entry
  // point that generates declarations.
  test("warns about a model exported only as default, from the generator, the command and migrations", async () => {
    for (const table of ["typegen_gadgets", "typegen_widgets", "typegen_tools"]) {
      await Schema.create(table, (t) => { t.increments("id"); t.string("name"); });
    }
    const dir = join(DATE_CAST_MODEL_DIR, "exports");
    await mkdir(dir, { recursive: true });
    const orm = `import { Model } from "../../../src/index.js";`;
    await writeText(join(dir, "Gadget.ts"), `${orm}\nexport default class Gadget extends Model { static table = "typegen_gadgets"; }\n`);
    await writeText(join(dir, "Widget.ts"), `${orm}\nexport class Widget extends Model { static table = "typegen_widgets"; }\n`);
    await writeText(join(dir, "Tool.ts"), `${orm}\nexport class Tool extends Model { static table = "typegen_tools"; }\nexport default Tool;\n`);
    const expected = [
      `Gadget in ${relative(process.cwd(), join(dir, "Gadget.ts"))} is a default export, so the types generated ` +
        `for "typegen_gadgets" do not apply to it: TypeScript merges them only into a named export. ` +
        "Export it as `export class Gadget`.",
    ];
    const allowedTables = ["typegen_gadgets", "typegen_widgets", "typegen_tools"];

    const warnings: string[] = [];
    await new TypeGenerator(connection, {
      outDir: join(dir, "types"), declarations: true, modelDirectories: [dir], allowedTables,
      warn: (message) => warnings.push(message),
    }).generate();
    expect(warnings).toEqual(expected);
    for (const table of allowedTables) {
      expect(await readText(join(dir, "types", `${table}.d.ts`))).toContain("name: string;");
    }

    // A table the config maps by hand declares whatever the config names.
    warnings.length = 0;
    await new TypeGenerator(connection, {
      outDir: join(dir, "types"), declarations: true, modelDirectories: [dir], allowedTables,
      modelDeclarations: { typegen_gadgets: { path: "$models/Gadgets", className: "Gadget" } },
      warn: (message) => warnings.push(message),
    }).generate();
    expect(warnings).toEqual([]);

    // A plain modelsPath, the default single-database config, must discover its models.
    await rm(join(dir, "types"), { recursive: true, force: true });
    const CommandClass = makeTypesGenerateCommand({ modelsPath: dir } as unknown as OrmConfig, connection) as any;
    const command = new CommandClass();
    command._parsedArgs = {};
    command._parsedOptions = {};
    const commandWarnings: string[] = [];
    command.warn = (message: string) => commandWarnings.push(message);
    command.info = () => {};
    await command.handle();
    expect(commandWarnings).toEqual(expected);
    for (const table of allowedTables) {
      expect(await readText(join(dir, "types", `${table}.d.ts`))).toContain("name: string;");
    }

    // Migrations regenerate types only after applying one.
    const migrations = join(DATE_CAST_MODEL_DIR, "export_migrations");
    await mkdir(migrations, { recursive: true });
    await writeText(
      join(migrations, "20260101000000_noop.ts"),
      `import { Migration } from "../../../src/index.js";\nexport default class Noop extends Migration { async up() {} async down() {} }\n`,
    );
    try {
      const migratorWarnings: string[] = [];
      const migrator = new Migrator(connection, migrations, { modelDirectories: [dir] }, {
        output: () => {},
        warn: (line) => migratorWarnings.push(line),
      });
      await migrator.run();
      expect(migratorWarnings).toEqual(expected);
    } finally {
      await rm(migrations, { recursive: true, force: true });
    }
  });

  test("generates convention-based declaration mappings", async () => {
    const conventionDir = join(process.cwd(), "tests", "temp_convention_types");
    const generator = new TypeGenerator(connection, {
      outDir: conventionDir,
      declarations: true,
      modelImportPrefix: "../models",
    });
    await generator.generate();

    const userContent = await readText(join(conventionDir, "users.d.ts"));
    expect(userContent).toContain('declare module "../models/User" {');
    expect(userContent).toContain("interface User extends UsersAttributes {");
    expect(userContent).toContain("name: string;");

    const postContent = await readText(join(conventionDir, "blog_posts.d.ts"));
    expect(postContent).toContain('declare module "../models/BlogPost" {');
    expect(postContent).toContain("interface BlogPost extends BlogPostsAttributes {");
    expect(postContent).toContain("title: string;");

    await rm(conventionDir, { recursive: true, force: true });
  });

  test("generates declarations into a types folder beside each model root", async () => {
    await Schema.create("team_members", (table) => {
      table.increments("id");
      table.string("name");
    });

    const generator = new TypeGenerator(connection, {
      outDir: join(MODEL_ROOT_A, "types"),
      declarations: true,
      modelDirectories: [MODEL_ROOT_A, MODEL_ROOT_B],
    });
    await generator.generate();

    const filesA = await readdir(join(MODEL_ROOT_A, "types"));
    const filesB = await readdir(join(MODEL_ROOT_B, "types"));
    expect(filesA).toContain("team_members.d.ts");
    expect(filesB).toContain("team_members.d.ts");

    const content = await readText(join(MODEL_ROOT_A, "types", "team_members.d.ts"));
    expect(content).toContain('declare module "../TeamMember" {');
  });

  test("allowedTables filters generated types to only matching tables", async () => {
    const filteredDir = join(process.cwd(), "tests", "temp_filtered_types");
    const generator = new TypeGenerator(connection, {
      outDir: filteredDir,
      stubs: true,
      allowedTables: ["users"],
    });
    await generator.generate();

    const files = await readdir(filteredDir);
    expect(files).toContain("users.ts");
    expect(files).toContain("index.ts");
    expect(files).not.toContain("blog_posts.ts");
    expect(files).not.toContain("team_members.ts");

    const indexContent = await readText(join(filteredDir, "index.ts"));
    expect(indexContent).toContain("users");
    expect(indexContent).not.toContain("blog_posts");
    expect(indexContent).not.toContain("team_members");

    await rm(filteredDir, { recursive: true, force: true });
  });

  test("discoverModelTables extracts table names from model files", async () => {
    await mkdir(MODEL_DISCOVERY_DIR, { recursive: true });

    await writeText(
      join(MODEL_DISCOVERY_DIR, "User.ts"),
      `import { Model } from "../../src/index.js";\nexport class User extends Model {\n  static table = "custom_users";\n}\n`
    );
    await writeText(
      join(MODEL_DISCOVERY_DIR, "Post.ts"),
      `import { Model } from "../../src/index.js";\nexport class Post extends Model {}\n`
    );
    await writeText(
      join(MODEL_DISCOVERY_DIR, "Comment.ts"),
      `import { Model } from "../../src/index.js";\nexport default class Comment extends Model {\n  static table = "comments";\n}\n`
    );
    await writeText(
      join(MODEL_DISCOVERY_DIR, "helper.ts"),
      `export function helper() { return 1; }\n`
    );

    const tables = await discoverModelTables([MODEL_DISCOVERY_DIR]);
    expect(tables).toContain("custom_users");
    expect(tables).toContain("posts");
    expect(tables).toContain("comments");
    expect(tables).not.toContain("helpers");
  });

  test("uses actual model file path in declare module when model file exists", async () => {
    await Schema.create("tenants", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });

    await mkdir(MODEL_LOWERCASE_DIR, { recursive: true });
    await writeText(
      join(MODEL_LOWERCASE_DIR, "tenant.ts"),
      `import { Model } from "../../src/index.js";\nexport default class Tenant extends Model {\n  static table = "tenants";\n}\n`
    );

    const generator = new TypeGenerator(connection, {
      outDir: join(MODEL_LOWERCASE_DIR, "types"),
      declarations: true,
      modelDirectories: [MODEL_LOWERCASE_DIR],
    });
    await generator.generate();

    const content = await readText(join(MODEL_LOWERCASE_DIR, "types", "tenants.d.ts"));
    expect(content).toContain('declare module "../tenant" {');
    expect(content).toContain("interface Tenant extends TenantsAttributes {");
    expect(content).toContain("name: string;");
    expect(content).not.toContain('declare module "../Tenant" {');
  });

  test("uses alias prefix with subdirectory path for discovered models", async () => {
    const aliasDir = join(process.cwd(), "tests", "temp_alias_types");
    const modelRoot = join(process.cwd(), "tests", "temp_alias_models");
    await mkdir(join(modelRoot, "landlord"), { recursive: true });

    await writeText(
      join(modelRoot, "landlord", "tenant.ts"),
      `import { Model } from "../../../src/index.js";\nexport class Tenant extends Model {\n  static table = "tenants";\n}\n`
    );

    const generator = new TypeGenerator(connection, {
      outDir: join(modelRoot, "types"),
      declarations: true,
      modelDirectories: [modelRoot],
      modelImportPrefix: "$models",
    });
    await generator.generate();

    const content = await readText(join(modelRoot, "types", "tenants.d.ts"));
    expect(content).toContain('declare module "$models/landlord/tenant" {');
    expect(content).toContain("interface Tenant extends TenantsAttributes {");

    await rm(aliasDir, { recursive: true, force: true });
    await rm(modelRoot, { recursive: true, force: true });
  });

  test("reads commented tsconfig aliases with Bun.JSONC", async () => {
    const modelRoot = join(TSCONFIG_JSONC_DIR, "models");
    await mkdir(modelRoot, { recursive: true });
    await writeText(
      join(modelRoot, "User.ts"),
      `import { Model } from "../../../src/index.js";\nexport class User extends Model {\n  static table = "users";\n}\n`
    );
    await writeText(
      join(TSCONFIG_JSONC_DIR, "tsconfig.json"),
      `{
        // TypeScript config files allow comments and trailing commas.
        "compilerOptions": {
          "baseUrl": ".",
          "paths": { "$models/*": ["models/*"], },
        },
      }`
    );

    const generator = new TypeGenerator(connection, {
      outDir: join(TSCONFIG_JSONC_DIR, "types"),
      declarations: true,
      modelDirectories: [modelRoot],
      allowedTables: ["users"],
      tsconfigPath: join(TSCONFIG_JSONC_DIR, "tsconfig.json"),
    });
    await generator.generate();

    const content = await readText(join(modelRoot, "types", "users.d.ts"));
    expect(content).toContain('declare module "$models/User" {');
  });

  test("generate returns the list of generated tables", async () => {
    const returnDir = join(process.cwd(), "tests", "temp_return_types");
    const generator = new TypeGenerator(connection, {
      outDir: returnDir,
      declarations: true,
      allowedTables: ["users"],
    });
    const tables = await generator.generate();
    expect(tables).toContain("users");
    expect(tables).not.toContain("blog_posts");
    await rm(returnDir, { recursive: true, force: true });
  });

  test("skipIndex prevents writing the index file", async () => {
    const skipDir = join(process.cwd(), "tests", "temp_skip_index");
    const generator = new TypeGenerator(connection, {
      outDir: skipDir,
      declarations: true,
      allowedTables: ["users"],
      skipIndex: true,
    });
    await generator.generate();
    const files = await readdir(skipDir);
    expect(files).toContain("users.d.ts");
    expect(files).not.toContain("index.d.ts");
    await rm(skipDir, { recursive: true, force: true });
  });

  test("generates combined types from separate model roots with skipIndex", async () => {
    const combinedDir = join(process.cwd(), "tests", "temp_combined_types");
    await mkdir(combinedDir, { recursive: true });

    // Generate landlord-like tables (users, blog_posts already exist)
    const landlordGenerator = new TypeGenerator(connection, {
      outDir: combinedDir,
      declarations: true,
      allowedTables: ["users"],
      skipIndex: true,
    });
    const landlordTables = await landlordGenerator.generate();

    // Generate tenant-like tables (team_members already exists)
    const tenantGenerator = new TypeGenerator(connection, {
      outDir: combinedDir,
      declarations: true,
      allowedTables: ["team_members"],
      skipIndex: true,
    });
    const tenantTables = await tenantGenerator.generate();

    // Verify both files exist
    const files = await readdir(combinedDir);
    expect(files).toContain("users.d.ts");
    expect(files).toContain("team_members.d.ts");
    expect(files).not.toContain("index.d.ts");

    // Write combined index
    const allTables = [...new Set([...landlordTables, ...tenantTables])];
    const indexLines = allTables.map((table) => {
      const className = table
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join("");
      return `export * from "./${className.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "")}";`;
    });
    await writeFile(join(combinedDir, "index.ts"), indexLines.join("\n") + "\n", "utf-8");

    const indexContent = await readText(join(combinedDir, "index.ts"));
    expect(indexContent).toContain("users");
    expect(indexContent).toContain("team_members");

    await rm(combinedDir, { recursive: true, force: true });
  });
});

describe("TypeMapper MySQL contracts", () => {
  test("reflects Bun's exact numeric, native JSON, date, and boolean representations", () => {
    expect(TypeMapper.sqlToTsType("bigint unsigned", false, "mysql")).toBe("number | string");
    expect(TypeMapper.sqlToTsType("bigint", false, "mysql", true)).toBe("number | bigint");
    expect(TypeMapper.sqlToTsType("decimal(30,10)", false, "mysql")).toBe("string");
    expect(TypeMapper.sqlToTsType("json", true, "mysql")).toBe("any");
    expect(TypeMapper.sqlToTsType("datetime", true, "mysql")).toBe("Date | null");
    expect(TypeMapper.sqlToTsType("tinyint(1)", false, "mysql")).toBe("number");
  });
});

describe("TypeMapper PostgreSQL contracts", () => {
  test("reflects Bun's exact numeric, native JSON, date, and boolean representations", () => {
    expect(TypeMapper.sqlToTsType("bigint", false, "postgres")).toBe("string");
    expect(TypeMapper.sqlToTsType("bigint", false, "postgres", true)).toBe("bigint");
    expect(TypeMapper.sqlToTsType("numeric", true, "postgres")).toBe("string | null");
    expect(TypeMapper.sqlToTsType("jsonb", true, "postgres")).toBe("any");
    expect(TypeMapper.sqlToTsType("timestamp without time zone", true, "postgres")).toBe("Date | null");
    expect(TypeMapper.sqlToTsType("boolean", false, "postgres")).toBe("boolean");
  });
});
