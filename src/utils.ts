import { pathToFileURL } from "node:url";

/**
 * Converts a PascalCase/camelCase identifier to snake_case, keeping acronyms
 * together: `parseJSONData` becomes `parse_json_data`, not `parse_j_s_o_n_data`.
 *
 * This drives default table, foreign-key and pivot-column names, so changing it
 * changes the names generated for models whose name contains an acronym.
 */
export function snakeCase(str: string): string {
  return str
    // lower/digit followed by upper is a word boundary: parseJSON -> parse_JSON
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    // a run of capitals followed by a capitalised word: HTTPServer -> HTTP_Server
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .replace(/^_+/, "");
}

export function normalizePathList(value?: string | string[]): string[] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => item.trim()).filter((item) => item.length > 0);
}

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

const NUMERIC_COLUMN_TYPES = new Set([
  "int",
  "int2",
  "int4",
  "int8",
  "integer",
  "bigint",
  "smallint",
  "mediumint",
  "tinyint",
  "serial",
  "smallserial",
  "bigserial",
  "real",
  "float",
  "double",
  "decimal",
  "numeric",
]);

/**
 * Reduce a driver reported column type to its base name so the three drivers
 * can be compared with each other: SQLite reports the declared affinity
 * ("TEXT"), MySQL appends display widths and modifiers ("int(10) unsigned")
 * and Postgres reports multi word names ("double precision").
 */
function normalizeColumnType(type: unknown): string {
  const base = String(type ?? "").toLowerCase().split("(")[0] ?? "";
  return base.trim().split(/\s+/)[0] ?? "";
}

export function isNumericColumnType(type: unknown): boolean {
  return NUMERIC_COLUMN_TYPES.has(normalizeColumnType(type));
}

/** Length of the UUID strings `crypto.randomUUID()` produces. */
const UUID_LENGTH = 36;

/**
 * The length a column declares, when it declares one: "char(64)" -> 64. Drivers
 * that report the length separately (Postgres reports "character" plus
 * `character_maximum_length`) pass it through `column.length` instead.
 */
export function declaredColumnLength(type: unknown): number | null {
  const match = /\(\s*(\d+)/.exec(String(type ?? ""));
  return match ? Number(match[1]) : null;
}

/** Fixed-scale decimal formatting without passing exact strings through Number. */
export function formatDecimal(value: string | number | bigint, scale: number = 2): string {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new Error(`Invalid decimal scale: ${scale}`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`Invalid decimal value: ${String(value)}`);
  }

  const raw = String(value).trim();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(raw);
  if (!match || (!match[2] && !match[3])) {
    throw new Error(`Invalid decimal value: ${raw}`);
  }

  const negative = match[1] === "-";
  const integer = match[2] || "0";
  const fraction = match[3] || "";
  const exponent = Number(match[4] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10_000) {
    throw new Error(`Invalid decimal exponent: ${String(match[4])}`);
  }

  let coefficient = BigInt(`${integer}${fraction}` || "0");
  const fractionDigits = fraction.length - exponent;
  if (fractionDigits > scale) {
    const divisor = 10n ** BigInt(fractionDigits - scale);
    const remainder = coefficient % divisor;
    coefficient /= divisor;
    if (remainder * 2n >= divisor) coefficient++;
  } else if (fractionDigits < scale) {
    coefficient *= 10n ** BigInt(scale - fractionDigits);
  }

  const digits = coefficient.toString().padStart(scale + 1, "0");
  const unsigned = scale === 0
    ? digits
    : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative && coefficient !== 0n ? `-${unsigned}` : unsigned;
}

/**
 * Whether the ORM should generate a UUID for this primary key.
 *
 * Being non numeric is not enough on its own. A column with a database default
 * already has its value decided, and a column too short to hold a UUID (a
 * CHAR(26) holding ULIDs, say) would be corrupted by one — in both cases the
 * value belongs to the database or the application, not to us. Models that want
 * UUIDs regardless say so with `usesUuids` / `keyType = "uuid"`, which is
 * checked before this ever runs.
 */
export function shouldGeneratePrimaryKeyForColumn(
  column:
    | { type?: unknown; primary?: boolean; autoIncrement?: boolean; default?: unknown; length?: number | null }
    | null
    | undefined
): boolean {
  if (!column) return false;
  if (!column.primary) return false;
  if (column.autoIncrement) return false;
  if (column.default !== undefined && column.default !== null) return false;
  if (isNumericColumnType(column.type)) return false;

  const length = column.length ?? declaredColumnLength(column.type);
  return length === null || length >= UUID_LENGTH;
}

