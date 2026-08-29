import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PermissiveModel } from "./helpers.js";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { pathToFileURL } from "url";
import {
  Builder,
  Connection,
  Migrator,
  Model,
  Schema,
  UniqueConstraintViolationError,
  backedEnum,
} from "../src/index.js";
import { createDriverContext, serverUrl, type ServerDriver } from "./driver-harness.js";

type ContractDriver = "sqlite" | ServerDriver;

interface ContractContext {
  connection: Connection;
  dispose(): Promise<void>;
}

class ContractUser extends PermissiveModel {
  static table = "contract_users";
  static timestamps = false;

  posts() {
    return this.hasMany(ContractPost, "user_id");
  }
}

class ContractPost extends PermissiveModel {
  static table = "contract_posts";
  static timestamps = false;

  user() {
    return this.belongsTo(ContractUser, "user_id");
  }
}

class ContractDefault extends PermissiveModel {
  static table = "contract_defaults";
  static timestamps = false;
}

class ContractUniqueRecord extends PermissiveModel {
  static table = "contract_unique_records";
  static timestamps = false;
}

const ContractJsonState = backedEnum({ Ready: "ready", Paused: "paused" });

class ContractFastJson extends PermissiveModel {
  static override table = "contract_fast_json";
  static override timestamps = false;
  static override casts = {
    active: "boolean",
    happened_at: "datetime",
    metadata: "json",
    state: ContractJsonState,
  };
}

async function createContext(driver: ContractDriver): Promise<ContractContext> {
  if (driver !== "sqlite") return await createDriverContext(driver);
  const connection = new Connection({ url: "sqlite://:memory:" });
  Model.setConnection(connection);
  Schema.setConnection(connection);
  return { connection, dispose: () => connection.close() };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected promise to reject");
}

function expectDriverUniqueCause(driver: ContractDriver, error: unknown): void {
  expect(error).toBeInstanceOf(UniqueConstraintViolationError);
  const cause = (error as Error).cause;
  if (driver === "sqlite") expect(cause).toBeInstanceOf(SQL.SQLiteError);
  else if (driver === "mysql") expect(cause).toBeInstanceOf(SQL.MySQLError);
  else expect(cause).toBeInstanceOf(SQL.PostgresError);
}

