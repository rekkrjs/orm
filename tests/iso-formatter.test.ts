import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatDateForDriver, formatIso } from "../src/utils.js";
import { serializeDate, serializeRowDates } from "../src/model/ModelJsonRow.js";
import { Model } from "../src/index.js";
// The query grammar, not the schema grammar the package exports under this name.
import { SQLiteGrammar } from "../src/query/grammars/SQLiteGrammar.js";

/**
 * `formatIso()` replaces `Date.prototype.toISOString()` on the ORM's hot paths,
 * so the bar is not "looks right": every string it returns has to be the string
 * the built-in would have returned, for every date a database can hold, from
 * any time zone the process happens to run in.
 *
 * The date arithmetic still belongs to the engine — only `getUTC*` accessors
 * are read — which is why these tests compare against the built-in rather than
 * against hand-written expectations. The interesting failures are in the
 * formatting: a year under four digits, a rolled-over calendar day, a padding
 * that silently drops a leading zero.
 */
function divergences(dates: Iterable<Date>): string[] {
  const failures: string[] = [];
  for (const date of dates) {
    const expected = date.toISOString();
    const actual = formatIso(date);
    if (actual !== expected) failures.push(`${actual} ≠ ${expected}`);
  }
  return failures;
}

/** Years 0–99 reach the year field through setUTCFullYear: Date.UTC maps them to 1900–1999. */
function utcDate(year: number, month: number, day: number, hour = 3, minute = 4, second = 5, ms = 6): Date {
  const date = new Date(Date.UTC(2000, month - 1, day, hour, minute, second, ms));
  date.setUTCFullYear(year);
  return date;
}

const YEARS = [0, 1, 9, 10, 50, 99, 100, 999, 1000, 1582, 1899, 1900, 1969, 1970, 1999, 2000, 2023, 2024, 2100, 9998, 9999];
const DAYS = [1, 9, 10, 27, 28, 29, 30, 31];
/** Latest and earliest instants a Date can hold, and the years they fall in. */
const MAX_TIME = 8.64e15;
/** The last instant that still fits the four-digit year format. */
const LAST_PLAIN_YEAR = Date.parse("9999-12-31T23:59:59.999Z");
const FIRST_PLAIN_YEAR = Date.parse("0000-01-01T00:00:00.000Z");

