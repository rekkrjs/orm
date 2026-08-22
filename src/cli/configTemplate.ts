/**
 * Renders the `orm.config.ts` written by `orm init`.
 *
 * Every value that comes from a prompt is emitted with JSON.stringify rather
 * than interpolated: an answer containing a quote would break the generated
 * file, and one containing `${...}` would be evaluated as a template expression
 * the moment the config is imported.
 */
export function buildOrmConfigTemplate(opts: {
  databaseUrl: string;
  migrationsPath: string;
  seedersPath: string;
  modelsPath: string;
  enableTenancy: boolean;
  enableSearch: boolean;
  enableQueue: boolean;
  enableCache: boolean;
  enableLogs: boolean;
  commandsPath: string;
}): string {
  const lines: string[] = [
    `import type { OrmConfig } from "@rekkr/orm";`,
    "",
    "const config: OrmConfig = {",
    "  connection: {",
    "    // Update this to your database URL.",
    '    // Examples: "sqlite://./database/app.db", "postgres://user:pass@localhost:5432/app"',
    // JSON.stringify, not interpolation: a prompt answer containing a quote or
    // a ${...} would otherwise break the generated file, or worse, be executed
    // as a template expression the moment the config is imported.
    `    url: process.env.DATABASE_URL || ${JSON.stringify(opts.databaseUrl)},`,
    "  },",
    `  migrationsPath: ${JSON.stringify(opts.migrationsPath)},`,
    `  seedersPath: ${JSON.stringify(opts.seedersPath)},`,
    `  modelsPath: ${JSON.stringify(opts.modelsPath)},`,
    `  commands: { commandsPath: ${JSON.stringify(opts.commandsPath)} },`,
  ];

  if (opts.enableLogs) {
    lines.push(
      "  log: {",
      "    console: true,",
      '    // file: "./storage/logs/sql.log",',
      "  },",
    );
  }

  if (opts.enableTenancy) {
    lines.push(
      "  tenancy: {",
      "    // Replace with your own resolver and tenant lister.",
      "    // resolveTenant: async () => null,",
      "    // listTenants: async () => [\"tenant-1\"],",
      "    idleTimeoutMs: 300_000,",
      "  },",
    );
  }

  if (opts.enableSearch) {
    lines.push(
      "  search: {",
      "    engine: \"sqlite\",",
      "    chunk: 500,",
      ...(opts.enableTenancy
        ? [
          "    // Keep search indexes tenant-scoped when tenancy is enabled.",
          "    tenantScope: (base, tenantId) => tenantId ? `${base}_t_${tenantId}` : base,",
        ]
        : []),
      "    // For Meilisearch, switch engine and set host/apiKey:",
      "    // engine: \"meilisearch\",",
      "    // host: process.env.MEILISEARCH_HOST || \"http://127.0.0.1:7700\",",
      "    // apiKey: process.env.MEILISEARCH_API_KEY,",
      "  },",
    );
  }

  if (opts.enableQueue) {
    lines.push(
      "  queue: {",
      "    driver: \"db\",",
      "    defaultQueue: \"default\",",
      "    workers: 1,",
      "    jobsPath: \"./app/jobs\",",
      "  },",
    );
  }

  if (opts.enableCache) {
    lines.push(
      "  cache: {",
      "    // Default is Redis cache store from Bun's Redis client.",
      "    prefix: \"orm:\",",
      "    defaultTtl: 3600,",
      "  },",
    );
  }

  lines.push("};", "", "export default config;", "");
  return lines.join("\n");
}
