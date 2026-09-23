import { describe, expect, test } from "./harness.js";
import { MeilisearchEngine } from "../src/search/index.js";
import {
  validateMeilisearchSettings,
  InvalidMeilisearchSettingsError,
  MEILISEARCH_SETTING_KEYS,
} from "../src/search/MeilisearchSettingsSchema.js";

const okFetch = async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } });

describe("Meilisearch settings validation", () => {
  test("validator returns ok for known keys", () => {
    const r = validateMeilisearchSettings({ filterableAttributes: ["a"], sortableAttributes: ["b"] });
    expect(r.ok).toBe(true);
    expect(r.unknown).toEqual([]);
  });

  test("validator lists unknown keys", () => {
    const r = validateMeilisearchSettings({ filterableAttributes: ["a"], bogus: 1, alsoBogus: 2 });
    expect(r.ok).toBe(false);
    expect(r.unknown).toEqual(["bogus", "alsoBogus"]);
  });

  test("updateIndexSettings throws on unknown key", async () => {
    const engine = new MeilisearchEngine({ host: "http://meili:7700", fetch: okFetch as any });
    await expect(engine.updateIndexSettings("posts", { bogus: true } as any))
      .rejects.toThrow(InvalidMeilisearchSettingsError);
  });

  test("validate=false bypasses validation", async () => {
    const calls: any[] = [];
    const fn = async (url: any, init?: any) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    };
    const engine = new MeilisearchEngine({ host: "http://meili:7700", fetch: fn as any, validate: false });
    await engine.updateIndexSettings("posts", { bogus: true, filterableAttributes: ["a"] } as any);
    expect(calls).toHaveLength(1);
  });

  test("known keys allowlist covers common Meili settings", () => {
    for (const key of ["searchableAttributes", "filterableAttributes", "sortableAttributes", "rankingRules", "synonyms", "embedders"]) {
      expect(MEILISEARCH_SETTING_KEYS.has(key)).toBe(true);
    }
  });
});
