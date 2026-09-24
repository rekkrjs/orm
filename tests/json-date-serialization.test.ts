import { afterAll, beforeAll, describe, expect, test } from "./harness.js";
import { Builder, Model, Schema } from "../src/index.js";
import { castValueIsReady, isCanonicalIso } from "../src/model/ModelJsonRow.js";
import { PermissiveModel, setupTestDb, teardownTestDb } from "./helpers.js";

/** Stored dates that must never be handed to the output untouched. */
const AWKWARD_STORED_DATES = [
  "2026-08-20T10:11:12.000Z",      // canonical — the one form that may pass through
  "2026-08-20T10:11:12Z",          // no milliseconds
  "2026-08-20T10:11:12.00Z",       // two decimals
  "2026-08-20T10:11:12.000+02:00", // offset
  "2026-08-20T10:11:12.000z",      // lowercase z
  "2026-08-20 10:11:12",           // SQL form, parsed as local time
  "2023-02-30T00:00:00.000Z",      // day that does not exist
  "2024-02-29T00:00:00.000Z",      // leap day
  "2023-02-29T00:00:00.000Z",      // leap day in a common year
  "2026-08-20T24:00:00.000Z",      // hour 24
  "2026-08-20T10:11:60.000Z",      // leap second
  "2026-13-01T00:00:00.000Z",      // month 13
  "0050-01-01T00:00:00.000Z",      // two-digit year
  "+010000-01-01T00:00:00.000Z",   // extended year
  "-000001-01-01T00:00:00.000Z",   // negative year
  "",
];

