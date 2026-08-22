import { describe, expect, it } from "bun:test";
import { configureSvelteKit, flash, route } from "../src/sveltekit/index.js";
import { Validator, rule } from "../src/validation/index.js";
import { clearPolicies, registerPolicy } from "../src/policies/index.js";

function makeCookies(initial: Record<string, string> = {}) {
  const jar = new Map<string, string>(Object.entries(initial));
  return {
    get(name: string) {
      return jar.get(name);
    },
    set(name: string, value: string) {
      jar.set(name, value);
    },
    delete(name: string) {
      jar.delete(name);
    },
    snapshot() {
      return Object.fromEntries(jar.entries());
    },
  };
}

class PolicyAnnouncement {
  constructor(public id: string) {}
}
class PolicyAnnouncementPolicy {
  update(user: { id: string }, model: PolicyAnnouncement) {
    return user.id === model.id || "Forbidden.";
  }
}

describe("sveltekit route() validation response", () => {
  it("returns flattened issues bag from schema action failures", async () => {
    configureSvelteKit({
      error: (_status, _body) => {
        throw new Error("unexpected error");
      },
      fail: (status, body) => ({ status, body }),
    });

    const schema = Validator.schema({
      title: rule().required().string(),
      email: rule().required().email(),
    });

    const action = route()
      .schema(schema)
      .action(async () => ({ ok: true }));

    const form = new FormData();
    form.set("title", "");
    form.set("email", "not-an-email");

    const result = await action({
      params: {},
      request: new Request("http://localhost/test", { method: "POST", body: form }),
    } as any);

    expect(result).toEqual({
      status: 422,
      body: {
        issues: {
          title: ["The title field is required."],
          email: ["The email field must be a valid email address."],
        },
        values: {
          title: "",
          email: "not-an-email",
        },
      },
    });
  });

  it("exposes flash() in action context and stores flash for the next load", async () => {
    configureSvelteKit({
      error: (_status, _body) => {
        throw new Error("unexpected error");
      },
      fail: (status, body) => ({ status, body }),
    });

    const cookies = makeCookies();
    const action = route().action(async (_event, { flash }) => {
      flash("Successfully updated");
      flash({ type: "success", message: "Done" });
      return { ok: true };
    });

    await action({
      params: {},
      request: new Request("http://localhost/test", { method: "POST" }),
      cookies,
    } as any);

    const stored = cookies.snapshot().rekkr_flash;
    expect(typeof stored).toBe("string");
    expect(stored).toContain("Successfully updated");
    expect(stored).toContain("\"Done\"");
  });

  it("injects flash into load context and consumes it once", async () => {
    configureSvelteKit({
      error: (_status, _body) => {
        throw new Error("unexpected error");
      },
      fail: (status, body) => ({ status, body }),
    });

    const cookies = makeCookies({
      rekkr_flash: JSON.stringify([{ type: "error", message: "Failed to update" }]),
    });

    const load = route().load(async (_event, { flash }) => ({ flash }));
    const first = await load({
      params: {},
      request: new Request("http://localhost/test", { method: "GET" }),
      cookies,
    } as any);
    expect(first).toEqual({
      flash: {
        type: "error",
        message: "Failed to update",
      },
    });

    const second = await load({
      params: {},
      request: new Request("http://localhost/test", { method: "GET" }),
      cookies,
    } as any);
    expect(second).toEqual({ flash: null });
  });

  it("returns a single string flash as string and multiple flashes as array", async () => {
    configureSvelteKit({
      error: (_status, _body) => {
        throw new Error("unexpected error");
      },
      fail: (status, body) => ({ status, body }),
    });

    const singleCookies = makeCookies({
      rekkr_flash: JSON.stringify(["Saved"]),
    });
    const load = route().load(async (_event, { flash }) => ({ flash }));
    const single = await load({
      params: {},
      request: new Request("http://localhost/test", { method: "GET" }),
      cookies: singleCookies,
    } as any);
    expect(single).toEqual({ flash: "Saved" });

    const multipleCookies = makeCookies({
      rekkr_flash: JSON.stringify(["Saved", { type: "error", message: "Failed" }]),
    });
    const multiple = await load({
      params: {},
      request: new Request("http://localhost/test", { method: "GET" }),
      cookies: multipleCookies,
    } as any);
    expect(multiple).toEqual({
      flash: ["Saved", { type: "error", message: "Failed" }],
    });
  });

  it("supports direct flash helper usage outside route()", async () => {
    const cookies = makeCookies();
    flash(cookies as any, "Successfully saved.");
    flash(cookies as any, { type: "success", message: "Saved again" });

    const consumed = flash(cookies as any);
    expect(consumed).toEqual([
      "Successfully saved.",
      { type: "success", message: "Saved again" },
    ]);

    const second = flash(cookies as any);
    expect(second).toBeNull();
  });

  it("returns 404 when resolver-based bind returns null", async () => {
    configureSvelteKit({
      error: (status, body) => {
        const err = new Error(body.message) as Error & { status: number };
        err.status = status;
        throw err;
      },
      fail: (status, body) => ({ status, body }),
    });

    const load = route()
      .bind(async () => null, "announcement")
      .load(async () => ({ ok: true }));

    await expect(
      load({
        params: {},
        request: new Request("http://localhost/test", { method: "GET" }),
        cookies: makeCookies(),
      } as any),
    ).rejects.toMatchObject({ status: 404, message: "No record found." });
  });

  it("enforces route().can() using registered model policy", async () => {
    configureSvelteKit({
      error: (status, body) => {
        const err = new Error(body.message) as Error & { status: number };
        err.status = status;
        throw err;
      },
      fail: (status, body) => ({ status, body }),
    });
    clearPolicies();
    registerPolicy(PolicyAnnouncement, PolicyAnnouncementPolicy);

    const record = new PolicyAnnouncement("a1");

    const allowLoad = route()
      .bind(async () => record, "announcement")
      .can("update", "announcement")
      .load(async () => ({ ok: true }));
    await expect(
      allowLoad({
        params: {},
        request: new Request("http://localhost/test", { method: "GET" }),
        cookies: makeCookies(),
        locals: { user: { id: "a1" } },
      } as any),
    ).resolves.toEqual({ ok: true });

    const denyLoad = route()
      .bind(async () => record, "announcement")
      .can("update", "announcement")
      .load(async () => ({ ok: true }));
    await expect(
      denyLoad({
        params: {},
        request: new Request("http://localhost/test", { method: "GET" }),
        cookies: makeCookies(),
        locals: { user: { id: "nope" } },
      } as any),
    ).rejects.toMatchObject({ status: 403, message: "Forbidden." });
  });

  it("uses a local extended user for policy checks without mutating event.locals.user", async () => {
    configureSvelteKit({
      error: (status, body) => {
        const err = new Error(body.message) as Error & { status: number };
        err.status = status;
        throw err;
      },
      fail: (status, body) => ({ status, body }),
    });
    clearPolicies();
    registerPolicy(PolicyAnnouncement, PolicyAnnouncementPolicy);

    const record = new PolicyAnnouncement("u1");

    const action = route()
      .bind(async () => record, "announcement")
      .action(async (event) => {
        const hasCan = typeof (event.locals.user as any).can === "function";
        return { hasCan };
      });

    await expect(
      action({
        params: {},
        request: new Request("http://localhost/test", { method: "POST" }),
        cookies: makeCookies(),
        locals: { user: { id: "u1" } },
      } as any),
    ).resolves.toEqual({ hasCan: false });
  });

  it("request() returns 422 JSON payload when schema validation fails", async () => {
    configureSvelteKit({
      error: (status, body) => {
        const err = new Error(body.message) as Error & { status: number };
        err.status = status;
        throw err;
      },
      fail: (status, body) => ({ status, body }),
    });

    const schema = Validator.schema({
      title: rule().required().string(),
    });

    const handler = route()
      .schema(schema)
      .request(async () => new Response("ok"));

    const form = new FormData();
    form.set("title", "");

    const response = await handler({
      params: {},
      request: new Request("http://localhost/test", { method: "POST", body: form }),
      cookies: makeCookies(),
    } as any);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      issues: {
        title: ["The title field is required."],
      },
      values: {
        title: "",
      },
    });
  });

  it("request() supports RFC7807 problem+json validation responses", async () => {
    configureSvelteKit({
      error: (status, body) => {
        const err = new Error(body.message) as Error & { status: number };
        err.status = status;
        throw err;
      },
      fail: (status, body) => ({ status, body }),
    });

    const schema = Validator.schema({
      title: rule().required().string(),
    });

    const handler = route()
      .schema(schema)
      .request(async () => new Response("ok"), { validationError: "problem+json" });

    const form = new FormData();
    form.set("title", "");

    const response = await handler({
      params: {},
      request: new Request("http://localhost/test", { method: "POST", body: form }),
      cookies: makeCookies(),
    } as any);

    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(await response.json()).toEqual({
      type: "https://rekkr.dev/problems/validation-error",
      title: "Validation failed",
      status: 422,
      detail: "One or more fields are invalid.",
      errors: {
        title: ["The title field is required."],
      },
      values: {
        title: "",
      },
    });
  });

  it("request() supports custom validationError response formatter", async () => {
    configureSvelteKit({
      error: (status, body) => {
        const err = new Error(body.message) as Error & { status: number };
        err.status = status;
        throw err;
      },
      fail: (status, body) => ({ status, body }),
    });

    const schema = Validator.schema({
      title: rule().required().string(),
    });

    const handler = route()
      .schema(schema)
      .request(async () => new Response("ok"), {
        validationError: ({ issues }) => new Response(JSON.stringify({ ok: false, issues }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      });

    const form = new FormData();
    form.set("title", "");

    const response = await handler({
      params: {},
      request: new Request("http://localhost/test", { method: "POST", body: form }),
      cookies: makeCookies(),
    } as any);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      issues: {
        title: ["The title field is required."],
      },
    });
  });
});