describe("formatIso", () => {
  test("matches the built-in for every value of every time field", () => {
    const dates: Date[] = [];
    for (let ms = 0; ms < 1000; ms++) dates.push(utcDate(2023, 6, 15, 12, 30, 45, ms));
    for (let second = 0; second < 60; second++) dates.push(utcDate(2023, 6, 15, 12, 30, second, 7));
    for (let minute = 0; minute < 60; minute++) dates.push(utcDate(2023, 6, 15, 12, minute, 45, 7));
    for (let hour = 0; hour < 24; hour++) dates.push(utcDate(2023, 6, 15, hour, 30, 45, 7));

    expect(divergences(dates)).toEqual([]);
    expect(dates.length).toBe(1144);
  });

  test("matches the built-in across the calendar, including leap years and short years", () => {
    const dates: Date[] = [];
    for (const year of YEARS) {
      for (let month = 1; month <= 12; month++) {
        for (const day of DAYS) dates.push(utcDate(year, month, day));
      }
    }

    expect(divergences(dates)).toEqual([]);
    expect(dates.length).toBe(YEARS.length * 12 * DAYS.length);
    // The cases a format-only implementation gets wrong.
    expect(formatIso(utcDate(50, 1, 1))).toBe("0050-01-01T03:04:05.006Z");
    expect(formatIso(utcDate(999, 12, 31))).toBe("0999-12-31T03:04:05.006Z");
    expect(formatIso(utcDate(2024, 2, 29))).toBe("2024-02-29T03:04:05.006Z");
  });

  test("matches the built-in at the edges of the representable range", () => {
    const edges: Date[] = [
      new Date(0),
      new Date(-1),
      new Date(1),
      new Date(FIRST_PLAIN_YEAR),
      new Date(LAST_PLAIN_YEAR),
      new Date(LAST_PLAIN_YEAR + 1),   // first instant of the expanded-year format
      new Date(FIRST_PLAIN_YEAR - 1),  // last instant before year zero
      new Date("+010000-01-01T00:00:00.000Z"),
      new Date("-000001-12-31T23:59:59.999Z"),
      new Date(MAX_TIME),
      new Date(-MAX_TIME),
    ];

    expect(divergences(edges)).toEqual([]);
    // The guard hands the expanded notation back to the built-in rather than
    // inventing a format for it.
    expect(formatIso(new Date(LAST_PLAIN_YEAR + 1))).toBe("+010000-01-01T00:00:00.000Z");
    expect(formatIso(new Date(FIRST_PLAIN_YEAR - 1))).toBe("-000001-12-31T23:59:59.999Z");
    expect(formatIso(new Date(LAST_PLAIN_YEAR))).toBe("9999-12-31T23:59:59.999Z");
  });

  test("matches the built-in over a random corpus, on both sides of the guard", () => {
    const inRange: Date[] = [];
    for (let index = 0; index < 100_000; index++) {
      inRange.push(new Date(FIRST_PLAIN_YEAR + Math.floor(Math.random() * (LAST_PLAIN_YEAR - FIRST_PLAIN_YEAR))));
    }
    const wholeRange: Date[] = [];
    for (let index = 0; index < 50_000; index++) {
      wholeRange.push(new Date(Math.floor((Math.random() - 0.5) * 2 * MAX_TIME)));
    }

    expect(divergences(inRange)).toEqual([]);
    expect(divergences(wholeRange)).toEqual([]);
  });

  test("throws exactly what the built-in throws for an invalid date", () => {
    const invalid = [new Date(NaN), new Date("not-a-date"), new Date(MAX_TIME + 1)];
    for (const date of invalid) {
      expect(() => date.toISOString()).toThrow(RangeError);
      expect(() => formatIso(date)).toThrow(RangeError);
    }
  });

  test("keeps dynamic dispatch for a Date subclass", () => {
    class StubbornDate extends Date {
      override toISOString(): string { return "OVERRIDDEN"; }
    }
    class PlainSubclass extends Date {}
    const overridden = new StubbornDate(1700000000000);
    const plain = new PlainSubclass(1700000000000);

    expect(formatIso(overridden)).toBe("OVERRIDDEN");
    expect(formatIso(plain)).toBe(plain.toISOString());
  });

  test("leaves the date it reads untouched", () => {
    const date = new Date(1700000000000);
    const before = date.getTime();

    expect(formatIso(date)).toBe(formatIso(date));
    expect(date.getTime()).toBe(before);
    expect(date).toBeInstanceOf(Date);
    expect(Object.keys(date)).toEqual([]);
  });

  test("is independent of the local time zone", async () => {
    // process.env.TZ is process-wide and the suite runs files in parallel, so
    // the sweep goes to a child process instead of mutating this one.
    const utils = new URL("../src/utils.ts", import.meta.url).pathname;
    const script = `
      const { formatIso } = await import(${JSON.stringify(utils)});
      const zones = ["UTC", "America/New_York", "Asia/Kathmandu", "Pacific/Chatham", "Australia/Lord_Howe", "Pacific/Kiritimati"];
      const times = [];
      for (let i = 0; i < 20000; i++) times.push(Math.floor((Math.random() - 0.5) * 2 * 8.64e12));
      times.push(0, 8.64e15, -8.64e15, Date.parse("0050-06-15T00:00:00.000Z"));
      const report = [];
      for (const zone of zones) {
        process.env.TZ = zone;
        const offset = -new Date().getTimezoneOffset();
        let bad = 0;
        for (const time of times) {
          const date = new Date(time);
          if (formatIso(date) !== date.toISOString()) bad++;
        }
        report.push({ zone, offset, compared: times.length, bad });
      }
      console.log(JSON.stringify(report));
    `;
    const child = Bun.spawn(["bun", "-e", script], { stdout: "pipe", stderr: "pipe" });
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);

    const report = JSON.parse(output.trim().split("\n").at(-1)!) as { zone: string; offset: number; compared: number; bad: number }[];
    expect(report).toHaveLength(6);
    for (const zone of report) expect({ ...zone, bad: 0 }).toEqual(zone);
    // The sweep is only meaningful if the zones really did differ, including
    // the 45-minute offsets.
    expect(new Set(report.map((zone) => zone.offset)).size).toBe(6);
    expect(report.some((zone) => zone.offset % 60 !== 0)).toBe(true);
  });
});

describe("the ORM emits ISO strings through formatIso alone", () => {
  // A four-digit year that needs padding: any path that still called the
  // built-in in its own way would print it differently.
  const padded = utcDate(50, 6, 15, 1, 2, 3, 4);
  const expected = "0050-06-15T01:02:03.004Z";

  test("serialization, driver rendering and SQL escaping all agree", () => {
    expect(formatIso(padded)).toBe(expected);
    expect(serializeDate(padded)).toBe(expected);
    expect(serializeRowDates({ created_at: padded }).created_at).toBe(expected);
    expect(formatDateForDriver(padded, "sqlite")).toBe(expected);
    expect(formatDateForDriver(padded, "postgres")).toBe(expected);
    expect(formatDateForDriver(padded, "mysql")).toBe("0050-06-15 01:02:03.004");
    expect(new SQLiteGrammar().escape(padded)).toBe(`'${expected}'`);
  });

  test("the timestamps a model writes have the same shape", () => {
    const stamp = new Model().freshTimestamp();

    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(formatIso(new Date(stamp))).toBe(stamp);
  });

  test("no source file formats a date on its own", async () => {
    async function walk(directory: string): Promise<string[]> {
      const files: string[] = [];
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await walk(full));
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
      return files;
    }

    const offenders: string[] = [];
    for (const file of await walk("src")) {
      // utils.ts holds formatIso, whose guard is the one sanctioned caller.
      if (file.endsWith(join("src", "utils.ts"))) continue;
      const source = await readFile(file, "utf8");
      source.split("\n").forEach((line, index) => {
        if (line.includes(".toISOString(")) offenders.push(`${file}:${index + 1}`);
      });
    }

    expect(offenders).toEqual([]);
  });
});
