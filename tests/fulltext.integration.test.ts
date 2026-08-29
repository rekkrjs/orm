import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Builder, Schema } from "../src/index.js";
import { createDriverContext, serverUrl, type DriverContext, type ServerDriver } from "./driver-harness.js";

function nativeFullTextSuite(driver: ServerDriver) {
  const run = serverUrl(driver) ? test.serial : test.skip;

  describe.serial(`${driver} native full-text`, () => {
    let context: DriverContext;

    beforeAll(async () => {
      if (serverUrl(driver)) context = await createDriverContext(driver);
    });

    afterAll(async () => {
      await context?.dispose();
    });

    run("creates, queries, explains, introspects, and reverses a native index", async () => {
      const connection = context.connection;
      await Schema.create("fulltext_articles", (table) => {
        table.id();
        table.text("title");
        table.text("body").nullable();
        table.boolean("published");
        table.index("published", "fulltext_articles_published_index");
        const index = table.fullText(["title", "body"]);
        if (driver === "postgres") index.language("simple");
      }, connection);
      await new Builder(connection, "fulltext_articles").insert([
        { title: "rekkralpha buscador", body: "bun database toolkit", published: true },
        { title: "segundo articulo", body: "rekkrbeta legacy", published: true },
        { title: "rekkrnull", body: null, published: true },
        { title: "oculto", body: "unrelated material", published: false },
      ]);

      const options = driver === "postgres" ? { language: "simple" as const } : {};
      const matched = await new Builder(connection, "fulltext_articles")
        .whereFullText(["title", "body"], "rekkralpha", options)
        .get();
      expect(matched.map((row: any) => row.title)).toEqual(["rekkralpha buscador"]);

      const nullSafe = await new Builder(connection, "fulltext_articles")
        .whereFullText(["title", "body"], "rekkrnull", options)
        .get();
      expect(nullSafe.map((row: any) => row.title)).toEqual(["rekkrnull"]);

      const combined = await new Builder(connection, "fulltext_articles")
        .where("published", false)
        .orWhereFullText(["title", "body"], "rekkrbeta", options)
        .orderBy("id")
        .get();
      expect(combined.map((row: any) => row.title)).toEqual(["segundo articulo", "oculto"]);

      if (driver === "mysql") {
        expect(await new Builder(connection, "fulltext_articles")
          .whereFullText(["title", "body"], "+rekkralpha -legacy", { mode: "boolean" })
          .count()).toBe(1);
      } else {
        expect(await new Builder(connection, "fulltext_articles")
          .whereFullText(["title", "body"], "rekkralpha buscador", { ...options, mode: "phrase" })
          .count()).toBe(1);
        expect(await new Builder(connection, "fulltext_articles")
          .whereFullText(["title", "body"], "rekkralpha -legacy", { ...options, mode: "websearch" })
          .count()).toBe(1);
        expect(await new Builder(connection, "fulltext_articles")
          .whereFullText(["title", "body"], "rekkralpha & buscador", { ...options, mode: "raw" })
          .count()).toBe(1);
      }

      const indexes = await Schema.getIndexes("fulltext_articles", connection);
      const fullText = indexes.find((index) => index.name === "fulltext_articles_title_body_fulltext");
      const ordinary = indexes.find((index) => index.name === "fulltext_articles_published_index");
      expect(fullText).toMatchObject({ unique: false, type: "fulltext" });
      expect(ordinary).toMatchObject({ columns: ["published"], type: "index" });
      if (driver === "mysql") expect(fullText?.columns).toEqual(["title", "body"]);
      else expect(fullText?.columns.join(" ")).toContain("to_tsvector");

      if (driver === "postgres") await connection.run("SET enable_seqscan = off");
      try {
        const plan = await new Builder(connection, "fulltext_articles")
          .whereFullText(["title", "body"], "rekkralpha", options)
          .explain();
        expect(JSON.stringify(plan)).toContain("fulltext_articles_title_body_fulltext");
      } finally {
        if (driver === "postgres") await connection.run("RESET enable_seqscan");
      }

      const table = driver === "postgres" ? `${context.namespace}.fulltext_articles` : "fulltext_articles";
      await Schema.table(table, (blueprint) => blueprint.dropFullText(["title", "body"]), connection);
      const afterDrop = await Schema.getIndexes("fulltext_articles", connection);
      expect(afterDrop.some((index) => index.name === "fulltext_articles_title_body_fulltext")).toBe(false);
      expect(afterDrop.find((index) => index.name === "fulltext_articles_published_index"))
        .toMatchObject({ columns: ["published"], type: "index" });

      await Schema.table(table, (blueprint) => {
        const index = blueprint.fullText("body", "fulltext_articles_body_search");
        if (driver === "postgres") index.language("simple");
      }, connection);
      expect((await Schema.getIndexes("fulltext_articles", connection))
        .find((index) => index.name === "fulltext_articles_body_search"))
        .toMatchObject({ type: "fulltext" });
      await Schema.table(table, (blueprint) => blueprint.dropFullText("fulltext_articles_body_search"), connection);
      expect((await Schema.getIndexes("fulltext_articles", connection))
        .some((index) => index.name === "fulltext_articles_body_search")).toBe(false);
    });
  });
}

nativeFullTextSuite("mysql");
nativeFullTextSuite("postgres");