/** What the cast path produces: the reference both serializers must match. */
function throughDateRoundTrip(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function findDates(value: unknown, path = "$"): string[] {
  if (value instanceof Date) return [path];
  if (Array.isArray(value)) return value.flatMap((item, index) => findDates(item, `${path}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => findDates(item, `${path}.${key}`));
  }
  return [];
}

class JsonDateUser extends PermissiveModel {
  static override table = "json_date_users";
  static override timestamps = false;
  static override casts = { occurred_at: "datetime", born_on: "date" };
  static override appends = ["derived_at"];

  get derived_at(): Date {
    return new Date("2026-03-04T05:06:07.000Z");
  }
}

// rawJson() excludes appends.
class PlainJsonDateUser extends PermissiveModel {
  static override table = "json_date_users";
  static override timestamps = false;
  static override casts = { occurred_at: "datetime", born_on: "date" };
}

describe("JSON date serialization", () => {
  const connection = setupTestDb();

  beforeAll(async () => {
    Model.setConnection(connection);
    Schema.setConnection(connection);
    await Schema.create("json_date_users", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamp("occurred_at");
      table.string("born_on");
      table.string("looks_like_a_date");
      table.integer("quantity");
      table.boolean("active");
      table.text("payload");
      table.timestamp("undeclared_at").nullable();
    });
    await new Builder(connection, "json_date_users").insert({
      name: "Ada",
      occurred_at: "2026-08-20T10:11:12.000Z",
      born_on: "1815-12-10",
      looks_like_a_date: "2026-08-20T10:11:12.000Z",
      quantity: 42,
      active: 1,
      payload: JSON.stringify({ when: "2026-01-01T00:00:00.000Z" }),
      undeclared_at: "2026-09-09T09:09:09.000Z",
    });
  });

  afterAll(async () => {
    await Schema.drop("json_date_users");
    await teardownTestDb(connection);
  });

  test("renders dates as ISO strings and leaves every other value alone", async () => {
    const user = (await JsonDateUser.query().first())!;
    const json = user.toJSON() as Record<string, any>;

    expect(json.occurred_at).toBe("2026-08-20T10:11:12.000Z");
    expect(json.born_on).toBe("1815-12-10");
    expect(json.derived_at).toBe("2026-03-04T05:06:07.000Z");
    expect(findDates(json)).toEqual([]);

    expect(json.name).toBe("Ada");
    expect(json.looks_like_a_date).toBe("2026-08-20T10:11:12.000Z");
    expect(typeof json.looks_like_a_date).toBe("string");
    expect(json.quantity).toBe(42);
    expect(json.active).toBe(1);
    expect(json.payload).toBe(JSON.stringify({ when: "2026-01-01T00:00:00.000Z" }));

    expect((user as any).occurred_at).toBeInstanceOf(Date);
  });

  test("produces the bytes JSON.stringify produced before, and rawJson agrees", async () => {
    const hydrated = (await PlainJsonDateUser.query().get()).toJSON();
    const direct = await PlainJsonDateUser.query().rawJson();

    expect(JSON.stringify(direct)).toBe(JSON.stringify(hydrated));
    expect(findDates(direct)).toEqual([]);
    expect((direct[0] as any).undeclared_at).toBe("2026-09-09T09:09:09.000Z");
  });

  // Serializing skips the Date round trip when the stored text is already the
  // ISO output. That is only sound while the predicate never accepts a string
  // the round trip would have changed, so this is the proof, not a sample: drop
  // the calendar check from isCanonicalIso and it fails on hundreds of dates.
  test("only passes through stored text the Date round trip returns unchanged", () => {
    const corpus = [...AWKWARD_STORED_DATES];
    for (let index = 0; index < 20_000; index++) {
      corpus.push(new Date(Date.UTC(
        1900 + (index % 300), index % 12, 1 + (index % 31),
        index % 24, index % 60, index % 60, index % 1000,
      )).toISOString());
    }
    for (let year = 1996; year <= 2025; year++) {
      for (let month = 1; month <= 12; month++) {
        for (const day of [28, 29, 30, 31, 32]) {
          corpus.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00.000Z`);
        }
      }
    }

    const diverged: string[] = [];
    let accepted = 0;
    for (const value of corpus) {
      if (!isCanonicalIso(value)) continue;
      accepted++;
      if (throughDateRoundTrip(value) !== value) diverged.push(value);
    }

    expect(diverged).toEqual([]);
    expect(accepted).toBeGreaterThan(20_000);
    expect(isCanonicalIso("2023-02-30T00:00:00.000Z")).toBe(false);
    expect(isCanonicalIso("2026-08-20T24:00:00.000Z")).toBe(false);

    // The shortcut is for datetime/timestamp only: `date` truncates to the day.
    expect(castValueIsReady("datetime", "2026-08-20T10:11:12.000Z")).toBe(true);
    expect(castValueIsReady("date", "2026-08-20T10:11:12.000Z")).toBe(false);
    expect(castValueIsReady("datetime", "2026-08-20 10:11:12")).toBe(false);
  });

  test("normalizes awkward stored dates the same way through both serializers", async () => {
    for (const [index, occurred] of AWKWARD_STORED_DATES.entries()) {
      const name = `awkward-${index}`;
      await new Builder(connection, "json_date_users").insert({
        name, occurred_at: occurred, born_on: "1815-12-10",
        looks_like_a_date: "", quantity: 0, active: 0, payload: "{}",
      });

      const expected = throughDateRoundTrip(occurred);
      const hydrated = (await PlainJsonDateUser.query().where("name", name).first())!.toJSON() as any;
      const [direct] = await PlainJsonDateUser.query().where("name", name).rawJson() as any[];

      expect(hydrated.occurred_at).toBe(expected);
      expect(direct.occurred_at).toBe(expected);
      // Untouched neighbours: only the date column is normalized.
      expect(direct.born_on).toBe("1815-12-10");
      expect(direct.looks_like_a_date).toBe("");
      expect(direct.name).toBe(name);
    }
  });

  test("an accessor replaces the date cast, so the Date it returns keeps its time", async () => {
    class AccessorDateUser extends PlainJsonDateUser {
      static override accessors = { born_on: { get: () => new Date("2026-03-04T05:06:07.000Z") } };
    }
    class FormattedDateUser extends PlainJsonDateUser {
      static override casts = { occurred_at: "datetime", born_on: "date:Y-m-d" };
    }
    const accessor = (await AccessorDateUser.query().where("name", "Ada").first())!.toJSON() as any;
    expect(accessor.born_on).toBe("2026-03-04T05:06:07.000Z");
    expect(accessor.occurred_at).toBe("2026-08-20T10:11:12.000Z");

    // `date:<format>` is still the date cast: the format is not applied, the day is.
    const formatted = (await FormattedDateUser.query().where("name", "Ada").first())!.toJSON() as any;
    const [direct] = await FormattedDateUser.query().where("name", "Ada").rawJson() as any[];
    expect([formatted.born_on, direct.born_on]).toEqual(["1815-12-10", "1815-12-10"]);
  });

  test("renders an unparseable stored date as null, the way JSON.stringify does", async () => {
    // Bypass the model setter to exercise an invalid date already in storage.
    await new Builder(connection, "json_date_users").insert({
      name: "Corrupt", occurred_at: "2026-08-20T10:11:12.000Z", born_on: "not-a-date",
      looks_like_a_date: "", quantity: 0, active: 0, payload: "{}",
    });
    const user = (await PlainJsonDateUser.query().where("name", "Corrupt").first())!;
    expect((user as any).born_on).toBeInstanceOf(Date);
    expect(Number.isNaN(((user as any).born_on as Date).getTime())).toBe(true);

    expect(() => user.toJSON()).not.toThrow();
    expect((user.toJSON() as any).born_on).toBeNull();
    expect(JSON.parse(JSON.stringify({ born_on: new Date(NaN) })).born_on).toBeNull();

    const direct = await PlainJsonDateUser.query().where("name", "Corrupt").rawJson();
    expect((direct[0] as any).born_on).toBeNull();
    expect((direct[0] as any).occurred_at).toBe("2026-08-20T10:11:12.000Z");
    expect((direct[0] as any).name).toBe("Corrupt");
  });
});
