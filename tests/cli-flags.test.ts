import { describe, test, expect } from "./harness.js";
import { getFlagValue, parsePositiveInteger, readFlag } from "../src/cli/flags.js";

describe("getFlagValue", () => {
  test("reads both --flag value and --flag=value", () => {
    expect(getFlagValue(["--queue", "mail"], "--queue")).toBe("mail");
    expect(getFlagValue(["--queue=mail"], "--queue")).toBe("mail");
  });

  test("does not consume the next flag as a value", () => {
    // Previously this returned "--workers", which parseInt turned into NaN and
    // the worker silently started zero loops.
    expect(getFlagValue(["--queue", "--workers", "4"], "--queue")).toBeUndefined();
    expect(getFlagValue(["--workers", "-v"], "--workers")).toBeUndefined();
  });

  test("returns undefined for a trailing flag with nothing after it", () => {
    expect(getFlagValue(["queue", "--queue"], "--queue")).toBeUndefined();
  });

  test("returns undefined when the flag is absent", () => {
    expect(getFlagValue(["queue", "--workers", "2"], "--queue")).toBeUndefined();
  });

  test("an inline empty value stays an empty string, not undefined", () => {
    expect(getFlagValue(["--queue="], "--queue")).toBe("");
  });

  test("does not match a flag that merely shares a prefix", () => {
    expect(getFlagValue(["--queue-name=x"], "--queue")).toBeUndefined();
  });
});

describe("readFlag", () => {
  test("tells 'absent' apart from 'present without a value'", () => {
    // getFlagValue collapses both to undefined, which made `--workers` with no
    // value silently fall back to the configured default.
    expect(readFlag(["queue"], "--workers")).toEqual({ kind: "absent" });
    expect(readFlag(["queue", "--workers"], "--workers")).toEqual({ kind: "missing-value" });
    expect(readFlag(["queue", "--workers", "--queue"], "--workers")).toEqual({ kind: "missing-value" });
    expect(readFlag(["queue", "--workers", "-2"], "--workers")).toEqual({ kind: "missing-value" });
    expect(readFlag(["queue", "--workers", "4"], "--workers")).toEqual({ kind: "value", value: "4" });
    expect(readFlag(["queue", "--workers=4"], "--workers")).toEqual({ kind: "value", value: "4" });
    expect(readFlag(["queue", "--workers="], "--workers")).toEqual({ kind: "value", value: "" });
  });
});

describe("parsePositiveInteger", () => {
  test("accepts positive integers only", () => {
    expect(parsePositiveInteger("4")).toBe(4);
    expect(parsePositiveInteger(" 4 ")).toBe(4);
    expect(parsePositiveInteger("1")).toBe(1);
  });

  test("rejects what parseInt would silently truncate", () => {
    // parseInt("2x") is 2 and parseInt("1.5") is 1 — a typo would have started
    // a different number of workers than the operator asked for.
    for (const raw of ["2x", "1.5", "0", "-2", "", " ", "abc", "1e3", "+4", "٤"]) {
      expect(parsePositiveInteger(raw)).toBeUndefined();
    }
  });
});
