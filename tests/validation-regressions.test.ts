import { describe, test, expect } from "./harness.js";
import { rule, Validator } from "../src/validation/index.js";

const errorsFor = (data: any, schema: any, messages?: Record<string, string>) => {
  const validator = Validator.make(data, schema);
  if (messages) validator.messages(messages);
  return validator.errors();
};

describe("cross-field references under wildcards", () => {
  test("same('*.end') resolves against the row being validated", async () => {
    const errors = await errorsFor(
      { ranges: [{ start: "a", end: "a" }, { start: "b", end: "z" }] },
      { "ranges.*.start": rule().same("*.end") },
    );
    expect(Object.keys(errors)).toEqual(["ranges.1.start"]);
  });

  test("a fully qualified reference keeps working and is not double-prefixed", async () => {
    const errors = await errorsFor(
      { ranges: [{ start: "a", end: "a" }, { start: "b", end: "z" }] },
      { "ranges.*.start": rule().same("ranges.*.end") },
    );
    expect(Object.keys(errors)).toEqual(["ranges.1.start"]);
  });

  test("references resolve under a nested wildcard prefix", async () => {
    const errors = await errorsFor(
      { form: { rows: [{ a: "1", b: "1" }, { a: "1", b: "2" }] } },
      { "form.rows.*.a": rule().same("*.b") },
    );
    expect(Object.keys(errors)).toEqual(["form.rows.1.a"]);
  });
});

describe("presence rules under wildcards", () => {
  test("required fires for a key that is absent from a row", async () => {
    const errors = await errorsFor({ items: [{ isbn: "x" }, {}] }, { "items.*.isbn": rule().required() });
    expect(Object.keys(errors)).toEqual(["items.1.isbn"]);
  });

  test("requiredIf('*.type', ...) fires on the matching row only", async () => {
    const errors = await errorsFor(
      { items: [{ type: "book" }, { type: "dvd" }] },
      { "items.*.isbn": rule().requiredIf("*.type", "book") },
    );
    expect(Object.keys(errors)).toEqual(["items.0.isbn"]);
  });

  test("a missing collection requires nothing of rows that do not exist", async () => {
    expect(await errorsFor({}, { "items.*.isbn": rule().required() })).toEqual({});
  });

  test("non-presence rules still skip absent keys", async () => {
    expect(await errorsFor({ items: [{}] }, { "items.*.isbn": rule().string() })).toEqual({});
  });
});

describe("numeric comparisons", () => {
  test("numeric strings compare by value, not by length", async () => {
    expect(await Validator.make({ n: "91" }, { n: rule().gt("15") }).passes()).toBe(true);
    expect(await Validator.make({ n: "-5" }, { n: rule().gt("3") }).passes()).toBe(false);
    expect(await Validator.make({ n: "9" }, { n: rule().gt("10") }).passes()).toBe(false);
    expect(await Validator.make({ n: "10" }, { n: rule().gte("10") }).passes()).toBe(true);
    expect(await Validator.make({ n: "5" }, { n: rule().lt("42") }).passes()).toBe(true);
    expect(await Validator.make({ n: "7.5" }, { n: rule().lte("7.5") }).passes()).toBe(true);
  });

  test("genuine text still compares by length", async () => {
    expect(await Validator.make({ n: "abcd" }, { n: rule().gt("abc") }).passes()).toBe(true);
    expect(await Validator.make({ n: "ab" }, { n: rule().gt("abc") }).passes()).toBe(false);
  });
});

describe("distinct", () => {
  test("catches duplicates in a flat array", async () => {
    expect(await Validator.make({ tags: [1, 2, 2] }, { tags: rule().distinct() }).passes()).toBe(false);
    expect(await Validator.make({ tags: [1, 2, 3] }, { tags: rule().distinct() }).passes()).toBe(true);
  });

  test("distinguishes objects by content, and 1 from '1'", async () => {
    expect(await Validator.make({ tags: [{ a: 1 }, { a: 1 }] }, { tags: rule().distinct() }).passes()).toBe(false);
    expect(await Validator.make({ tags: [1, "1"] }, { tags: rule().distinct() }).passes()).toBe(true);
  });

  test("the wildcard form is unchanged", async () => {
    const errors = await errorsFor({ t: [{ n: "x" }, { n: "x" }] }, { "t.*.n": rule().distinct() });
    expect(Object.keys(errors)).toEqual(["t.0.n", "t.1.n"]);
  });
});

