export class UniqueConstraintViolationError extends Error {
  constructor(options: ErrorOptions = {}) {
    super("A unique constraint was violated.", options);
    this.name = "UniqueConstraintViolationError";
  }
}

/**
 * Whether a driver error is a UNIQUE or PRIMARY KEY conflict. Reads the codes
 * the database itself reports, so bun:sql and the Node.js drivers agree:
 * bun:sql puts SQLite's symbolic code in `code` and PostgreSQL's SQLSTATE in
 * `errno`; node:sqlite puts the extended result code in `errcode`; pg and
 * mysql2 use `code`. Anything else — a connection drop, a missing table, a
 * NOT NULL or CHECK failure — is not a conflict and must surface as itself.
 */
export function isUniqueConstraintViolation(driverName: "sqlite" | "mysql" | "postgres", error: unknown): boolean {
  const { code, errno, errcode } = (error ?? {}) as { code?: unknown; errno?: unknown; errcode?: unknown };
  switch (driverName) {
    case "sqlite":
      // SQLITE_CONSTRAINT_UNIQUE (2067) and SQLITE_CONSTRAINT_PRIMARYKEY (1555).
      return code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY" || errcode === 2067 || errcode === 1555;
    case "postgres":
      return code === "23505" || errno === "23505";
    case "mysql":
      return code === "ER_DUP_ENTRY" || errno === 1062;
  }
}
