import { expect, test, describe } from "bun:test";
import { Connection, Model, Schema } from "../src/index.js";
import { Blueprint } from "../src/schema/Blueprint.js";
import { SQLiteGrammar } from "../src/schema/grammars/SQLiteGrammar.js";
import { MySqlGrammar } from "../src/schema/grammars/MySqlGrammar.js";
import { PostgresGrammar } from "../src/schema/grammars/PostgresGrammar.js";
import { SchemaResult } from "../src/model/ModelSchemaBuilder.js";
import { setupTestDb, teardownTestDb } from "./helpers.js";

describe("Schema Builder", () => {
  let connection: Connection;

  test("sqlite grammar compileCreate", () => {
    const grammar = new SQLiteGrammar();
    const blueprint = new Blueprint("users");
    blueprint.increments("id");
    blueprint.string("name");
    blueprint.timestamps();
    const sql = grammar.compileCreate(blueprint, "users");
    expect(sql).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(sql).toContain('"name" TEXT NOT NULL');
    expect(sql).toContain('"created_at" TEXT');
  });

  test("nullable accepts an explicit boolean", () => {
    const blueprint = new Blueprint("users");
    blueprint.string("required_by_default");
    blueprint.string("optional").nullable();
    blueprint.string("required_explicitly").nullable(false);

    expect(blueprint.columns.map((column) => column.nullable)).toEqual([false, true, false]);
  });

  test("timestamps supports default or custom column pairs", () => {
    const defaults = new Blueprint("default_timestamps");
    defaults.timestamps();
    expect(defaults.columns.map((column) => column.name)).toEqual(["created_at", "updated_at"]);

    const custom = new Blueprint("custom_timestamps");
    custom.timestamps("createdAt", "updatedAt");
    expect(custom.columns.map((column) => column.name)).toEqual(["createdAt", "updatedAt"]);
  });

  test("temporal columns accept precision from zero through six", () => {
    const blueprint = new Blueprint("temporal_precision");
    blueprint.dateTime("happened_at", 3);
    blueprint.timestamp("published_at", 0);
    blueprint.time("opens_at", 6);
    blueprint.timestamps({ precision: 3 });
    blueprint.softDeletes("removed_at", { precision: 3 });

    expect(blueprint.columns.map(({ name, precision }) => ({ name, precision }))).toEqual([
      { name: "happened_at", precision: 3 },
      { name: "published_at", precision: 0 },
      { name: "opens_at", precision: 6 },
      { name: "created_at", precision: 3 },
      { name: "updated_at", precision: 3 },
      { name: "removed_at", precision: 3 },
    ]);

    const mysql = new MySqlGrammar().compileCreate(blueprint, "temporal_precision");
    expect(mysql).toContain("`happened_at` DATETIME(3)");
    expect(mysql).toContain("`published_at` TIMESTAMP(0)");
    expect(mysql).toContain("`opens_at` TIME(6)");

    const postgres = new PostgresGrammar().compileCreate(blueprint, "temporal_precision");
    expect(postgres).toContain('"happened_at" TIMESTAMP(3) WITHOUT TIME ZONE');
    expect(postgres).toContain('"published_at" TIMESTAMP(0) WITHOUT TIME ZONE');
    expect(postgres).toContain('"opens_at" TIME(6) WITHOUT TIME ZONE');

    const sqlite = new SQLiteGrammar().compileCreate(blueprint, "temporal_precision");
    expect(sqlite).toContain('"happened_at" TEXT');
    expect(sqlite).not.toContain("(3)");
  });

  test("temporal precision rejects values unsupported by MySQL and PostgreSQL", () => {
    for (const precision of [-1, 7, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new Blueprint("events").dateTime("happened_at", precision))
        .toThrow("Temporal precision must be an integer between 0 and 6.");
    }
  });

  test("temporal DDL without precision is byte-identical to the previous output", () => {
    const blueprint = new Blueprint("temporal_columns");
    blueprint.dateTime("happened_at");
    blueprint.timestamp("published_at");
    blueprint.time("opens_at");
    blueprint.timestamps();
    blueprint.softDeletes();

    expect(new SQLiteGrammar().compileCreate(blueprint, "temporal_columns")).toBe(
      'CREATE TABLE "temporal_columns" (\n' +
      '    "happened_at" TEXT NOT NULL,\n' +
      '    "published_at" TEXT NOT NULL,\n' +
      '    "opens_at" TEXT NOT NULL,\n' +
      '    "created_at" TEXT,\n' +
      '    "updated_at" TEXT,\n' +
      '    "deleted_at" TEXT\n' +
      ')',
    );
    expect(new MySqlGrammar().compileCreate(blueprint, "temporal_columns")).toBe(
      'CREATE TABLE `temporal_columns` (\n' +
      '    `happened_at` DATETIME NOT NULL,\n' +
      '    `published_at` TIMESTAMP NOT NULL,\n' +
      '    `opens_at` TIME NOT NULL,\n' +
      '    `created_at` TIMESTAMP,\n' +
      '    `updated_at` TIMESTAMP,\n' +
      '    `deleted_at` TIMESTAMP\n' +
      ')',
    );
    expect(new PostgresGrammar().compileCreate(blueprint, "temporal_columns")).toBe(
      'CREATE TABLE "temporal_columns" (\n' +
      '    "happened_at" TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,\n' +
      '    "published_at" TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,\n' +
      '    "opens_at" TIME(0) WITHOUT TIME ZONE NOT NULL,\n' +
      '    "created_at" TIMESTAMP(0) WITHOUT TIME ZONE,\n' +
      '    "updated_at" TIMESTAMP(0) WITHOUT TIME ZONE,\n' +
      '    "deleted_at" TIMESTAMP(0) WITHOUT TIME ZONE\n' +
      ')',
    );
  });

  test("temporal precision survives schema introspection blueprints", () => {
    const column = {
      name: "happened_at",
      primary: false,
      autoIncrement: false,
      nullable: false,
      precision: 3,
    };
    const mysql = new SchemaResult([{ ...column, type: "datetime(3)" }], [], [], "events").blueprint;
    const postgres = new SchemaResult(
      [{ ...column, type: "timestamp without time zone" }],
      [],
      [],
      "events",
    ).blueprint;

    expect(mysql.columns[0]).toMatchObject({ type: "dateTime", precision: 3 });
    expect(postgres.columns[0]).toMatchObject({ type: "dateTime", precision: 3 });
    expect(new MySqlGrammar().compileCreate(mysql, "events")).toContain("`happened_at` DATETIME(3)");
    expect(new PostgresGrammar().compileCreate(postgres, "events"))
      .toContain('"happened_at" TIMESTAMP(3) WITHOUT TIME ZONE');
  });

  test("timestamps rejects invalid runtime arity and names", () => {
    const blueprint = new Blueprint("invalid_timestamps");
    expect(() => (blueprint.timestamps as any)("createdAt")).toThrow(
      "timestamps() expects either zero or two column names.",
    );
    expect(() => (blueprint.timestamps as any)("a", "b", "c")).toThrow(
      "timestamps() expects either zero or two column names.",
    );
    expect(() => (blueprint.timestamps as any)(undefined, undefined)).toThrow(
      "timestamps() created-at column must be a non-empty string.",
    );
    expect(() => blueprint.timestamps("", "updatedAt")).toThrow(
      "timestamps() created-at column must be a non-empty string.",
    );
    expect(() => blueprint.timestamps("changedAt", "changedAt")).toThrow(
      "timestamps() must use different created-at and updated-at columns.",
    );
  });

  test("datetimes mirrors timestamps with DATETIME columns", () => {
    const defaults = new Blueprint("default_datetimes");
    defaults.datetimes();
    defaults.softDeletesDatetime();
    expect(defaults.columns).toEqual([
      expect.objectContaining({ name: "created_at", type: "dateTime", nullable: true }),
      expect.objectContaining({ name: "updated_at", type: "dateTime", nullable: true }),
      expect.objectContaining({ name: "deleted_at", type: "dateTime", nullable: true }),
    ]);

    const precise = new Blueprint("precise_datetimes");
    precise.datetimes("createdAt", "updatedAt", { precision: 3 });
    precise.softDeletesDatetime("removedAt", { precision: 3 });
    expect(precise.columns.map(({ name, type, precision }) => ({ name, type, precision }))).toEqual([
      { name: "createdAt", type: "dateTime", precision: 3 },
      { name: "updatedAt", type: "dateTime", precision: 3 },
      { name: "removedAt", type: "dateTime", precision: 3 },
    ]);
    expect(new MySqlGrammar().compileCreate(precise, "precise_datetimes"))
      .toContain("`createdAt` DATETIME(3)");

    const timestamps = new Blueprint("portable_dates");
    timestamps.timestamps({ precision: 3 });
    const datetimes = new Blueprint("portable_dates");
    datetimes.datetimes({ precision: 3 });
    expect(new SQLiteGrammar().compileCreate(datetimes, "portable_dates"))
      .toBe(new SQLiteGrammar().compileCreate(timestamps, "portable_dates"));
    expect(new PostgresGrammar().compileCreate(datetimes, "portable_dates"))
      .toBe(new PostgresGrammar().compileCreate(timestamps, "portable_dates"));

    datetimes.dropTimestamps();
    expect(datetimes.commands).toEqual([
      { name: "dropColumn", parameters: { column: ["created_at", "updated_at"] } },
    ]);
  });

  test("datetimes keeps timestamp validation semantics", () => {
    const blueprint = new Blueprint("invalid_datetimes");
    expect(() => (blueprint.datetimes as any)("createdAt"))
      .toThrow("datetimes() expects either zero or two column names.");
    expect(() => blueprint.datetimes("", "updatedAt"))
      .toThrow("datetimes() created-at column must be a non-empty string.");
    expect(() => blueprint.datetimes("changedAt", "changedAt"))
      .toThrow("datetimes() must use different created-at and updated-at columns.");
  });

  test("mysql grammar compileCreate", () => {
    const grammar = new MySqlGrammar();
    const blueprint = new Blueprint("users");
    blueprint.increments("id");
    blueprint.string("email").unique();
    blueprint.timestamps();
    const sql = grammar.compileCreate(blueprint, "users");
    expect(sql).toContain("`id` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY");
    expect(sql).toContain("`email` VARCHAR(255) NOT NULL");
    expect(grammar.compileIndexes(blueprint, "users")).toContain(
      "ALTER TABLE `users` ADD UNIQUE INDEX `users_email_unique` (`email`)"
    );
  });

  test("mysql grammar emits JSON defaults as expressions", () => {
    const grammar = new MySqlGrammar();
    const blueprint = new Blueprint("preferences");
    blueprint.json("settings").default({});
    blueprint.json("flags").default("[]");

    const sql = grammar.compileCreate(blueprint, "preferences");
    expect(sql).toContain("`settings` JSON NOT NULL DEFAULT ('{}')");
    expect(sql).toContain("`flags` JSON NOT NULL DEFAULT ('[]')");
  });

  test("sqlite and postgres grammars serialize structured JSON defaults", () => {
    const blueprint = new Blueprint("preferences");
    blueprint.json("settings").default({ theme: "dark" });
    blueprint.jsonb("flags").default(["a", "b"]);

    const sqlite = new SQLiteGrammar().compileCreate(blueprint, "preferences");
    const postgres = new PostgresGrammar().compileCreate(blueprint, "preferences");
    expect(sqlite).toContain(`"settings" TEXT NOT NULL DEFAULT '{"theme":"dark"}'`);
    expect(sqlite).toContain(`"flags" TEXT NOT NULL DEFAULT '["a","b"]'`);
    expect(postgres).toContain(`"settings" JSON NOT NULL DEFAULT '{"theme":"dark"}'`);
    expect(postgres).toContain(`"flags" JSONB NOT NULL DEFAULT '["a","b"]'`);
  });

  test("postgres grammar compileCreate", () => {
    const grammar = new PostgresGrammar();
    const blueprint = new Blueprint("users");
    blueprint.bigIncrements("id");
    blueprint.string("name");
    blueprint.boolean("active").default(false);
    blueprint.timestamps();
    const sql = grammar.compileCreate(blueprint, "users");
    expect(sql).toContain('"id" BIGINT NOT NULL GENERATED ALWAYS AS IDENTITY PRIMARY KEY');
    expect(sql).toContain('"name" VARCHAR(255) NOT NULL');
    expect(sql).toContain('"active" BOOLEAN NOT NULL DEFAULT FALSE');
  });

  test("schema defaults require Schema.raw for SQL expressions", () => {
    const blueprint = new Blueprint("events");
    blueprint.timestamp("literal_default").default("CURRENT_TIMESTAMP");
    blueprint.timestamp("expression_default").default(Schema.raw("CURRENT_TIMESTAMP"));

    const sql = new SQLiteGrammar().compileCreate(blueprint, "events");
    expect(sql).toContain('"literal_default" TEXT NOT NULL DEFAULT \'CURRENT_TIMESTAMP\'');
    expect(sql).toContain('"expression_default" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
  });

  test("useCurrent uses a raw current timestamp default on every grammar", () => {
    const blueprint = new Blueprint("events");
    blueprint.timestamp("published_at").useCurrent();

    for (const grammar of [new SQLiteGrammar(), new MySqlGrammar(), new PostgresGrammar()]) {
      expect(grammar.compileCreate(blueprint, "events")).toContain("DEFAULT CURRENT_TIMESTAMP");
    }
  });

  test("unsigned integer helpers reuse their signed column types", () => {
    const blueprint = new Blueprint("counters");
    blueprint.unsignedBigInteger("big");
    blueprint.unsignedInteger("regular");
    blueprint.unsignedSmallInteger("small");
    blueprint.unsignedTinyInteger("tiny");

    expect(blueprint.columns.map(({ type, unsigned }) => ({ type, unsigned }))).toEqual([
      { type: "bigInteger", unsigned: true },
      { type: "integer", unsigned: true },
      { type: "smallInteger", unsigned: true },
      { type: "tinyInteger", unsigned: true },
    ]);
  });

  test("softDeletes accepts a custom column name", () => {
    const blueprint = new Blueprint("posts");
    blueprint.softDeletes("removed_at");

    expect(blueprint.columns[0]).toMatchObject({
      name: "removed_at",
      type: "timestamp",
      nullable: true,
    });
  });

  test("drop helpers delegate to index and column commands", () => {
    const blueprint = new Blueprint("posts");
    blueprint.dropTimestamps();
    blueprint.dropTimestampsTz();
    blueprint.dropSoftDeletes("removed_at");
    blueprint.dropSoftDeletesTz("purged_at");
    blueprint.dropRememberToken();
    blueprint.dropMorphs("imageable");

    expect(blueprint.commands).toEqual([
      { name: "dropColumn", parameters: { column: ["created_at", "updated_at"] } },
      { name: "dropColumn", parameters: { column: ["created_at", "updated_at"] } },
      { name: "dropColumn", parameters: { column: ["removed_at"] } },
      { name: "dropColumn", parameters: { column: ["purged_at"] } },
      { name: "dropColumn", parameters: { column: ["remember_token"] } },
      { name: "dropIndex", parameters: { name: "posts_imageable_type_imageable_id_index" } },
      { name: "dropColumn", parameters: { column: ["imageable_type", "imageable_id"] } },
    ]);
  });

  test("id() is the conventional big integer primary key", () => {
    const withId = new Blueprint("posts");
    withId.id();
    const withBigIncrements = new Blueprint("posts");
    withBigIncrements.bigIncrements("id");

    expect(withId.columns).toEqual(withBigIncrements.columns);
    expect(new MySqlGrammar().compileCreate(withId, "posts")).toContain(
      "`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY"
    );
  });

  test("id() takes a column name", () => {
    const blueprint = new Blueprint("posts");
    blueprint.id("post_id");

    const column = blueprint.columns[0]!;
    expect(column.name).toBe("post_id");
    expect(column.autoIncrement).toBe(true);
    expect(column.primary).toBe(true);
  });

  test("rememberToken() adds the nullable 100-character column", () => {
    const blueprint = new Blueprint("users");
    blueprint.increments("id");
    blueprint.rememberToken();

    const token = blueprint.columns.at(-1)!;
    expect(token.name).toBe("remember_token");
    expect(token.type).toBe("string");
    expect(token.length).toBe(100);
    expect(token.nullable).toBe(true);
    expect(new MySqlGrammar().compileCreate(blueprint, "users")).toContain("`remember_token` VARCHAR(100)\n");
  });

  test("rememberToken() leaves the column open to further modifiers", () => {
    const blueprint = new Blueprint("users");
    blueprint.rememberToken().index();

    expect(blueprint.indexes.map((index) => index.name)).toEqual(["users_remember_token_index"]);
  });

  test("rememberToken() round-trips through Schema", async () => {
    connection = setupTestDb();
    await Schema.create("token_users", (table) => {
      table.increments("id");
      table.rememberToken();
    });

    const columns = await Schema.getColumns("token_users");
    const token = columns.find((column) => column.name === "remember_token");
    expect(token).toBeDefined();
    expect(token!.nullable).toBe(true);
    await teardownTestDb(connection);
  });

  test("mysql grammar emits the distinct char and text types", () => {
    const grammar = new MySqlGrammar();
    const blueprint = new Blueprint("documents");
    blueprint.char("token", 64);
    blueprint.char("code");
    blueprint.text("summary");
    blueprint.mediumText("body");
    blueprint.longText("archive");
    const sql = grammar.compileCreate(blueprint, "documents");
    expect(sql).toContain("`token` CHAR(64) NOT NULL");
    expect(sql).toContain("`code` CHAR(255) NOT NULL");
    expect(sql).toContain("`summary` TEXT NOT NULL");
    expect(sql).toContain("`body` MEDIUMTEXT NOT NULL");
    expect(sql).toContain("`archive` LONGTEXT NOT NULL");
  });

  test("postgres keeps char and collapses the sized text types to TEXT", () => {
    const grammar = new PostgresGrammar();
    const blueprint = new Blueprint("documents");
    blueprint.char("token", 64);
    blueprint.mediumText("body");
    blueprint.longText("archive");
    const sql = grammar.compileCreate(blueprint, "documents");
    expect(sql).toContain('"token" CHAR(64) NOT NULL');
    expect(sql).toContain('"body" TEXT NOT NULL');
    expect(sql).toContain('"archive" TEXT NOT NULL');
    expect(sql).not.toContain("MEDIUMTEXT");
    expect(sql).not.toContain("LONGTEXT");
  });

  test("sqlite declares all of them as TEXT", () => {
    const grammar = new SQLiteGrammar();
    const blueprint = new Blueprint("documents");
    blueprint.char("token", 64);
    blueprint.mediumText("body");
    blueprint.longText("archive");
    const sql = grammar.compileCreate(blueprint, "documents");
    expect(sql).toContain('"token" TEXT NOT NULL');
    expect(sql).toContain('"body" TEXT NOT NULL');
    expect(sql).toContain('"archive" TEXT NOT NULL');
    expect(sql).not.toContain("CHAR(");
    expect(sql).not.toContain("MEDIUMTEXT");
    expect(sql).not.toContain("LONGTEXT");
  });

  test("char and long text columns round-trip through Schema", async () => {
    connection = setupTestDb();
    await Schema.create("text_shapes", (table) => {
      table.increments("id");
      table.char("token", 64);
      table.mediumText("body").nullable();
      table.longText("archive").nullable();
    });

    const columns = await Schema.getColumns("text_shapes");
    expect(columns.map((column) => column.name)).toEqual(["id", "token", "body", "archive"]);
    await teardownTestDb(connection);
  });

  test("mysql grammar compileAdd places the column with after()", () => {
    const grammar = new MySqlGrammar();
    const blueprint = new Blueprint("groups");
    blueprint.tinyInteger("course").unsigned().nullable().after("level");
    const [sql] = grammar.compileAdd(blueprint, "groups");
    expect(sql).toBe("ALTER TABLE `groups` ADD COLUMN `course` TINYINT UNSIGNED AFTER `level`");
  });

  test("mysql grammar compileAdd omits AFTER when the column has no position", () => {
    const grammar = new MySqlGrammar();
    const blueprint = new Blueprint("groups");
    blueprint.tinyInteger("course").nullable();
    const [sql] = grammar.compileAdd(blueprint, "groups");
    expect(sql).toBe("ALTER TABLE `groups` ADD COLUMN `course` TINYINT");
    expect(sql).not.toContain("AFTER");
  });

  test("after() is ignored by grammars that cannot reorder columns", () => {
    const blueprint = new Blueprint("groups");
    blueprint.string("course").nullable().after("level");

    const sqlite = new SQLiteGrammar().compileAdd(blueprint, "groups");
    const postgres = new PostgresGrammar().compileAdd(blueprint, "groups");

    expect(sqlite[0]).toBe('ALTER TABLE "groups" ADD COLUMN "course" TEXT');
    expect(postgres[0]).toBe('ALTER TABLE "groups" ADD COLUMN "course" VARCHAR(255)');
  });

  test("after() does not leak into CREATE TABLE", () => {
    const grammar = new MySqlGrammar();
    const blueprint = new Blueprint("groups");
    blueprint.increments("id");
    blueprint.string("level");
    blueprint.tinyInteger("course").nullable().after("level");
    expect(grammar.compileCreate(blueprint, "groups")).not.toContain("AFTER");
  });

  test("Schema.table adds a column declared with after()", async () => {
    connection = setupTestDb();
    await Schema.create("after_groups", (table) => {
      table.increments("id");
      table.string("level").nullable();
    });

    await Schema.table("after_groups", (table) => {
      table.tinyInteger("course").unsigned().nullable().after("level");
    });

    const columns = await Schema.getColumns("after_groups");
    expect(columns.map((column) => column.name)).toContain("course");
    await teardownTestDb(connection);
  });

  test("grammars compile a composite primary key", () => {
    const build = () => {
      const blueprint = new Blueprint("role_user");
      blueprint.integer("user_id");
      blueprint.integer("role_id");
      blueprint.primary(["user_id", "role_id"]);
      return blueprint;
    };

    expect(new SQLiteGrammar().compileCreate(build(), "role_user")).toContain('PRIMARY KEY ("user_id", "role_id")');
    expect(new MySqlGrammar().compileCreate(build(), "role_user")).toContain("PRIMARY KEY (`user_id`, `role_id`)");
    expect(new PostgresGrammar().compileCreate(build(), "role_user")).toContain('PRIMARY KEY ("user_id", "role_id")');
  });

  test("a named composite primary key becomes a named constraint", () => {
    const blueprint = new Blueprint("role_user");
    blueprint.integer("user_id");
    blueprint.integer("role_id");
    blueprint.primary(["user_id", "role_id"], "role_user_pk");

    const sql = new PostgresGrammar().compileCreate(blueprint, "role_user");
    expect(sql).toContain('CONSTRAINT "role_user_pk" PRIMARY KEY ("user_id", "role_id")');
  });

  test("primary() with no arguments still marks the current column", () => {
    const blueprint = new Blueprint("users");
    blueprint.uuid("id").primary();
    blueprint.string("name");

    expect(blueprint.primaryKey).toBeUndefined();
    expect(new SQLiteGrammar().compileCreate(blueprint, "users")).toContain('"id" TEXT PRIMARY KEY NOT NULL');
  });

  test("composite primary key is enforced by the database", async () => {
    connection = setupTestDb();
    await Schema.create("pk_role_user", (table) => {
      table.integer("user_id");
      table.integer("role_id");
      table.primary(["user_id", "role_id"]);
    });

    const columns = await Schema.getColumns("pk_role_user");
    expect(columns.filter((column) => column.primary).map((column) => column.name)).toEqual(["user_id", "role_id"]);

    await connection.run("INSERT INTO pk_role_user (user_id, role_id) VALUES (1, 1)");
    await connection.run("INSERT INTO pk_role_user (user_id, role_id) VALUES (1, 2)");
    await expect(connection.run("INSERT INTO pk_role_user (user_id, role_id) VALUES (1, 1)")).rejects.toThrow();

    await teardownTestDb(connection);
  });

  test("Schema.table compiles an ALTER for a composite primary key", () => {
    const primaryKey = { columns: ["user_id", "document_id"] };
    expect(new MySqlGrammar().compileAddPrimaryKey("favorites", primaryKey)).toBe(
      "ALTER TABLE `favorites` ADD PRIMARY KEY (`user_id`, `document_id`)"
    );
    expect(new PostgresGrammar().compileAddPrimaryKey("favorites", { ...primaryKey, name: "favorites_pk" })).toBe(
      'ALTER TABLE "favorites" ADD CONSTRAINT "favorites_pk" PRIMARY KEY ("user_id", "document_id")'
    );
    expect(() => new SQLiteGrammar().compileAddPrimaryKey("favorites", primaryKey)).toThrow(
      /SQLite cannot add a primary key/
    );
  });

  test("constrained() names the constraint when asked", () => {
    const blueprint = new Blueprint("practicum_specialties");
    blueprint.foreignId("practicum_id").constrained("practicums", "id", "practicum_fk").cascadeOnDelete();

    const [sql] = new MySqlGrammar().compileForeignKeys(blueprint, "practicum_specialties");
    expect(sql).toBe(
      "ALTER TABLE `practicum_specialties` ADD CONSTRAINT `practicum_fk` FOREIGN KEY (`practicum_id`) REFERENCES `practicums` (`id`) ON DELETE cascade"
    );
  });

  test("constrained() without a name leaves the constraint unnamed", () => {
    const blueprint = new Blueprint("posts");
    blueprint.foreignId("user_id").constrained();

    const [sql] = new PostgresGrammar().compileForeignKeys(blueprint, "posts");
    expect(sql).toBe(
      'ALTER TABLE "posts" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id")'
    );
    expect(sql).not.toContain("CONSTRAINT");
  });

  test("constrained() infers snake_case tables from snake_case and camelCase keys", () => {
    const blueprint = new Blueprint("posts");
    blueprint.string("user_id").constrained();
    blueprint.string("userId").constrained();
    blueprint.string("blogPostId").constrained();

    expect(blueprint.foreignKeys.map((foreignKey) => foreignKey.onTable)).toEqual([
      "users",
      "users",
      "blog_posts",
    ]);
  });

  test("foreign key actions reject SQL fragments and invalid SET NULL columns", () => {
    const injected = new Blueprint("posts");
    injected.foreignId("user_id");
    expect(() => injected.constrained().onDelete("cascade; DROP TABLE users; --")).toThrow(
      "Invalid foreign key action"
    );

    const required = new Blueprint("posts");
    required.foreignId("user_id");
    expect(() => required.constrained().nullOnDelete()).toThrow(
      'ON DELETE SET NULL requires nullable foreign key column "user_id"'
    );

    const nullable = new Blueprint("posts");
    nullable.foreignId("user_id").nullable();
    expect(() => nullable.constrained().onDelete("SET   NULL")).not.toThrow();
  });

  test("foreign key action helpers cover the remaining update and delete aliases", () => {
    const blueprint = new Blueprint("posts");
    blueprint.foreignId("owner_id");
    const restricted = blueprint.constrained().restrictOnUpdate();
    blueprint.foreignId("editor_id").nullable();
    const nullable = blueprint.constrained().nullOnUpdate();
    blueprint.foreignId("reviewer_id");
    const noAction = blueprint.constrained().noActionOnUpdate().noActionOnDelete();

    expect(restricted.fk.onUpdate).toBe("restrict");
    expect(nullable.fk.onUpdate).toBe("set null");
    expect(noAction.fk).toMatchObject({ onUpdate: "no action", onDelete: "no action" });
  });

  test("sqlite names its inline foreign keys", () => {
    const blueprint = new Blueprint("practicum_specialties");
    blueprint.foreignId("practicum_id").constrained("practicums", "id", "practicum_fk").cascadeOnDelete();
    blueprint.foreignId("specialty_id").constrained("specialties");

    const sql = new SQLiteGrammar().compileCreate(blueprint, "practicum_specialties");
    expect(sql).toContain('CONSTRAINT "practicum_fk" FOREIGN KEY ("practicum_id") REFERENCES "practicums" ("id") ON DELETE cascade');
    expect(sql).toContain('FOREIGN KEY ("specialty_id") REFERENCES "specialties" ("id")');
  });

  test("a named constrained() foreign key is accepted by the database", async () => {
    connection = setupTestDb();
    await Schema.create("fk_practicums", (table) => {
      table.increments("id");
    });
    await Schema.create("fk_practicum_specialties", (table) => {
      table.increments("id");
      table.foreignId("practicum_id").constrained("fk_practicums", "id", "practicum_named_fk").cascadeOnDelete();
    });

    const foreignKeys = await Schema.getForeignKeys("fk_practicum_specialties");
    expect(foreignKeys).toHaveLength(1);
    expect(foreignKeys[0]!.columns).toEqual(["practicum_id"]);
    expect(foreignKeys[0]!.onTable).toBe("fk_practicums");
    await teardownTestDb(connection);
  });

  test("creates and drops table via Schema", async () => {
    connection = setupTestDb();
    await Schema.create("test_table", (table) => {
      table.increments("id");
      table.string("title");
    });
    expect(await Schema.hasTable("test_table")).toBe(true);
    await Schema.dropIfExists("test_table");
    expect(await Schema.hasTable("test_table")).toBe(false);
  });

  test("adds columns via Schema.table", async () => {
    connection = setupTestDb();
    await Schema.create("alter_test", (table) => {
      table.increments("id");
    });
    await Schema.table("alter_test", (table) => {
      table.string("email").nullable();
    });
    expect(await Schema.hasColumn("alter_test", "email")).toBe(true);
  });

  test("hasTable and hasColumn", async () => {
    connection = setupTestDb();
    await Schema.create("meta_test", (table) => {
      table.increments("id");
      table.string("name");
    });
    expect(await Schema.hasTable("meta_test")).toBe(true);
    expect(await Schema.hasTable("nonexistent")).toBe(false);
    expect(await Schema.hasColumn("meta_test", "name")).toBe(true);
    expect(await Schema.hasColumn("meta_test", "nope")).toBe(false);
  });

  test("schema introspection parameterizes names and preserves existing tables", async () => {
    connection = setupTestDb();
    await Schema.create("safe_table", (table) => {
      table.increments("id");
      table.string("name");
    });

    const calls: { sql: string; bindings: any[] }[] = [];
    const originalQuery = connection.query.bind(connection);
    connection.query = async (sql: string, bindings?: any[]) => {
      calls.push({ sql, bindings: bindings || [] });
      return originalQuery(sql, bindings);
    };

    const maliciousTable = "safe_table'; DROP TABLE safe_table; --";
    const maliciousColumn = "name'; DROP TABLE safe_table; --";

    expect(await Schema.hasTable(maliciousTable)).toBe(false);
    expect(await Schema.hasColumn("safe_table", maliciousColumn)).toBe(false);
    expect(await Schema.hasTable("safe_table")).toBe(true);

    expect(calls[0].sql).toContain("name = ?");
    expect(calls[0].bindings).toEqual([maliciousTable]);
    expect(calls[1].sql).toContain('PRAGMA table_info("safe_table")');
    expect(calls[1].sql).not.toContain(maliciousColumn);
  });

  test("schema helpers reject unsafe schema identifiers", async () => {
    const postgres = new Connection({ url: "postgres://user:pass@localhost:5432/app" });
    const calls: string[] = [];
    postgres.run = async (sql: string) => {
      calls.push(sql);
      return [];
    };
    Schema.setConnection(postgres);

    await Schema.createSchema("tenant_acme");
    expect(calls[0]).toBe('CREATE SCHEMA IF NOT EXISTS "tenant_acme"');
    await expect(Schema.createSchema('tenant"; DROP SCHEMA public; --')).rejects.toThrow("Invalid schema name");
    expect(() => postgres.withSchema("tenant_acme").qualifyTable("users")).not.toThrow();
    expect(() => postgres.withSchema("tenant_acme").qualifyTable('users;DROP')).toThrow("Invalid table name");
  });

  test("sqlite grammar compileCreate with uuid primary key", () => {
    const grammar = new SQLiteGrammar();
    const blueprint = new Blueprint("users");
    blueprint.uuid("id").primary();
    blueprint.string("name");
    const sql = grammar.compileCreate(blueprint, "users");
    expect(sql).toContain('"id" TEXT PRIMARY KEY NOT NULL');
    expect(sql).toContain('"name" TEXT NOT NULL');
  });

  test("sqlite grammar ignores defaultUuid because models generate uuid values", () => {
    const grammar = new SQLiteGrammar();
    const blueprint = new Blueprint("users");
    blueprint.uuid("id").primary().defaultUuid();
    blueprint.string("name");
    const sql = grammar.compileCreate(blueprint, "users");
    expect(sql).toContain('"id" TEXT PRIMARY KEY NOT NULL');
    expect(sql).not.toContain("DEFAULT");
  });

  test("mysql grammar compileCreate with uuid primary key", () => {
    const grammar = new MySqlGrammar();
    const blueprint = new Blueprint("users");
    blueprint.uuid("id").primary();
    blueprint.string("name");
    const sql = grammar.compileCreate(blueprint, "users");
    expect(sql).toContain("`id` CHAR(36) NOT NULL PRIMARY KEY");
    expect(sql).toContain("`name` VARCHAR(255) NOT NULL");
  });

  test("mysql grammar compileCreate with default uuid primary key", () => {
    const grammar = new MySqlGrammar();
    const blueprint = new Blueprint("users");
    blueprint.uuid("id").primary().defaultUuid();
    blueprint.string("name");
    const sql = grammar.compileCreate(blueprint, "users");
    expect(sql).toContain("`id` CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY");
  });

  test("postgres grammar compileCreate with uuid primary key", () => {
    const grammar = new PostgresGrammar();
    const blueprint = new Blueprint("users");
    blueprint.uuid("id").primary();
    blueprint.string("name");
    const sql = grammar.compileCreate(blueprint, "users");
    expect(sql).toContain('"id" UUID NOT NULL PRIMARY KEY');
    expect(sql).toContain('"name" VARCHAR(255) NOT NULL');
  });

  test("postgres grammar compileCreate with default uuid primary key", () => {
    const grammar = new PostgresGrammar();
    const blueprint = new Blueprint("users");
    blueprint.uuid("id").primary().defaultUuid();
    blueprint.string("name");
    const sql = grammar.compileCreate(blueprint, "users");
    expect(sql).toContain('"id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY');
  });

  test("postgres grammar qualifies foreign keys for schema tables", () => {
    const grammar = new PostgresGrammar();
    const blueprint = new Blueprint("strands");
    blueprint.foreignId("educational_level_id").constrained("educational_levels");
    const sql = grammar.compileForeignKeys(blueprint, "tenant_a.strands")[0];
    expect(sql).toContain('ALTER TABLE "tenant_a"."strands" ADD FOREIGN KEY ("educational_level_id") REFERENCES "tenant_a"."educational_levels" ("id")');
  });

  test("creates table with uuid primary key via Schema", async () => {
    connection = setupTestDb();
    await Schema.create("uuid_test", (table) => {
      table.uuid("id").primary();
      table.string("name");
    });
    expect(await Schema.hasTable("uuid_test")).toBe(true);
    expect(await Schema.hasColumn("uuid_test", "id")).toBe(true);
    expect(await Schema.hasColumn("uuid_test", "name")).toBe(true);
  });

  test("schema builder supports foreign and morph shortcuts", () => {
    const grammar = new SQLiteGrammar();
    const blueprint = new Blueprint("posts");
    blueprint.increments("id");
    blueprint.foreignId("user_id").constrained().cascadeOnDelete();
    blueprint.foreignUuid("team_id");
    blueprint.uuidMorphs("taggable");
    blueprint.nullableMorphs("commentable");

    const sql = grammar.compileCreate(blueprint, "posts");
    expect(sql).toContain('"user_id" INTEGER NOT NULL');
    expect(sql).toContain('FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE cascade');
    expect(sql).toContain('"team_id" TEXT NOT NULL');
    expect(sql).toContain('"taggable_id" TEXT NOT NULL');
    expect(sql).toContain('"taggable_type" TEXT NOT NULL');
    expect(sql).toContain('"commentable_id" INTEGER');
    expect(sql).toContain('"commentable_type" TEXT');
    expect(grammar.compileIndexes(blueprint, "posts")).toContain('CREATE INDEX "posts_taggable_type_taggable_id_index" ON "posts" ("taggable_type", "taggable_id")');
  });

  test("introspects indexes and foreign keys", async () => {
    connection = setupTestDb();
    await connection.run("PRAGMA foreign_keys = ON");
    await Schema.create("introspect_parents", (table) => {
      table.increments("id");
    });
    await Schema.create("introspect_children", (table) => {
      table.increments("id");
      table.integer("parent_id");
      table.string("email").unique();
      table.index("parent_id", "children_parent_idx");
      table.foreign("parent_id").references("id").on("introspect_parents").cascadeOnDelete();
    });

    const indexes = await Schema.getIndexes("introspect_children");
    const foreignKeys = await Schema.getForeignKeys("introspect_children");

    expect(await Schema.hasIndex("introspect_children", "children_parent_idx")).toBe(true);
    expect(await Schema.hasIndex("introspect_children", ["parent_id"])).toBe(true);
    expect(indexes.some((index) => index.columns.includes("email") && index.unique)).toBe(true);
    expect(await Schema.hasIndex("introspect_children", "introspect_children_email_unique")).toBe(true);
    expect(await Schema.hasForeignKey("introspect_children", ["parent_id"])).toBe(true);
    expect(foreignKeys[0]).toMatchObject({
      columns: ["parent_id"],
      references: ["id"],
      onTable: "introspect_parents",
    });

    class IntrospectChild extends Model {
      static override table = "introspect_children";
    }
    const blueprint = await IntrospectChild.schema().introspect().blueprint;
    expect(blueprint.columns.find((column) => column.name === "email")?.unique).toBe(true);
    expect(blueprint.indexes).toContainEqual(expect.objectContaining({ name: "children_parent_idx" }));
    expect(blueprint.foreignKeys).toContainEqual(expect.objectContaining({
      columns: ["parent_id"],
      references: ["id"],
      onTable: "introspect_parents",
    }));
  });

  test("model-inferred schemas understand decimal cast arguments", () => {
    class Invoice extends Model {
      static override table = "invoices";
      static override timestamps = false;
      static override fillable = ["amount"];
      static override casts = { amount: "decimal:4" };
    }

    expect(Invoice.schema().blueprint.columns.find((column) => column.name === "amount")).toMatchObject({
      type: "decimal",
      precision: 8,
      scale: 4,
    });
  });

  test("grammar compiles column changes where supported", () => {
    const mysql = new MySqlGrammar();
    const postgres = new PostgresGrammar();
    const blueprint = new Blueprint("users");
    blueprint.string("name", 150).nullable().change();
    const column = blueprint.commands[0].parameters!.column;

    expect(mysql.compileChange("users", column)).toContain("ALTER TABLE `users` MODIFY COLUMN `name` VARCHAR(150)");
    expect(postgres.compileChange("users", column)).toContain('ALTER TABLE "users" ALTER COLUMN "name" TYPE VARCHAR(150)');
  });

  test("Schema.table changes a column without adding it or its unique index again", async () => {
    for (const driver of ["mysql", "postgres"] as const) {
      const statements: string[] = [];
      const connection = {
        getDriverName: () => driver,
        qualifyTable: (table: string) => table,
        run: async (sql: string) => statements.push(sql),
      } as unknown as Connection;

      await Schema.table("users", (table) => {
        table.timestamp("deleted_at").nullable().default(null).unique().change();
      }, connection);

      expect(statements.some((sql) => sql.includes("ADD COLUMN"))).toBe(false);
      expect(statements.some((sql) => sql.includes("UNIQUE INDEX"))).toBe(false);
    }
  });

  test("postgres change resets omitted modifiers and applies PostgreSQL modifiers", () => {
    const grammar = new PostgresGrammar();
    const reset = new Blueprint("users");
    reset.timestamp("deleted_at").nullable().default(null).change();

    expect(grammar.compileChange("users", reset.columns[0]!)).toContain(
      'ALTER TABLE "users" ALTER COLUMN "deleted_at" DROP DEFAULT',
    );
    expect(grammar.compileChange("users", reset.columns[0]!)).toContain(
      'COMMENT ON COLUMN "users"."deleted_at" IS NULL',
    );

    const configured = new Blueprint("users");
    configured.uuid("public_id").defaultUuid().comment("owner's id").change();
    const statements = grammar.compileChange("users", configured.columns[0]!);
    expect(statements).toContain(
      'ALTER TABLE "users" ALTER COLUMN "public_id" SET DEFAULT gen_random_uuid()',
    );
    expect(statements).toContain(
      'COMMENT ON COLUMN "users"."public_id" IS \'owner\'\'s id\'',
    );
  });

  test("every grammar rejects inline primary keys during change", () => {
    const blueprint = new Blueprint("users");
    blueprint.uuid("id").primary().change();
    const column = blueprint.columns[0]!;

    // MySQL would otherwise take MODIFY COLUMN ... PRIMARY KEY and quietly mean
    // something Postgres cannot express at all.
    for (const grammar of [new PostgresGrammar(), new MySqlGrammar(), new SQLiteGrammar()]) {
      expect(() => grammar.compileChange("users", column)).toThrow(/table-level primary key/i);
    }
  });

  test("postgres drops the old default before changing a column's type", () => {
    const blueprint = new Blueprint("users");
    blueprint.string("code", 10).nullable().change();
    const statements = new PostgresGrammar().compileChange("users", blueprint.columns[0]!);

    // Postgres refuses `ALTER COLUMN ... TYPE` while a default it cannot cast to
    // the new type is still attached, so DROP DEFAULT has to come first.
    const dropped = statements.indexOf('ALTER TABLE "users" ALTER COLUMN "code" DROP DEFAULT');
    const retyped = statements.indexOf('ALTER TABLE "users" ALTER COLUMN "code" TYPE VARCHAR(10)');
    expect(dropped).toBeGreaterThanOrEqual(0);
    expect(dropped).toBeLessThan(retyped);
  });

  test("postgres restates a kept default after the type change", () => {
    const blueprint = new Blueprint("users");
    blueprint.integer("hits").default(0).change();
    const statements = new PostgresGrammar().compileChange("users", blueprint.columns[0]!);

    const retyped = statements.indexOf('ALTER TABLE "users" ALTER COLUMN "hits" TYPE INTEGER');
    const set = statements.indexOf('ALTER TABLE "users" ALTER COLUMN "hits" SET DEFAULT 0');
    expect(set).toBeGreaterThan(retyped);
    expect(statements.filter((sql) => sql.includes("DEFAULT"))).toHaveLength(2);
  });

  test("Schema.create rejects commands that only apply to an existing table", async () => {
    const connection = {
      getDriverName: () => "postgres",
      qualifyTable: (table: string) => table,
      run: async () => {},
    } as unknown as Connection;

    // Left to run, change() would create the column but skip its fluent index.
    await expect(
      Schema.create("users", (table) => {
        table.string("email").unique().change();
      }, connection),
    ).rejects.toThrow(/change\(\) only applies to an existing table/i);

    await expect(
      Schema.createIfNotExists("users", (table) => {
        table.dropColumn("legacy");
      }, connection),
    ).rejects.toThrow(/dropColumn\(\) only applies to an existing table/i);
  });
});

describe("Schema.table pre-flight validation", () => {
  test("rejects an unsupported alter before adding any column", async () => {
    const connection = setupTestDb();
    await Schema.create("alter_guard", (table) => {
      table.increments("id");
      table.string("name");
    });

    await expect(
      Schema.table("alter_guard", (table) => {
        table.string("added_a").nullable();
        table.string("added_b").nullable();
        table.primary(["added_a"]);
      })
    ).rejects.toThrow(/SQLite cannot add a primary key/i);

    // The failed migration must leave nothing behind.
    const columns = await Schema.getColumns("alter_guard");
    expect(columns.map((column) => column.name)).toEqual(["id", "name"]);

    await teardownTestDb(connection);
  });

  test("rejects an unsupported column change before adding any column", async () => {
    const connection = setupTestDb();
    await Schema.create("change_guard", (table) => {
      table.increments("id");
      table.string("name");
    });

    await expect(
      Schema.table("change_guard", (table) => {
        table.string("added").nullable();
        table.string("name", 100).change();
      })
    ).rejects.toThrow(/not supported by the SQLite grammar/i);

    const columns = await Schema.getColumns("change_guard");
    expect(columns.map((column) => column.name)).toEqual(["id", "name"]);

    await teardownTestDb(connection);
  });

  test("still applies a supported alter in full", async () => {
    const connection = setupTestDb();
    await Schema.create("alter_ok", (table) => {
      table.increments("id");
    });

    await Schema.table("alter_ok", (table) => {
      table.string("added_a").nullable();
      table.string("added_b").nullable();
    });

    const columns = await Schema.getColumns("alter_ok");
    expect(columns.map((column) => column.name)).toEqual(["id", "added_a", "added_b"]);

    await teardownTestDb(connection);
  });
});

describe("Column introspection", () => {
  test("keeps char columns and their length through introspection", async () => {
    const connection = setupTestDb();
    await connection.run(
      "CREATE TABLE char_table (id INTEGER PRIMARY KEY, code CHAR(64), label VARCHAR(30), body TEXT, amount DECIMAL(30,10))"
    );

    const columns = await Schema.getColumns("char_table");
    const byName = Object.fromEntries(columns.map((column) => [column.name, column]));
    expect(byName.code?.length).toBe(64);
    expect(byName.label?.length).toBe(30);
    expect(byName.amount).toMatchObject({ precision: 30, scale: 10 });

    class CharModel extends Model {
      static override table = "char_table";
    }
    const blueprint = await CharModel.schema().introspect().blueprint;
    const types = Object.fromEntries(blueprint.columns.map((column) => [column.name, column]));
    expect(types.code?.type).toBe("char");
    expect(types.code?.length).toBe(64);
    expect(types.label?.type).toBe("string");
    expect(types.label?.length).toBe(30);
    expect(types.body?.type).toBe("text");
    expect(types.amount).toMatchObject({ type: "decimal", precision: 30, scale: 10 });

    await teardownTestDb(connection);
  });
});

describe.serial("Column introspection on PostgreSQL", () => {
  const postgresUrl = process.env.POSTGRES_TEST_URL;
  const runIfPostgres = postgresUrl ? test.serial : test.skip;

  runIfPostgres("takes char length from character_maximum_length", async () => {
    const connection = new Connection({ url: postgresUrl! });
    const table = `char_probe_${Date.now()}`;
    await connection.run(
      `CREATE TABLE ${table} (id INT PRIMARY KEY, code CHAR(64), label VARCHAR(30), body TEXT)`
    );

    try {
      Schema.setConnection(connection);
      Model.setConnection(connection);

      // Unlike SQLite and MySQL, Postgres reports "character" without the
      // length; it arrives in a column of its own.
      const columns = await Schema.getColumns(table, connection);
      const byName = Object.fromEntries(columns.map((column) => [column.name, column]));
      expect(byName.code?.type).toBe("character");
      expect(byName.code?.length).toBe(64);
      expect(byName.label?.length).toBe(30);

      class PgCharModel extends Model {
        static override table = table;
      }
      const blueprint = await PgCharModel.schema().introspect().blueprint;
      const types = Object.fromEntries(blueprint.columns.map((column) => [column.name, column]));
      expect(types.code?.type).toBe("char");
      expect(types.code?.length).toBe(64);
      expect(types.label?.type).toBe("string");
      expect(types.label?.length).toBe(30);
      expect(types.body?.type).toBe("text");
    } finally {
      await connection.run(`DROP TABLE IF EXISTS ${table}`);
      await connection.close();
    }
  });
});