describe("IP validation", () => {
  test("accepts real addresses, including IPv4-mapped IPv6", async () => {
    for (const ip of ["::1", "::ffff:192.168.0.1", "2001:db8::8a2e:370:7334", "1.2.3.4"]) {
      expect(await Validator.make({ a: ip }, { a: rule().ip() }).passes()).toBe(true);
    }
  });

  test("rejects the shapes the old regexes let through", async () => {
    for (const ip of [":::", "1.2.3.4.", "999.1.1.1", "not:an:ip", "::ggg"]) {
      expect(await Validator.make({ a: ip }, { a: rule().ip() }).passes()).toBe(false);
    }
  });

  test("ipv4 and ipv6 discriminate correctly", async () => {
    expect(await Validator.make({ a: "1.2.3.4" }, { a: rule().ipv4() }).passes()).toBe(true);
    expect(await Validator.make({ a: "::1" }, { a: rule().ipv4() }).passes()).toBe(false);
    expect(await Validator.make({ a: "::ffff:192.168.0.1" }, { a: rule().ipv6() }).passes()).toBe(true);
    expect(await Validator.make({ a: "1.2.3.4" }, { a: rule().ipv6() }).passes()).toBe(false);
  });
});

describe("custom messages", () => {
  test(":attribute is interpolated in an override", async () => {
    const errors = await errorsFor({ email: "" }, { email: rule().required() }, { "email.required": "The :attribute is mandatory." });
    expect(errors.email?.[0]).toBe("The email is mandatory.");
  });

  test("a wildcard override interpolates the concrete attribute", async () => {
    const errors = await errorsFor(
      { items: [{ name: "" }] },
      { "items.*.name": rule().required() },
      { "items.*.name": "Missing :attribute." },
    );
    expect(errors["items.0.name"]?.[0]).toBe("Missing items.0.name.");
  });

  test("an unknown placeholder is left alone", async () => {
    const errors = await errorsFor({ email: "" }, { email: rule().required() }, { email: "Bad :nonsense here." });
    expect(errors.email?.[0]).toBe("Bad :nonsense here.");
  });
});

describe("multipleOf", () => {
  test("decimal divisors work despite IEEE-754", async () => {
    expect(await Validator.make({ a: 0.3 }, { a: rule().multipleOf(0.1) }).passes()).toBe(true);
    expect(await Validator.make({ a: 0.9 }, { a: rule().multipleOf(0.3) }).passes()).toBe(true);
    expect(await Validator.make({ a: 0.35 }, { a: rule().multipleOf(0.1) }).passes()).toBe(false);
  });

  test("integers are unaffected and a zero divisor fails", async () => {
    expect(await Validator.make({ a: 10 }, { a: rule().multipleOf(5) }).passes()).toBe(true);
    expect(await Validator.make({ a: 10 }, { a: rule().multipleOf(3) }).passes()).toBe(false);
    expect(await Validator.make({ a: 10 }, { a: rule().multipleOf(0) }).passes()).toBe(false);
  });

  test("values in exponential notation scale correctly", async () => {
    // String(1e-8) is "1e-8" — no decimal point at all — so reading decimals
    // off the literal reported 0 places and collapsed the scaling.
    expect(await Validator.make({ a: 1.1e-7 }, { a: rule().multipleOf(1e-8) }).passes()).toBe(true);
    expect(await Validator.make({ a: 1.2e-7 }, { a: rule().multipleOf(1e-8) }).passes()).toBe(true);
    expect(await Validator.make({ a: 3e-20 }, { a: rule().multipleOf(1e-20) }).passes()).toBe(true);
    expect(await Validator.make({ a: 1e-8 }, { a: rule().multipleOf(3e-8) }).passes()).toBe(false);
  });
});

describe("fail-fast rule construction", () => {
  test("digitsBetween rejects swapped bounds at build time", () => {
    expect(() => rule().digitsBetween(5, 2)).toThrow(/cannot be greater than max/);
    expect(() => rule().digitsBetween(-1, 2)).toThrow(/non-negative/);
    expect(() => rule().digitsBetween(1.5, 2)).toThrow(/integers/);
    expect(() => rule().digitsBetween(2, 5)).not.toThrow();
  });

  test("password().uncompromised() refuses instead of pretending", () => {
    expect(() => rule().password((r: any) => r.uncompromised())).toThrow(/not implemented/);
  });
});

describe("URL and email strictness", () => {
  test("url() rejects non-web schemes", async () => {
    expect(await Validator.make({ a: "javascript:alert(1)" }, { a: rule().url() }).passes()).toBe(false);
    expect(await Validator.make({ a: "data:text/html,<script>" }, { a: rule().url() }).passes()).toBe(false);
    expect(await Validator.make({ a: "https://example.com/x?y=1" }, { a: rule().url() }).passes()).toBe(true);
    expect(await Validator.make({ a: "ftp://files.example.com" }, { a: rule().url() }).passes()).toBe(true);
  });

  test("email() rejects malformed domains", async () => {
    for (const email of ["a@b..com", "a@.com", "a@b.", "a@b"]) {
      expect(await Validator.make({ a: email }, { a: rule().email() }).passes()).toBe(false);
    }
    for (const email of ["a@b.com", "first.last@sub.example.co.uk"]) {
      expect(await Validator.make({ a: email }, { a: rule().email() }).passes()).toBe(true);
    }
  });
});

