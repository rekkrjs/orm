import { describe, expect, test } from "bun:test";
import { Builder, Connection, Model, type CastsAttributes } from "../src/index.js";
import { formatDateForDriver } from "../src/utils.js";
import { PermissiveModel, setupTestDb } from "./helpers.js";

describe("Date handling", () => {
  test("SQLite relative-date helpers compare mixed timestamp formats chronologically", async () => {
    const connection = new Connection({ url: "sqlite://:memory:" });
    const { Schema } = await import("../src/index.js");

    try {
      await Schema.create("relative_events", (table) => {
        table.id();
        table.string("label");
        table.timestamp("occurred_at").useCurrent();
      }, connection);

      await connection.run(
        "INSERT INTO relative_events (label, occurred_at) VALUES (?, datetime('now', '-5 minutes')), (?, datetime('now', '+5 minutes'))",
        ["sql past", "sql future"],
      );
      await new Builder(connection, "relative_events").insert([
        { label: "iso past", occurred_at: new Date(Date.now() - 300_000) },
        { label: "iso future", occurred_at: new Date(Date.now() + 300_000) },
      ]);

      const past = await new Builder(connection, "relative_events")
        .wherePast("occurred_at")
        .orderBy("label")
        .pluck("label");
      const future = await new Builder(connection, "relative_events")
        .whereFuture("occurred_at")
        .orderBy("label")
        .pluck("label");

      expect(past).toEqual(["iso past", "sql past"]);
      expect(future).toEqual(["iso future", "sql future"]);
      expect(new Builder(connection, "relative_events").wherePast("occurred_at").toSql())
        .toContain('julianday("occurred_at") < julianday(');
    } finally {
      await connection.close();
    }
  });

  test("a Date and its ISO equivalent are the same value for dirty tracking", async () => {
    const connection = setupTestDb();
    const { Schema } = await import("../src/index.js");
    await Schema.create("beats", (table) => {
      table.increments("id");
      table.string("at");
    });

    class Beat extends PermissiveModel {
      static override table = "beats";
      static override casts = { at: "datetime" };
      static override fillable = ["at"];
      static override timestamps = false;
    }

    const instant = new Date("2026-08-19T14:00:00.123Z");
    const beat = await Beat.create({ at: instant } as any);
    expect(typeof (beat as any).$attributes.at).toBe("string");

    // Same moment, different object: nothing changed.
    (beat as any).at = new Date(instant.getTime());
    expect(beat.isDirty()).toBe(false);

    // And the ISO string it is stored as counts as the same value too.
    (beat as any).at = instant.toISOString();
    expect(beat.isDirty()).toBe(false);

    (beat as any).at = new Date("2026-08-19T15:00:00.000Z");
    expect(beat.isDirty()).toBe(true);
  });

  test("date casts store calendar days and decode them at UTC midnight", () => {
    class CalendarDay extends PermissiveModel {
      static override casts = { day: "date" };
      static override timestamps = false;
    }

    const record = new CalendarDay({ day: new Date("2026-08-26T23:45:12.345Z") } as any);
    expect(record.$attributes.day).toBe("2026-08-26");
    expect(record.day.toISOString()).toBe("2026-08-26T00:00:00.000Z");

    for (const stored of ["2026-08-26", "2026-08-26 23:45:12", "2026-08-26T23:45:12Z"]) {
      const hydrated = CalendarDay.hydrate({ day: stored });
      expect(hydrated.day.toISOString()).toBe("2026-08-26T00:00:00.000Z");
    }

    const epoch = CalendarDay.hydrate({ day: Date.parse("2026-08-26T23:45:12Z") });
    expect(epoch.day.toISOString()).toBe("2026-08-26T00:00:00.000Z");

    const invalid = CalendarDay.hydrate({ day: "not-a-date" });
    expect(invalid.day).toBeInstanceOf(Date);
    expect(Number.isNaN(invalid.day.getTime())).toBe(true);
  });

  test("reading a stored calendar day does not make it dirty", () => {
    class CalendarDay extends PermissiveModel {
      static override casts = { day: "date" };
      static override timestamps = false;
    }

    const record = CalendarDay.hydrate({ day: "2026-08-26" });
    expect(record.day.toISOString()).toBe("2026-08-26T00:00:00.000Z");
    expect(record.getDirty()).toEqual({});
  });

  test("a Date binding reaches each Bun.SQL driver in its supported form", async () => {
    const received: any[] = [];
    const driver = {
      unsafe: (sql: string, bindings?: any[]) => {
        if (sql.startsWith("SELECT TIMESTAMPDIFF")) return [{ offset_seconds: 0 }];
        received.push(...(bindings ?? []));
        return [];
      },
    };
    const instant = new Date("2026-08-19T14:00:00.123Z");

    for (const [url, nativeDate] of [
      ["sqlite://:memory:", false],
      ["mysql://user:pass@localhost:3306/db", true],
      ["postgres://user:pass@localhost:5432/db", false],
    ] as const) {
      received.length = 0;
      const connection = new Connection({ url }, { driver: driver as any, ownsDriver: false });
      await connection.query("SELECT ?", [instant]);
      if (nativeDate) expect(received[0]).toBe(instant);
      else expect(received[0]).toBe("2026-08-19T14:00:00.123Z");
    }
  });

  test("toSql renders dates in the target driver's format", () => {
    const instant = new Date("2020-01-01T00:00:00.000Z");
    const driver = { unsafe: () => [] };

    for (const [url, expected] of [
      ["sqlite://:memory:", "'2020-01-01T00:00:00.000Z'"],
      ["mysql://user:pass@localhost:3306/db", "'2020-01-01 00:00:00.000'"],
      ["postgres://user:pass@localhost:5432/db", "'2020-01-01T00:00:00.000Z'"],
    ] as const) {
      const connection = new Connection({ url }, { driver: driver as any, ownsDriver: false });
      expect(new Builder(connection, "events").where("created_at", ">", instant).toSql()).toContain(expected);
    }
  });

  test("MySQL does not treat date-looking text as a date binding", async () => {
    const calls: string[] = [];
    const connection = new Connection(
      { url: "mysql://user:pass@localhost:3306/db" },
      { driver: { unsafe: async (sql: string) => (calls.push(sql), []) } as any, ownsDriver: false }
    );

    await connection.run("INSERT INTO logs (message) VALUES (?)", ["2026-08-19 14:00:00 server started"]);

    expect(calls).toEqual(["INSERT INTO logs (message) VALUES (?)"]);
  });

  test("MySQL leaves a serialized calendar date as text", () => {
    class CalendarDay extends PermissiveModel {
      static override casts = { day: "date" };
      static override timestamps = false;
    }
    const connection = new Connection(
      { url: "mysql://user:pass@localhost:3306/db" },
      { driver: { unsafe: () => [] } as any, ownsDriver: false },
    );
    const record = new CalendarDay({ day: new Date("2026-08-26T23:45:12Z") } as any);

    expect(record.attributesForDriver(connection).day).toBe("2026-08-26");
  });

  test("custom database date casts return Date values for driver serialization", async () => {
    class DatabaseDateCast implements CastsAttributes {
      get(_model: Model, _key: string, value: unknown) {
        return new Date(value as string);
      }
      set(_model: Model, _key: string, value: unknown) {
        return value instanceof Date ? value : new Date(value as string);
      }
    }
    class CustomEvent extends PermissiveModel {
      static override timestamps = false;
      static override casts = { happened_at: DatabaseDateCast };
    }

    const queries: Array<{ sql: string; bindings?: any[] }> = [];
    const driver = {
      unsafe: async (sql: string, bindings?: any[]) => {
        queries.push({ sql, bindings });
        return sql.startsWith("SELECT TIMESTAMPDIFF") ? [{ offset_seconds: 0 }] : [];
      },
    };
    const connection = new Connection(
      { url: "mysql://user:pass@localhost:3306/db" },
      { driver: driver as any, ownsDriver: false }
    );
    const event = new CustomEvent({ happened_at: new Date("2026-08-19T14:00:00.123Z") } as any);
    const attributes = event.attributesForDriver(connection);

    expect(attributes.happened_at).toBeInstanceOf(Date);
    await connection.run("SELECT ?", [attributes.happened_at]);
    expect(queries.at(-1)?.bindings?.[0]).toBe(attributes.happened_at);
  });

  test("MySQL checks and executes a date query on the same reserved session", async () => {
    const calls: string[] = [];
    let released = false;
    const reserved = {
      unsafe: async (sql: string) => {
        calls.push(`reserved:${sql}`);
        return sql.startsWith("SELECT TIMESTAMPDIFF") ? [{ offset_seconds: 0 }] : [];
      },
      release: () => { released = true; },
    };
    const pool = {
      unsafe: async (sql: string) => { calls.push(`pool:${sql}`); return []; },
      reserve: async () => reserved,
    };
    const connection = new Connection(
      { url: "mysql://user:pass@localhost:3306/db" },
      { driver: pool as any, ownsDriver: false }
    );

    await connection.run("SELECT ?", [new Date("2026-08-19T14:00:00.123Z")]);

    expect(calls).toEqual([
      "reserved:SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS offset_seconds",
      "reserved:SELECT ?",
    ]);
    expect(released).toBe(true);
  });

  test("MySQL releases reserved sessions when date writes fail", async () => {
    for (const failure of ["check", "insert"] as const) {
      let released = false;
      const reserved = {
        unsafe: async (sql: string) => {
          if (sql.startsWith("SELECT TIMESTAMPDIFF")) {
            if (failure === "check") throw new Error("UTC check failed");
            return [{ offset_seconds: 0 }];
          }
          if (failure === "insert") throw new Error("insert failed");
          return [];
        },
        release: () => { released = true; },
      };
      const connection = new Connection(
        { url: "mysql://user:pass@localhost:3306/db" },
        { driver: { reserve: async () => reserved } as any, ownsDriver: false }
      );
      const instant = new Date("2026-08-19T14:00:00.123Z");

      const operation = failure === "check"
        ? connection.run("UPDATE events SET created_at = ?", [instant])
        : connection.runAndGetMysqlInsertId("INSERT INTO events (created_at) VALUES (?)", [instant]);
      await expect(operation).rejects.toThrow(failure === "check" ? "UTC check failed" : "insert failed");
      expect(released).toBe(true);
    }
  });

  test("MySQL checks UTC once per owned session and rechecks after SET time_zone", async () => {
    const calls: string[] = [];
    const session = {
      unsafe: async (sql: string) => {
        calls.push(sql);
        return sql.startsWith("SELECT TIMESTAMPDIFF") ? [{ offset_seconds: 0 }] : [];
      },
    };
    const pool = {
      begin: async (callback: (driver: typeof session) => Promise<void>) => await callback(session),
    };
    const connection = new Connection(
      { url: "mysql://user:pass@localhost:3306/db" },
      { driver: pool as any, ownsDriver: true }
    );
    const instant = new Date("2026-08-19T14:00:00.123Z");

    await connection.transaction(async (transaction) => {
      await transaction.run("INSERT INTO events (created_at) VALUES (?)", [instant]);
      await transaction.run("UPDATE events SET created_at = ?", [instant]);
      await transaction.run("SET SESSION time_zone = '+00:00'");
      await transaction.run("UPDATE events SET created_at = ?", [instant]);
    });

    expect(calls).toEqual([
      "SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS offset_seconds",
      "INSERT INTO events (created_at) VALUES (?)",
      "UPDATE events SET created_at = ?",
      "SET SESSION time_zone = '+00:00'",
      "SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS offset_seconds",
      "UPDATE events SET created_at = ?",
    ]);
  });

  test("formatDateForDriver keeps milliseconds and drops the T only for MySQL", () => {
    const instant = new Date("2026-08-19T14:00:00.123Z");
    expect(formatDateForDriver(instant, "mysql")).toBe("2026-08-19 14:00:00.123");
    expect(formatDateForDriver(instant, "sqlite")).toBe("2026-08-19T14:00:00.123Z");
    expect(formatDateForDriver(instant, "postgres")).toBe("2026-08-19T14:00:00.123Z");
    expect(formatDateForDriver(instant, undefined)).toBe("2026-08-19T14:00:00.123Z");
  });

  test("a model with a date cast needs no connection to exist", () => {
    class Detached extends PermissiveModel {
      static override table = "detached";
      static override casts = { when: "datetime" };
      static override fillable = ["when"];
    }
    const detached = new Detached({ when: new Date("2026-08-19T14:00:00.123Z") } as any);
    expect((detached as any).$attributes.when).toBe("2026-08-19T14:00:00.123Z");
  });
});
