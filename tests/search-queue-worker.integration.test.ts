import { afterAll, beforeAll, describe, expect, test, writeText, ormCli, ormModule, runProcess } from "./harness.js";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { pathToFileURL } from "url";

// The documented search flow runs in separate processes that share nothing but
// the database: `orm search:create-index`, the application that saves records
// and dispatches search jobs, and the `orm queue` worker that indexes them.
// None of them is told the index schema: the model declares no `fts`, so each
// process reads it from the model's table.

let project: string;

const run = (command: string[], timeoutMs = 10_000) => runProcess(command, { cwd: project, timeoutMs });
const script = (name: string) => [process.execPath, join(project, name)];

describe.serial("search jobs in the `orm queue` worker", () => {
  beforeAll(async () => {
    project = await mkdtemp(join(process.cwd(), "tests", ".tmp-search-worker-"));
    const orm = pathToFileURL(ormModule("src/index.ts")).href;
    const search = pathToFileURL(ormModule("src/search/index.ts")).href;

    await writeText(join(project, "orm.config.js"), `
export default {
  connection: { url: ${JSON.stringify(`sqlite://${join(project, "app.sqlite")}`)} },
  modelsPath: ${JSON.stringify(join(project, "models"))},
  queue: { driver: "db", pollIntervalMs: 10 },
  search: { engine: "sqlite", queue: { name: "search" } },
};
`);
    await writeText(join(project, "models", "Article.mjs"), `
import { Model } from ${JSON.stringify(orm)};
import { Search } from ${JSON.stringify(search)};

class ArticleRecord extends Model.define("articles") {
  static fillable = ["title", "status"];
  static timestamps = false;
}
export const Article = Search.register(ArticleRecord);
`);
    await writeText(join(project, "setup.mjs"), `
import { ConnectionManager, Schema, configureOrm } from ${JSON.stringify(orm)};
import { DatabaseQueueDriver } from ${JSON.stringify(pathToFileURL(ormModule("src/queue/DatabaseQueueDriver.ts")).href)};
import config from "./orm.config.js";
const { connection } = configureOrm(config);
await Schema.create("articles", (t) => { t.increments("id"); t.string("title"); t.string("status"); });
await new DatabaseQueueDriver(connection).migrate();
await ConnectionManager.closeAll();
`);
    await writeText(join(project, "write.mjs"), `
import { ConnectionManager, configureOrm } from ${JSON.stringify(orm)};
import config from "./orm.config.js";
import { Article } from "./models/Article.mjs";
const { connection } = configureOrm(config);
await Article.create({ title: "Rust ownership", status: "published" });
await Article.create({ title: "Go channels", status: "published" });
const [{ c }] = await connection.query("SELECT COUNT(*) AS c FROM jobs");
console.log(JSON.stringify({ jobs: Number(c) }));
await ConnectionManager.closeAll();
`);
    await writeText(join(project, "read.mjs"), `
import { ConnectionManager, configureOrm } from ${JSON.stringify(orm)};
import config from "./orm.config.js";
import { Article } from "./models/Article.mjs";
const { connection } = configureOrm(config);
const hits = await Article.search("rust").raw();
const [{ c }] = await connection.query("SELECT COUNT(*) AS c FROM jobs");
console.log(JSON.stringify({ ids: hits.map((h) => h.id), titles: hits.map((h) => h.data.title), jobs: Number(c) }));
await ConnectionManager.closeAll();
`);
  });

  afterAll(async () => {
    await rm(project, { recursive: true, force: true });
  });

  test("create-index, write, work the queue and search, each in its own process", async () => {
    const setup = await run(script("setup.mjs"));
    expect(setup.stderr).toBe("");
    expect(setup.exitCode).toBe(0);

    const create = await run([...ormCli, "search:create-index", "Article"]);
    expect(create.stderr).toBe("");
    expect(create.exitCode).toBe(0);

    const write = await run(script("write.mjs"));
    expect(write.stderr).toBe("");
    expect(JSON.parse(write.stdout)).toEqual({ jobs: 2 });

    // The worker runs until stopped; give it time to drain two jobs.
    const worker = await run([...ormCli, "queue", "--queue=search"], 2_000);
    expect(worker.stderr).toBe("");
    expect(worker.stdout).not.toContain("failed");

    const read = await run(script("read.mjs"));
    expect(read.stderr).toBe("");
    expect(JSON.parse(read.stdout)).toEqual({ ids: [1], titles: ["Rust ownership"], jobs: 0 });
  }, 30_000);
});
