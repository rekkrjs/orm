/**
 * Reads the value of a CLI flag from a raw argument list, accepting both
 * `--flag value` and `--flag=value`.
 *
 * A flag-looking token is never taken as a value: `orm queue --workers
 * --queue mail` used to read "--queue" as the worker count. Callers that need
 * to tell "flag absent" from "flag given without a value" should use
 * `readFlag`, which reports the difference instead of collapsing both to
 * undefined and silently falling back to a default.
 */
export function getFlagValue(args: string[], flag: string): string | undefined {
  const result = readFlag(args, flag);
  return result.kind === "value" ? result.value : undefined;
}

export type FlagResult =
  | { kind: "absent" }
  | { kind: "value"; value: string }
  /** The flag is present but nothing usable followed it. */
  | { kind: "missing-value" };

export function readFlag(args: string[], flag: string): FlagResult {
  const idx = args.indexOf(flag);
  if (idx !== -1) {
    const next = args[idx + 1];
    if (next !== undefined && !next.startsWith("-")) return { kind: "value", value: next };
    return { kind: "missing-value" };
  }
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline !== undefined) return { kind: "value", value: inline.slice(flag.length + 1) };
  return { kind: "absent" };
}

/**
 * Parses a flag value that must be a positive integer.
 *
 * Deliberately stricter than parseInt, which reads "2x" as 2 and "1.5" as 1 —
 * a typo would silently start a different number of workers than asked for.
 */
export function parsePositiveInteger(raw: string): number | undefined {
  if (!/^\d+$/.test(raw.trim())) return undefined;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value >= 1 ? value : undefined;
}