function pad2(value: number): string {
  return value < 10 ? "0" + value : "" + value;
}

function pad3(value: number): string {
  return value < 10 ? "00" + value : value < 100 ? "0" + value : "" + value;
}

function pad4(value: number): string {
  return value < 10 ? "000" + value
    : value < 100 ? "00" + value
    : value < 1000 ? "0" + value
    : "" + value;
}

/**
 * `Date.prototype.toISOString()`, three times faster on the years a database
 * stores. Every ISO string the ORM emits comes from here — serialized output,
 * timestamps it writes, values rendered into debug SQL — so the text is
 * identical whichever path produced it.
 *
 * The saving is not in the calendar arithmetic, which stays with the engine:
 * the seven `getUTC*` reads cost 4.5ns per date because JSC decomposes the
 * instant once and caches it on the object. It is the built-in's own string
 * production that costs 77ns, against 25ns for assembling the same characters
 * here.
 *
 * The one guard covers three cases that must keep the built-in: an invalid
 * date, where `toISOString()` throws a RangeError this must throw too; a year
 * outside 0000–9999, where the format becomes expanded `±YYYYYY`; and a
 * subclass carrying its own `toISOString`, which dynamic dispatch must keep
 * reaching. `NaN` fails the range comparison, which is what routes it out.
 */
export function formatIso(value: Date): string {
  const year = value.getUTCFullYear();
  if (!(year >= 0 && year <= 9999) || value.constructor !== Date) return value.toISOString();
  return pad4(year)
    + "-" + pad2(value.getUTCMonth() + 1)
    + "-" + pad2(value.getUTCDate())
    + "T" + pad2(value.getUTCHours())
    + ":" + pad2(value.getUTCMinutes())
    + ":" + pad2(value.getUTCSeconds())
    + "." + pad3(value.getUTCMilliseconds())
    + "Z";
}

/**
 * The calendar-day part of `formatIso()`, `YYYY-MM-DD`, built directly: slicing
 * the full string first flattens all fifteen pieces to keep three.
 */
export function formatIsoDate(value: Date): string {
  const year = value.getUTCFullYear();
  if (!(year >= 0 && year <= 9999) || value.constructor !== Date) {
    const iso = value.toISOString();
    return iso.slice(0, iso.indexOf("T"));
  }
  return pad4(year) + "-" + pad2(value.getUTCMonth() + 1) + "-" + pad2(value.getUTCDate());
}

/** Renders a Date for inline debug SQL; executed queries pass Date to Bun.SQL. */
export function formatDateForDriver(
  value: Date,
  driver: "sqlite" | "mysql" | "postgres" | undefined
): string {
  if (driver !== "mysql") return formatIso(value);
  // Match Bun.SQL's UTC wall-clock encoding while keeping millisecond precision.
  return formatIso(value).slice(0, 23).replace("T", " ");
}

/**
 * Naive English pluralisation for default table and pivot names.
 *
 * Covers the regular cases plus the common -y/-s/-x/-z/-ch/-sh/-f endings. It is
 * not an inflector: irregular nouns ("person", "child") and inputs that are
 * already plural ("tags" becomes "tagses", since "class" must become "classes")
 * need an explicit table name.
 */
export function pluralize(word: string): string {
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(?:f|fe)$/i.test(word)) return `${word.replace(/f(e)?$/, "ves")}`;
  return `${word}s`;
}

/**
 * Imports an application file: a migration, seeder, model, command or config.
 * Node.js runs TypeScript by stripping the types, which leaves enums,
 * namespaces, parameter properties and decorators unsupported; when that is
 * why a `.ts` file will not load, say so rather than surface a bare SyntaxError.
 */
export async function importFile(path: string): Promise<any> {
  try {
    return await import(/* @vite-ignore */ pathToFileURL(path).href);
  } catch (error) {
    const unstrippable = error instanceof SyntaxError || (error as { code?: unknown })?.code === "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX";
    if (typeof Bun !== "undefined" || !unstrippable || !/\.[cm]?ts$/.test(path)) throw error;
    throw new Error(
      `${path} could not be loaded. Node.js runs TypeScript by stripping the types, so the files it loads cannot use ` +
        `enums, namespaces, parameter properties or decorators. ${(error as Error).message}`,
      { cause: error },
    );
  }
}
