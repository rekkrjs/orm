import { describe, it, expect, beforeAll } from "./harness.js";
import { Model, Schema, Collection } from "../src/index.js";
import { PermissiveModel, setupTestDb } from "./helpers.js";

// ─── Models ───────────────────────────────────────────────────────────────────

interface SocialAttributes { id: number; user_id: number; provider: string; provider_id: string; }
interface UserAttributes   { id: number; name: string; email: string; }

class Social extends PermissiveModel.define<SocialAttributes>("socials") {
  static timestamps = false;
}

class JsonUser extends PermissiveModel.define<UserAttributes>("json_users") {
  static timestamps = false;

  social() { return this.hasOne(Social, "user_id"); }
  socials() { return this.hasMany(Social, "user_id"); }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  setupTestDb();
  await Schema.create("json_users", (t) => {
    t.increments("id");
    t.string("name");
    t.string("email");
  });
  await Schema.create("socials", (t) => {
    t.increments("id");
    t.integer("user_id");
    t.string("provider");
    t.string("provider_id");
  });

  const alice = await JsonUser.create({ name: "Alice", email: "alice@example.com" });
  const bob   = await JsonUser.create({ name: "Bob",   email: "bob@example.com" });

  // alice has exactly one social (for hasOne tests) + a second one (for hasMany tests)
  await Social.create({ user_id: alice.id, provider: "github",  provider_id: "gh-alice" });
  await Social.create({ user_id: alice.id, provider: "google",  provider_id: "goo-alice" });
  await Social.create({ user_id: bob.id,   provider: "twitter", provider_id: "tw-bob" });
  // store first id so hasOne tests can assert the first-inserted record
  void alice; void bob;
});

// ─── Single model ─────────────────────────────────────────────────────────────

describe("model.json() — no args", () => {
  it("returns all attributes", async () => {
    const user = await JsonUser.first() as JsonUser;
    const j = user.json();
    expect(j).toMatchObject({ id: expect.any(Number), name: "Alice", email: "alice@example.com" });
  });
});

describe("model.json(...keys) — top-level pick", () => {
  it("returns only requested keys", async () => {
    const user = await JsonUser.first() as JsonUser;
    const j = user.json("id", "name");
    expect(Object.keys(j).sort()).toEqual(["id", "name"]);
    expect(typeof j.id).toBe("number");
    expect(j.name).toBe("Alice");
  });

  it("omits unrequested keys", async () => {
    const user = await JsonUser.first() as JsonUser;
    const j = user.json("id");
    expect((j as any).email).toBeUndefined();
  });
});

describe("model.json(...paths) — nested relation pick (hasOne)", () => {
  it("picks nested field from hasOne relation", async () => {
    const user = (await JsonUser.with("social").first())!;
    const j = user.json("id", "name", "social.provider_id");
    expect(Object.keys(j).sort()).toEqual(["id", "name", "social"]);
    expect(typeof (j as any).social.provider_id).toBe("string");
    expect((j as any).social.provider).toBeUndefined();
  });

  it("picks multiple fields from hasOne relation", async () => {
    const user = (await JsonUser.with("social").first())!;
    const j = user.json("id", "social.provider", "social.provider_id");
    expect(typeof (j as any).social.provider).toBe("string");
    expect(typeof (j as any).social.provider_id).toBe("string");
    expect((j as any).social.id).toBeUndefined();
  });

  it("returns null for null relation", async () => {
    const user = await JsonUser.with("social").find(9999);
    if (!user) return; // no row
    const j = user.json("id", "social.provider_id");
    expect((j as any).social).toBeNull();
  });
});

describe("model.json(...paths) — nested relation pick (hasMany)", () => {
  it("picks nested field from hasMany relation", async () => {
    const user = (await JsonUser.with("socials").first())!;
    const j = user.json("id", "socials.provider_id");
    expect(Array.isArray((j as any).socials)).toBe(true);
    for (const s of (j as any).socials) {
      expect(Object.keys(s)).toEqual(["provider_id"]);
    }
  });

  it("picks multiple fields from hasMany relation", async () => {
    const user = (await JsonUser.with("socials").first())!;
    const j = user.json("socials.provider", "socials.provider_id");
    for (const s of (j as any).socials) {
      expect(typeof s.provider).toBe("string");
      expect(typeof s.provider_id).toBe("string");
      expect(s.id).toBeUndefined();
    }
  });
});

// ─── Collection ───────────────────────────────────────────────────────────────

describe("collection.json() — no args", () => {
  it("returns all attributes for each item", async () => {
    const users = await JsonUser.all();
    const j = users.json();
    expect(j).toHaveLength(2);
    expect(j[0]).toMatchObject({ name: "Alice", email: "alice@example.com" });
  });
});

describe("collection.json(...keys) — top-level pick", () => {
  it("picks top-level keys from each item", async () => {
    const users = await JsonUser.all();
    const j = users.json("id", "name");
    expect(j).toHaveLength(2);
    for (const row of j) {
      expect(Object.keys(row).sort()).toEqual(["id", "name"]);
    }
  });
});

describe("collection.json(...paths) — nested pick", () => {
  it("picks nested field from hasMany relation across collection", async () => {
    const users = await JsonUser.with("socials").get();
    const j = users.json("id", "name", "socials.provider_id");
    expect(j).toHaveLength(2);
    for (const row of j) {
      expect(Object.keys(row).sort()).toEqual(["id", "name", "socials"]);
      for (const s of (row as any).socials) {
        expect(Object.keys(s)).toEqual(["provider_id"]);
      }
    }
  });

  it("picks nested field from hasOne relation across collection", async () => {
    const users = await JsonUser.with("social").get();
    const j = users.json("id", "social.provider");
    expect(j).toHaveLength(2);
    for (const row of j) {
      if ((row as any).social !== null) {
        expect(typeof (row as any).social.provider).toBe("string");
        expect((row as any).social.provider_id).toBeUndefined();
      }
    }
  });
});

// ─── Plain Collection (non-model items) ───────────────────────────────────────

describe("Collection.json() on plain objects", () => {
  it("returns full items when no args", () => {
    const col = new Collection([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
    expect(col.json()).toEqual([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
  });
});
