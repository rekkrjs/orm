export const POSTGRES_FULL_TEXT_LANGUAGES = [
  "simple",
  "arabic",
  "danish",
  "dutch",
  "english",
  "finnish",
  "french",
  "german",
  "hungarian",
  "indonesian",
  "irish",
  "italian",
  "lithuanian",
  "nepali",
  "norwegian",
  "portuguese",
  "romanian",
  "russian",
  "spanish",
  "swedish",
  "tamil",
  "turkish",
] as const;

export type PostgresFullTextLanguage = typeof POSTGRES_FULL_TEXT_LANGUAGES[number];

export interface FullTextOptions {
  mode?: "boolean" | "phrase" | "websearch" | "raw";
  expanded?: boolean;
  language?: PostgresFullTextLanguage;
  /** Treat each PostgreSQL column as an existing tsvector expression. */
  vector?: boolean;
}

const LANGUAGES = new Set<string>(POSTGRES_FULL_TEXT_LANGUAGES);
const MODES = new Set<string>(["boolean", "phrase", "websearch", "raw"]);
const OPTION_KEYS = new Set<keyof FullTextOptions>(["mode", "expanded", "language", "vector"]);

export function assertPostgresFullTextLanguage(value: unknown): asserts value is PostgresFullTextLanguage {
  if (typeof value !== "string" || !LANGUAGES.has(value)) {
    throw new Error(`Invalid PostgreSQL full-text language: ${String(value)}`);
  }
}

export function normalizeFullTextOptions(options: FullTextOptions | undefined): Readonly<FullTextOptions> {
  if (options === undefined) return Object.freeze({});
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Full-text options must be an object.");
  }
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.has(key as keyof FullTextOptions)) {
      throw new Error(`Unknown full-text option: ${key}`);
    }
  }
  if (options.mode !== undefined && (typeof options.mode !== "string" || !MODES.has(options.mode))) {
    throw new Error(`Invalid full-text mode: ${String(options.mode)}`);
  }
  if (options.expanded !== undefined && typeof options.expanded !== "boolean") {
    throw new Error("Full-text expanded option must be a boolean.");
  }
  if (options.vector !== undefined && typeof options.vector !== "boolean") {
    throw new Error("Full-text vector option must be a boolean.");
  }
  if (options.language !== undefined) assertPostgresFullTextLanguage(options.language);
  return Object.freeze({ ...options });
}

export function compilePostgresFullTextVector(
  columns: readonly string[],
  language: PostgresFullTextLanguage,
  vector: boolean,
): string {
  return vector
    ? columns.join(" || ")
    : columns.map((column) => `to_tsvector('${language}', coalesce(${column}, ''))`).join(" || ");
}
