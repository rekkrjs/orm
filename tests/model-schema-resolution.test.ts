import { describe, expect, test } from "./harness.js";
import { Connection, Model } from "../src/index.js";

describe("model schema resolution", () => {
  test("explicit model schema overrides tenant schema", () => {
    class LandlordUser extends Model.define<{ id: number }>("users") {
      static modelSchema = "public";
    }

    const base = new Connection({ url: "postgres://postgres@localhost:5432/postgres" });
    const tenant = base.withSchema("tenant_acme");

    expect(LandlordUser.getQualifiedTable(base)).toBe("public.users");
    expect(LandlordUser.getQualifiedTable(tenant)).toBe("public.users");
  });

  test("tenant model uses active tenant schema and falls back to public", () => {
    class TenantUser extends Model.define<{ id: number }>("users") {}

    const base = new Connection({ url: "postgres://postgres@localhost:5432/postgres" });
    const tenant = base.withSchema("tenant_acme");

    expect(TenantUser.getQualifiedTable(tenant)).toBe("tenant_acme.users");
    expect(TenantUser.getQualifiedTable(base)).toBe("public.users");
  });

  test("sqlite keeps unqualified table names", () => {
    class SqliteUser extends Model.define<{ id: number }>("users") {}

    const sqlite = new Connection({ url: "sqlite://:memory:" });
    expect(SqliteUser.getQualifiedTable(sqlite)).toBe("users");
  });
});