for (const driver of ["sqlite", "mysql", "postgres"] as const) {
  const run = driver === "sqlite" || serverUrl(driver) ? test.serial : test.skip;

  describe.serial(`${driver} driver contract`, () => {
    let context: ContractContext;

    beforeAll(async () => {
      if (driver !== "sqlite" && !serverUrl(driver)) return;
      context = await createContext(driver);
    });

    afterAll(async () => {
      await context?.dispose();
    });

    run("supports schema changes, CRUD, relations, dates, JSON, upserts, and transactions", async () => {
      const connection = context.connection;

      await Schema.create("contract_users", (table) => {
        table.increments("id");
        table.string("email").unique();
        table.string("name");
        table.json("tags");
        table.timestamp("joined_at");
      }, connection);
      await Schema.create("contract_posts", (table) => {
        table.increments("id");
        table.integer("user_id").unsigned().index();
        table.string("title");
        table.foreign("user_id").references("id").on("contract_users").cascadeOnDelete();
      }, connection);

      await Schema.table("contract_users", (table) => {
        table.string("nickname").nullable();
      }, connection);
      await Schema.table("contract_users", (table) => {
        table.renameColumn("nickname", "display_name");
      }, connection);

      expect(await Schema.hasColumn("contract_users", "display_name", connection)).toBe(true);
      expect(await Schema.hasIndex("contract_posts", ["user_id"])).toBe(true);
      expect(await Schema.hasForeignKey("contract_posts", ["user_id"])).toBe(true);

      const joinedAt = new Date("2026-08-19T10:11:12.345Z");
      const user = await ContractUser.create({
        email: "ada@example.test",
        name: "Ada",
        tags: JSON.stringify(["bun", "orm"]),
        joined_at: joinedAt,
      });
      const post = await ContractPost.create({ user_id: user.getAttribute("id"), title: "First" });

      expect((await ContractUser.find(user.getAttribute("id")))?.getAttribute("name")).toBe("Ada");
      expect((await user.posts().get()).map((row) => row.getAttribute("title"))).toEqual(["First"]);
      expect((await post.user().get())?.getAttribute("email")).toBe("ada@example.test");
      expect(await ContractUser.whereDate("joined_at", "2026-08-19").count()).toBe(1);
      expect(await ContractUser.whereJsonContains("tags", "orm").count()).toBe(1);

      await new Builder(connection, "contract_users").insertOrIgnore({
        email: "ada@example.test",
        name: "Ignored",
        tags: "[]",
        joined_at: joinedAt,
      });
      expect(await ContractUser.where("email", "ada@example.test").count()).toBe(1);

      await new Builder(connection, "contract_users").upsert({
        email: "ada@example.test",
        name: "Ada Updated",
        tags: JSON.stringify(["orm"]),
        joined_at: joinedAt,
      }, "email", ["name", "tags"]);
      expect((await ContractUser.where("email", "ada@example.test").first())?.getAttribute("name")).toBe("Ada Updated");

      await expect(connection.transaction(async (transaction) => {
        await new Builder(transaction, "contract_users").insert({
          email: "rollback@example.test",
          name: "Rollback",
          tags: "[]",
          joined_at: joinedAt,
        });
        throw new Error("rollback contract");
      })).rejects.toThrow("rollback contract");
      expect(await ContractUser.where("email", "rollback@example.test").count()).toBe(0);

      user.setAttribute("name", "Saved");
      await user.save();
      expect((await ContractUser.find(user.getAttribute("id")))?.getAttribute("name")).toBe("Saved");
      await post.delete();
      expect(await ContractPost.find(post.getAttribute("id"))).toBeNull();
    });

    if (driver !== "sqlite") {
      run("change replaces a column definition without adding it again", async () => {
        const connection = context.connection;
        await Schema.create("contract_changed_columns", (table) => {
          table.increments("id");
          table.string("name");
          table.timestamp("deleted_at").nullable().useCurrent();
        }, connection);

        await Schema.table("contract_changed_columns", (table) => {
          table.timestamp("deleted_at").nullable().default(null).change();
        }, connection);

        await new Builder(connection, "contract_changed_columns").insert({ name: "active" });
        expect((await new Builder(connection, "contract_changed_columns").first())!.deleted_at).toBeNull();
      });

      run("change retypes a column whose old default cannot cast to the new type", async () => {
        const connection = context.connection;
        await Schema.create("contract_retyped_columns", (table) => {
          table.increments("id");
          table.integer("code").default(0);
        }, connection);

        // The old DEFAULT 0 is an integer literal: Postgres aborts the type
        // change unless it is dropped before ALTER COLUMN ... TYPE runs.
        await Schema.table("contract_retyped_columns", (table) => {
          table.string("code", 10).nullable().change();
        }, connection);

        await new Builder(connection, "contract_retyped_columns").insert({ code: "A-1" });
        const row = (await new Builder(connection, "contract_retyped_columns").first())!;
        expect(row.code).toBe("A-1");
      });
    }

    run("normalizes only unique violations across every write path", async () => {
      const connection = context.connection;
      await Schema.create("contract_unique_records", (table) => {
        table.increments("id");
        table.string("email").unique();
        table.string("required_value");
      }, connection);

      const first = await ContractUniqueRecord.on(connection).create({
        email: `first-${driver}@example.test`,
        required_value: "first",
      });

      const directlyCreated = await ContractUniqueRecord.on(connection).createOrFirst({
        email: `create-or-first-${driver}@example.test`,
      }, {
        required_value: "created",
      });
      const recovered = await ContractUniqueRecord.on(connection).createOrFirst({
        email: `create-or-first-${driver}@example.test`,
      }, {
        required_value: "must not overwrite",
      });
      expect(recovered.getAttribute("id")).toBe(directlyCreated.getAttribute("id"));
      expect(recovered.getAttribute("required_value")).toBe("created");

      await connection.transaction(async (transaction) => {
        await ContractUniqueRecord.on(transaction).createOrFirst({
          email: `create-or-first-${driver}@example.test`,
        }, {
          required_value: "savepoint conflict",
        });
        await ContractUniqueRecord.on(transaction).createOrFirst({
          email: `after-savepoint-${driver}@example.test`,
        }, {
          required_value: "transaction remains usable",
        });
      });
      expect(await ContractUniqueRecord.on(connection).where("email", `after-savepoint-${driver}@example.test`).count()).toBe(1);

      const config = connection.getConfig();
      const concurrentConnection = driver === "sqlite"
        ? connection
        : new Connection({ ...config, max: 5 });
      try {
        const concurrent = await Promise.all(Array.from({ length: 16 }, () =>
          ContractUniqueRecord.on(concurrentConnection).createOrFirst({
            email: `concurrent-create-or-first-${driver}@example.test`,
          }, {
            required_value: "winner",
          })
        ));
        expect(new Set(concurrent.map((record) => record.getAttribute("id"))).size).toBe(1);
        expect(await ContractUniqueRecord.on(connection)
          .where("email", `concurrent-create-or-first-${driver}@example.test`)
          .count()).toBe(1);
      } finally {
        if (concurrentConnection !== connection) await concurrentConnection.close();
      }

      // On MySQL this model path goes through runAndGetMysqlInsertId() on a
      // reserved session, which must classify the failed INSERT before trying
      // to read LAST_INSERT_ID().
      expectDriverUniqueCause(driver, await caught(ContractUniqueRecord.on(connection).create({
        email: `first-${driver}@example.test`,
        required_value: "model duplicate",
      })));
      expectDriverUniqueCause(driver, await caught(new Builder(connection, "contract_unique_records").insert({
        email: `first-${driver}@example.test`,
        required_value: "builder duplicate",
      })));
      const duplicatePrimary = driver === "postgres"
        ? connection.run(
            `INSERT INTO ${connection.getGrammar().wrap(connection.qualifyTable("contract_unique_records"))} ` +
              `("id", "email", "required_value") OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3)`,
            [first.getAttribute("id"), `primary-${driver}@example.test`, "primary duplicate"],
          )
        : new Builder(connection, "contract_unique_records").insert({
            id: first.getAttribute("id"),
            email: `primary-${driver}@example.test`,
            required_value: "primary duplicate",
          });
      expectDriverUniqueCause(driver, await caught(duplicatePrimary));

      const second = await ContractUniqueRecord.on(connection).create({
        email: `second-${driver}@example.test`,
        required_value: "second",
      });
      expectDriverUniqueCause(driver, await caught(
        ContractUniqueRecord.on(connection)
          .where("id", second.getAttribute("id"))
          .update({ email: `first-${driver}@example.test` })
      ));

      const before = await ContractUniqueRecord.on(connection).count();
      await ContractUniqueRecord.on(connection).insertOrIgnore({
        email: `first-${driver}@example.test`,
        required_value: "ignored",
      });
      expect(await ContractUniqueRecord.on(connection).count()).toBe(before);

      const notNull = await caught(new Builder(connection, "contract_unique_records").insert({
        email: `missing-${driver}@example.test`,
      }));
      expect(notNull).not.toBeInstanceOf(UniqueConstraintViolationError);
      if (driver === "sqlite") expect(notNull).toBeInstanceOf(SQL.SQLiteError);
      else if (driver === "mysql") expect(notNull).toBeInstanceOf(SQL.MySQLError);
      else expect(notNull).toBeInstanceOf(SQL.PostgresError);

      if (driver === "postgres") {
        const table = connection.getGrammar().wrap(connection.qualifyTable("contract_deferred_unique"));
        await connection.run(
          `CREATE TABLE ${table} (email TEXT, UNIQUE (email) DEFERRABLE INITIALLY DEFERRED)`,
        );

        const callbackError = await caught(connection.transaction(async (transaction) => {
          await new Builder(transaction, "contract_deferred_unique").insert({ email: "callback@example.test" });
          await new Builder(transaction, "contract_deferred_unique").insert({ email: "callback@example.test" });
        }));
        expectDriverUniqueCause(driver, callbackError);

        await connection.beginTransaction();
        await new Builder(connection, "contract_deferred_unique").insert({ email: "manual@example.test" });
        await new Builder(connection, "contract_deferred_unique").insert({ email: "manual@example.test" });
        expectDriverUniqueCause(driver, await caught(connection.commit()));

        expect(await new Builder(connection, "contract_deferred_unique").count()).toBe(0);
      }
    });

    run("keeps raw and nested query values out of SQL text", async () => {
      const connection = context.connection;
      const malicious = "CURRENT_TIMESTAMP OR 1=1 --";

      const nested = new Builder(connection, "contract_users").where("name", malicious);
      expect(await new Builder(connection, "contract_users").fromSub(nested, "filtered").count()).toBe(0);

      const selected = await new Builder(connection, "contract_users")
        .selectRaw("? AS marker", [malicious])
        .whereRaw("name = ?", ["Saved"])
        .first();
      expect((selected as any)?.marker).toBe(malicious);

      expect(() => new Builder(connection, "contract_users").where("name", "= ? OR 1=1 --", "missing")).toThrow("Invalid query operator");
    });

    run("distinguishes undefined from null and keeps database defaults", async () => {
      const connection = context.connection;
      await Schema.create("contract_defaults", (table) => {
        table.increments("id");
        table.string("value").nullable().default("database");
      }, connection);

      const omitted = await ContractDefault.create({ value: undefined });
      const explicitNull = await ContractDefault.create({ value: null });
      await new Builder(connection, "contract_defaults").insertOrIgnore({ value: undefined });
      await omitted.update({ value: undefined });

      expect((await ContractDefault.find(omitted.id))!.value).toBe("database");
      expect((await ContractDefault.find(explicitNull.id))!.value).toBeNull();
      expect(await ContractDefault.where("value", "database").count()).toBe(2);
    });

    run("keeps direct query JSON equal to hydrated JSON across driver values", async () => {
      const connection = context.connection;
      await Schema.create("contract_fast_json", (table) => {
        table.increments("id");
        table.boolean("active");
        table.timestamp("happened_at");
        table.json("metadata");
        table.string("state");
      }, connection);

      await ContractFastJson.on(connection).insert({
        active: true,
        happened_at: "2026-08-20T10:11:12.000Z",
        metadata: JSON.stringify({ driver, nested: [1, 2] }),
        state: ContractJsonState.Ready,
      });

      const direct = await ContractFastJson.on(connection).rawJson();
      const hydrated = (await ContractFastJson.on(connection).get()).toJSON();
      expect(direct).toEqual(hydrated);
      expect(direct[0]).toMatchObject({
        active: true,
        metadata: { driver, nested: [1, 2] },
        state: "ready",
      });
      expect((direct[0] as any).happened_at).toBeInstanceOf(Date);
    });

    run("paginates joined and grouped queries with having bindings", async () => {
      const connection = context.connection;
      await Schema.create("contract_page_users", (table) => {
        table.increments("id");
        table.string("name");
      }, connection);
      await Schema.create("contract_page_posts", (table) => {
        table.increments("id");
        table.integer("user_id");
        table.boolean("published");
      }, connection);
      const users = new Builder(connection, "contract_page_users");
      const adaId = await users.insertGetId({ name: "Ada" });
      const graceId = await users.insertGetId({ name: "Grace" });
      await new Builder(connection, "contract_page_posts").insert([
        { user_id: adaId, published: true },
        { user_id: adaId, published: true },
        { user_id: graceId, published: false },
      ]);

      const page = await new Builder(connection, "contract_page_users")
        .select("contract_page_users.id", "contract_page_users.name")
        .join("contract_page_posts", "contract_page_users.id", "=", "contract_page_posts.user_id")
        .where("contract_page_posts.published", true)
        .groupBy("contract_page_users.id", "contract_page_users.name")
        .havingRaw("COUNT(contract_page_posts.id) >= ?", [2])
        .paginate(10, 1);

      expect(page.total).toBe(1);
      expect(page.data).toHaveLength(1);
      expect((page.data[0] as any).name).toBe("Ada");
    });

    run("enforces SET NULL, RESTRICT, and ON UPDATE CASCADE foreign keys", async () => {
      const connection = context.connection;
      await Schema.create("contract_fk_parents", (table) => {
        table.bigInteger("id").unsigned().primary();
        table.string("name");
      }, connection);
      await Schema.create("contract_fk_nullable", (table) => {
        table.id();
        table.foreignId("parent_id").nullable().constrained("contract_fk_parents")
          .onDelete("set null").onUpdate("cascade");
      }, connection);
      await Schema.create("contract_fk_restricted", (table) => {
        table.id();
        table.foreignId("parent_id").constrained("contract_fk_parents").onDelete("restrict");
      }, connection);

      const parents = new Builder(connection, "contract_fk_parents");
      const mutableId = 100;
      const restrictedId = 200;
      const updatedId = 101;
      await parents.insert([
        { id: mutableId, name: "mutable" },
        { id: restrictedId, name: "restricted" },
      ]);
      await new Builder(connection, "contract_fk_nullable").insert({ parent_id: mutableId });
      await new Builder(connection, "contract_fk_restricted").insert({ parent_id: restrictedId });

      await parents.clone().where("id", mutableId).update({ id: updatedId });
      expect(Number((await new Builder(connection, "contract_fk_nullable").first())!.parent_id)).toBe(updatedId);
      await parents.clone().where("id", updatedId).delete();
      expect((await new Builder(connection, "contract_fk_nullable").first())!.parent_id).toBeNull();
      await expect(parents.clone().where("id", restrictedId).delete()).rejects.toThrow();
    });

    if (driver === "mysql") {
      run("manual pooled transactions stay on one MySQL session", async () => {
        const config = context.connection.getConfig();
        if (!("url" in config)) throw new Error("Expected URL-based MySQL test connection.");
        await Schema.create("contract_manual_transactions", (table) => {
          table.increments("id");
          table.string("value");
        }, context.connection);
        const pooled = new Connection({ url: config.url, max: 5 });
        try {
          await pooled.beginTransaction();
          const before = (await pooled.query("SELECT CONNECTION_ID() AS id"))[0].id;
          await pooled.run("INSERT INTO contract_manual_transactions (value) VALUES (?)", ["rollback"]);
          const after = (await pooled.query("SELECT CONNECTION_ID() AS id"))[0].id;
          expect(after).toBe(before);
          await pooled.rollback();
          expect(await new Builder(context.connection, "contract_manual_transactions").count()).toBe(0);
        } finally {
          if (pooled.isInTransaction()) await pooled.rollback().catch(() => null);
          await pooled.close();
        }
      });
    }

    run("runs and rolls back migrations", async () => {
      const migrations = await mkdtemp(join(process.cwd(), "tests", ".tmp-driver-contract-"));
      const ormUrl = pathToFileURL(join(process.cwd(), "src", "index.ts")).href;
      const migrationPath = join(migrations, "20260819000000_create_contract_migrated.ts");
      await Bun.write(migrationPath, `
import { Migration, Schema } from ${JSON.stringify(ormUrl)};
export default class CreateContractMigrated extends Migration {
  async up() {
    await Schema.create("contract_migrated", (table) => {
      table.increments("id");
      table.string("value");
    });
  }
  async down() {
    await Schema.dropIfExists("contract_migrated");
  }
}
`);

      try {
        const migrator = new Migrator(context.connection, migrations);
        await migrator.run();
        expect(await Schema.hasTable("contract_migrated", context.connection)).toBe(true);
        expect((await migrator.status())[0]?.status).toBe("Ran");
        await migrator.rollback();
        expect(await Schema.hasTable("contract_migrated", context.connection)).toBe(false);
      } finally {
        await rm(migrations, { recursive: true, force: true });
      }
    });
  });
}
