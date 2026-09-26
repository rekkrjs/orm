import { describe, expect, test, beforeEach } from "./harness.js";
import { mkdir, rm, writeFile } from "fs/promises";
import { join, relative } from "path";
import { Model, Schema } from "../src/index.js";
import { Search } from "../src/search/index.js";
import type { SearchEngine, SearchableRecord } from "../src/search/index.js";
import { importModel } from "../src/search/commands/importHelper.js";
import { loadSearchableModels, resolveSearchableModel } from "../src/search/commands/resolveSearchableModel.js";
import { setupTestDb } from "./helpers.js";

class TrackingEngine implements SearchEngine {
  updates: SearchableRecord[] = [];
  deletes: SearchableRecord[] = [];
  flushed: string[] = [];
  created: Array<{ name: string; options?: Record<string, unknown> }> = [];
  deletedIndexes: string[] = [];

  async update(r: SearchableRecord[]) { this.updates.push(...r); }
  async delete(r: SearchableRecord[]) { this.deletes.push(...r); }
  async search() { return []; }
  async paginate() { return { hits: [], total: 0, page: 1, perPage: 10 }; }
  async flush(index: string) { this.flushed.push(index); }
  async createIndex(name: string, options?: Record<string, unknown>) { this.created.push({ name, options }); }
  async deleteIndex(name: string) { this.deletedIndexes.push(name); }
  async updateIndexSettings() {}
  async health() { return { status: "ok" }; }
}

class _Widget extends Model.define<{ id: number; name: string }>("widgets") {
  static fillable = ["name"];
}
const Widget = Search.register(_Widget, { index: "widgets_v1" });

async function setup(): Promise<TrackingEngine> {
  setupTestDb();
  await Schema.create("widgets", (t) => { t.increments("id"); t.string("name"); t.timestamps(); });
  const engine = new TrackingEngine();
  Search.reset();
  Search.configure({ engine });
  Search.register(_Widget, { index: "widgets_v1" });
  return engine;
}

const ctx = { info: () => {}, warn: () => {} };
const FAKE_CONFIG = { connection: { url: "sqlite://:memory:" } } as any;

describe("Search command helpers", () => {
  beforeEach(() => Search.reset());

  test("importModel pushes records in chunks", async () => {
    const engine = await setup();
    for (let i = 0; i < 5; i++) await Widget.create({ name: `w${i}` } as any);
    engine.updates.length = 0;

    const result = await importModel(FAKE_CONFIG, Widget as any, { chunk: 2, dryRun: false }, ctx);
    expect(result.total).toBe(5);
    expect(result.chunks).toBe(3);
    expect(engine.updates).toHaveLength(5);
  });

  test("importModel dry-run counts without pushing", async () => {
    const engine = await setup();
    for (let i = 0; i < 3; i++) await Widget.create({ name: `w${i}` } as any);
    engine.updates.length = 0;

    const result = await importModel(FAKE_CONFIG, Widget as any, { chunk: 10, dryRun: true }, ctx);
    expect(result.total).toBe(3);
    expect(engine.updates).toHaveLength(0);
  });

  test("resolveSearchableModel finds default Search.define exports by file name", async () => {
    const dir = join(process.cwd(), "tests", `temp_search_models_${Date.now()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "Student.ts"),
      [
        `import { Model } from "../../src/index.js";`,
        `import { Search } from "../../src/search/index.js";`,
        ``,
        `class _Student extends Model.define<{ id: number; name: string }>("students") {}`,
        ``,
        `const Student = Search.define(_Student, { index: "students" });`,
        `export default Student;`,
        ``,
      ].join("\n"),
      "utf-8",
    );

    try {
      const config = { modelsPath: relative(process.cwd(), dir) } as any;
      expect(await resolveSearchableModel(config, "Student")).toBeDefined();
      expect(await resolveSearchableModel(config, "_Student")).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Searchable model discovery", () => {
  // search:status, search:verify and search:sync-index-settings walk this list,
  // so a class reachable under several export names must appear once.
  test("lists each searchable class once, whatever names it is exported under", async () => {
    const dir = join(process.cwd(), "tests", `temp_search_discovery_${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const orm = [`import { Model } from "../../src/index.js";`, `import { Search } from "../../src/search/index.js";`];
    await writeFile(join(dir, "Post.ts"), [
      ...orm,
      `export class PostRecord extends Model { static override table = "posts"; }`,
      `export const Post = Search.register(PostRecord, { index: "posts_v2" });`,
      `export default Post;`,
    ].join("\n"), "utf-8");
    await writeFile(join(dir, "Tag.ts"), [
      ...orm,
      `export class Tag extends Model {}`,
      `Search.register(Tag, { index: "tags" });`,
      `export class Plain extends Model {}`,
    ].join("\n"), "utf-8");

    try {
      const config = { modelsPath: relative(process.cwd(), dir) } as any;
      const models = await loadSearchableModels(config);
      expect(models.map((model) => model.searchableAs()).sort()).toEqual(["posts_v2", "tags"]);

      const post = await resolveSearchableModel(config, "Post");
      expect(post?.searchableAs()).toBe("posts_v2");
      expect(await resolveSearchableModel(config, "PostRecord")).toBe(post);
      expect(await resolveSearchableModel(config, "Plain")).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Search index lifecycle via engine", () => {
  beforeEach(() => Search.reset());

  test("create + delete index hit engine methods", async () => {
    const engine = await setup();
    const index = (Widget as any).searchableAs();

    await Search.engine().createIndex(index, { primaryKey: "id" });
    expect(engine.created).toEqual([{ name: "widgets_v1", options: { primaryKey: "id" } }]);

    await Search.engine().deleteIndex(index);
    expect(engine.deletedIndexes).toEqual(["widgets_v1"]);
  });

  test("reimport sequence: flush then import", async () => {
    const engine = await setup();
    for (let i = 0; i < 4; i++) await Widget.create({ name: `w${i}` } as any);
    engine.updates.length = 0;

    const index = (Widget as any).searchableAs();
    await Search.engine().flush(index);
    expect(engine.flushed).toContain("widgets_v1");

    const result = await importModel(FAKE_CONFIG, Widget as any, { chunk: 100, dryRun: false }, ctx);
    expect(result.total).toBe(4);
    expect(engine.updates).toHaveLength(4);
  });
});
