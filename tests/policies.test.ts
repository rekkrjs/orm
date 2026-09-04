import { describe, expect, test } from "bun:test";
import { can, authorize, clearPolicies, registerPolicy, registerPolicies, PolicyAuthorizationError } from "../src/policies/index.js";

class Announcement {
  constructor(public user_id: number) {}
}

class AnnouncementPolicy {
  update(user: { id: number }, model: Announcement) {
    return user.id === model.user_id;
  }

  delete(_user: { id: number }, _model: Announcement) {
    return "Only admins can delete announcements.";
  }
}

describe("policies", () => {
  test("can() resolves a registered policy by model constructor", async () => {
    clearPolicies();
    registerPolicy(Announcement, AnnouncementPolicy);

    const owner = await can({ id: 1 }, "update", new Announcement(1));
    const stranger = await can({ id: 2 }, "update", new Announcement(1));

    expect(owner).toBe(true);
    expect(stranger).toBe(false);
  });

  test("registerPolicies() supports model-name registrations", async () => {
    clearPolicies();
    registerPolicies({ Announcement: AnnouncementPolicy });
    expect(await can({ id: 1 }, "update", new Announcement(1))).toBe(true);
  });

  test("authorize() throws with policy message on deny", async () => {
    clearPolicies();
    registerPolicy(Announcement, AnnouncementPolicy);

    await expect(authorize({ id: 1 }, "delete", new Announcement(1))).rejects.toBeInstanceOf(PolicyAuthorizationError);
    await expect(authorize({ id: 1 }, "delete", new Announcement(1))).rejects.toMatchObject({
      message: "Only admins can delete announcements.",
    });
  });
});


test("policy methods retain their instance receiver", async () => {
  class OwnedPolicy {
    private owner = 7;
    update(user: { id: number }) { return user.id === this.owner; }
  }
  registerPolicy(Announcement, OwnedPolicy);
  expect(await can({ id: 7 }, "update", new Announcement(7))).toBe(true);
  expect(await can({ id: 8 }, "update", new Announcement(7))).toBe(false);
});