describe("dateFormat", () => {
  test("checks the format it was given", async () => {
    expect(await Validator.make({ d: "2026-08-21" }, { d: rule().dateFormat("Y-m-d") }).passes()).toBe(true);
    expect(await Validator.make({ d: "2026-08-21 10:30:00" }, { d: rule().dateFormat("Y-m-d H:i:s") }).passes()).toBe(true);
    expect(await Validator.make({ d: "21/08/2026" }, { d: rule().dateFormat("d/m/Y") }).passes()).toBe(true);
  });

  test("no longer accepts anything Date can parse", async () => {
    // The old fallback made dateFormat("d/m/Y") pass for an ISO timestamp.
    expect(await Validator.make({ d: "2026-08-21T10:00:00Z" }, { d: rule().dateFormat("d/m/Y") }).passes()).toBe(false);
    expect(await Validator.make({ d: "August 21, 2026" }, { d: rule().dateFormat("Y-m-d") }).passes()).toBe(false);
  });

  test("an unsupported format is refused at build time", () => {
    expect(() => rule().dateFormat("D, d M Y H:i:s O")).toThrow(/unsupported format/);
  });

  test("rejects well-formed values that are not real dates or times", async () => {
    // Shape alone is not validity: these all match their pattern.
    expect(await Validator.make({ d: "31/02/2026" }, { d: rule().dateFormat("d/m/Y") }).passes()).toBe(false);
    expect(await Validator.make({ d: "2026-99-99" }, { d: rule().dateFormat("Y-m-d") }).passes()).toBe(false);
    expect(await Validator.make({ d: "2026-13-01" }, { d: rule().dateFormat("Y-m-d") }).passes()).toBe(false);
    expect(await Validator.make({ d: "99:99:99" }, { d: rule().dateFormat("H:i:s") }).passes()).toBe(false);
    expect(await Validator.make({ d: "24:00" }, { d: rule().dateFormat("H:i") }).passes()).toBe(false);
  });

  test("handles leap years", async () => {
    expect(await Validator.make({ d: "29/02/2024" }, { d: rule().dateFormat("d/m/Y") }).passes()).toBe(true);
    expect(await Validator.make({ d: "29/02/2023" }, { d: rule().dateFormat("d/m/Y") }).passes()).toBe(false);
    expect(await Validator.make({ d: "2000-02-29" }, { d: rule().dateFormat("Y-m-d") }).passes()).toBe(true);
    expect(await Validator.make({ d: "1900-02-29" }, { d: rule().dateFormat("Y-m-d") }).passes()).toBe(false);
  });

  test("the ISO format is anchored at both ends", async () => {
    expect(await Validator.make({ d: "2026-08-21T10:30:00Z" }, { d: rule().dateFormat("c") }).passes()).toBe(true);
    expect(await Validator.make({ d: "2026-08-21T10:30:00.123+02:00" }, { d: rule().dateFormat("c") }).passes()).toBe(true);
    // Previously /^\d{4}-\d{2}-\d{2}T/ let any trailing payload through.
    expect(await Validator.make({ d: "2026-99-99Tgarbage" }, { d: rule().dateFormat("c") }).passes()).toBe(false);
    expect(await Validator.make({ d: "2026-08-21T10:30:00Z junk" }, { d: rule().dateFormat("c") }).passes()).toBe(false);
  });
});

describe("unique().ignoreField", () => {
  test("a null id means 'nothing to ignore', not 'skip the check'", async () => {
    const { UniqueRule } = await import("../src/validation/rules.js");
    const issued: string[] = [];
    const rule = new UniqueRule("users", "email").ignoreField("id");
    const ctx: any = {
      attribute: "email",
      pattern: "email",
      data: { email: "a@b.com", id: null },
      get: (path: string) => ({ email: "a@b.com", id: null } as any)[path],
      has: () => true,
      connection: {
        getGrammar: () => ({ placeholder: (i: number) => `$${i}` }),
        qualifyTable: (t: string) => t,
        quoteIdentifier: (i: string) => `"${i}"`,
        query: async (sql: string) => { issued.push(sql); return []; },
      },
    };

    await rule.validate("a@b.com", ctx);
    // `id <> NULL` is NULL for every row, so the query matched nothing and
    // uniqueness silently passed for everyone.
    expect(issued[0]).not.toContain("<>");
  });

  test("a real id is still excluded", async () => {
    const { UniqueRule } = await import("../src/validation/rules.js");
    const issued: string[] = [];
    const rule = new UniqueRule("users", "email").ignoreField("id");
    const ctx: any = {
      attribute: "email",
      pattern: "email",
      data: { email: "a@b.com", id: 7 },
      get: (path: string) => ({ email: "a@b.com", id: 7 } as any)[path],
      has: () => true,
      connection: {
        getGrammar: () => ({ placeholder: (i: number) => `$${i}` }),
        qualifyTable: (t: string) => t,
        quoteIdentifier: (i: string) => `"${i}"`,
        query: async (sql: string) => { issued.push(sql); return []; },
      },
    };

    await rule.validate("a@b.com", ctx);
    expect(issued[0]).toContain('"id" <> $2');
  });
});
