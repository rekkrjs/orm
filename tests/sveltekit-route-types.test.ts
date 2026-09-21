import { describe, it, expect } from "bun:test";
import type { Actions, RequestEvent, RequestHandler, ServerLoad, ServerLoadEvent } from "@sveltejs/kit";
import { Model } from "../src/model/Model.js";
import type { PublicShape } from "./helpers.js";
import { configureSvelteKit, route } from "../src/sveltekit/index.js";
import { Validator, rule } from "../src/validation/index.js";
function expectType<T>(_v: T): void {}

class Branch extends Model.define("branches") {}
class Payroll extends Model.define("payrolls") {}
class AcademicYear extends Model.define("academic_years") {}
class AnnouncementDetail extends Model.define<{ id: number; announcement_target_id: number }>("announcement_details") {}
class AnnouncementTarget extends Model.define<{ id: number; announcement_id: number }>("announcement_targets") {
  details() {
    return this.hasOne(AnnouncementDetail);
  }
}
class Announcement extends Model.define<{ id: number; title: string }>("announcements") {
  targets() {
    return this.hasMany(AnnouncementTarget);
  }
}
class CustomBound {
  constructor(public id: string, public active: boolean) {}
}

const PostSchema = Validator.schema({
  title: rule().required().string(),
});

describe("sveltekit route() typing", () => {
  it("supports global sveltekit helper configuration", () => {
    configureSvelteKit({
      error: (_status, _body) => {
        throw new Error("configured");
      },
      fail: (_status, body) => body,
    });
    const load: ServerLoad = route().load(async () => ({ ok: true }));
    expect(typeof load).toBe("function");
  });

  it("is compatible with SvelteKit ServerLoad and supports aliases", () => {
    const load: ServerLoad = route()
      .bind(Branch)
      .bind(Payroll, "payroll_id")
      .bind(AcademicYear, "academic_year")
      .bind(Branch, "source_branch_id", "sourceBranch")
      .load(async (_event, { branch, payroll, academicYear, sourceBranch, data }) => {
        expectType<ServerLoadEvent>(_event);
        expectType<Branch>(branch);
        expectType<Payroll>(payroll);
        expectType<AcademicYear>(academicYear);
        expectType<Branch>(sourceBranch);
        expectType<undefined>(data);
        expect(branch).toBeDefined();
        expect(payroll).toBeDefined();
        expect(academicYear).toBeDefined();
        expect(sourceBranch).toBeDefined();
        expect(data).toBeUndefined();
        return { ok: true };
      });

    expect(typeof load).toBe("function");
  });

  it("builds SvelteKit-compatible actions object", () => {
    const formActions: Actions = {
      create: route()
        .bind(Branch)
        .can("update")
        .schema(PostSchema)
        .action(async (_event, { branch, data, flash }) => {
          expectType<RequestEvent>(_event);
          expectType<Branch>(branch);
          expectType<{ title: string }>(data);
          expectType<(value: string | { message: string; type?: "success" | "error" | "info" | "warning" }) => void>(flash);
          expect(branch).toBeDefined();
          expect(data.title).toBeDefined();
          return { ok: true };
        }),
      update: route()
        .bind(Payroll, "payroll_id")
        .can("view", "payroll")
        .action(async (_event, { payroll }) => {
          expectType<Payroll>(payroll);
          return { id: payroll.id as any };
        }),
    };

    expect(typeof formActions.create).toBe("function");
    expect(typeof formActions.update).toBe("function");
  });

  it("supports typed duplicate model binding with explicit alias", () => {
    const load: ServerLoad = route()
      .bind(Branch, "id", "originBranch")
      .bind(Branch, "target_id", "targetBranch")
      .load(async (_event, { originBranch, targetBranch }) => {
        expectType<Branch>(originBranch);
        expectType<Branch>(targetBranch);
        return { ok: true };
      });
    expect(typeof load).toBe("function");
  });

  it("supports bind options with eager loading while keeping existing signatures", () => {
    const load: ServerLoad = route()
      .bind(Announcement, { with: "targets" })
      .bind(Announcement, "announcement_id", "announcementWithDetails", { with: ["targets", "targets.details"] })
      .bind(Announcement, "draft_id", "draftAnnouncement")
      .bind(Announcement, "full_id", "fullAnnouncement", { with: ["targets"] })
      .load(async (_event, { announcement, announcementWithDetails, draftAnnouncement, fullAnnouncement, flash }) => {
        // A `with` binding rewrites the loaded relation key, so the parameter is no
        // longer the class itself; its own attributes must survive regardless.
        expectType<string>(announcement.title);
        expectType<string>(announcementWithDetails.title);
        expectType<PublicShape<Announcement>>(draftAnnouncement);
        expectType<string>(fullAnnouncement.title);
        expectType<string | { type: "success" | "error" | "info" | "warning"; message: string } | readonly (string | { type: "success" | "error" | "info" | "warning"; message: string })[] | null>(flash);
        expectType<PublicShape<AnnouncementTarget> | null>(announcement.targets.first());
        const firstTarget = announcement.targets.first();
        if (firstTarget) {
          // with: "targets" does not type nested relations, so `details` is still
          // the relation method rather than a loaded AnnouncementDetail | null.
          expectType<(...args: any[]) => unknown>(firstTarget.details);
        }
        const nestedFirst = announcementWithDetails.targets.first();
        if (nestedFirst) {
          expectType<PublicShape<AnnouncementDetail> | null>(nestedFirst.details);
        }
        return { ok: true };
      });
    expect(typeof load).toBe("function");
  });

  it("supports resolver-based bind with alias typing", () => {
    const load: ServerLoad = route()
      .bind(async (event) => {
        expectType<ServerLoadEvent>(event as ServerLoadEvent);
        return new CustomBound(event.params.id ?? "x", true);
      }, "customRecord")
      .load(async (_event, { customRecord }) => {
        expectType<CustomBound>(customRecord);
        expect(customRecord.active).toBe(true);
        return { ok: true };
      });
    expect(typeof load).toBe("function");
  });

  it("supports RequestHandler-compatible route().request()", () => {
    const post: RequestHandler = route()
      .bind(Branch)
      .schema(PostSchema)
      .request(async (_event, { branch, data, flash }) => {
        expectType<Branch>(branch);
        expectType<{ title: string }>(data);
        flash("queued");
        return new Response(JSON.stringify({ id: branch.id, title: data.title }), {
          headers: { "content-type": "application/json" },
        });
      });
    expect(typeof post).toBe("function");
  });
});
