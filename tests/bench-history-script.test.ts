import { expect, test } from "bun:test";
import { parseMetrics, summarize } from "../scripts/benchmark-history.js";

test("benchmark history parses measurements and compares matching runs", () => {
  const metrics = parseMetrics("bun test\nCEILING rows=20000 model_ms=30 model_factor=3\nCASTPLAN phase=get rows=20000 getCastDefinition=0.00/row\n");
  expect(metrics).toEqual({
    "CEILING rows=20000 model_ms": 30,
    "CEILING rows=20000 model_factor": 3,
    "CASTPLAN phase=get rows=20000 getCastDefinition": 0,
  });
  expect(summarize([{ ms: 9 }, { ms: 1 }, { ms: 4 }])).toEqual({ ms: { median: 4, min: 1, max: 9 } });
  expect(summarize([{ ms: 1 }, { ms: 4 }]).ms.median).toBe(2.5);
  expect(() => parseMetrics("0 pass, 0 fail")).toThrow("No benchmark metrics");
  expect(() => parseMetrics("CEILING rows=1 ms=1\nCEILING rows=1 ms=2")).toThrow("Duplicate");
  expect(() => summarize([{ ms: 1 }, { other: 2 }])).toThrow("metrics changed");
  expect(() => summarize([{ ms: NaN }])).toThrow("Non-finite");
});
