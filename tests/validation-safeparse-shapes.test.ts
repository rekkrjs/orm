import { describe, expect, test } from "bun:test";
import { Validator } from "../src/validation/index.js";

describe("validation safeParse result shapes", () => {
  test("every safeParse entry point returns standard issues", async () => {
    const entries = {
      email: Validator.required().email(),
    };

    const staticResult = await Validator.safeParse(entries, { email: "not-an-email" });
    expect(staticResult.success).toBe(false);
    if (!staticResult.success) {
      expect(staticResult.issues).toEqual([
        {
          message: "The email field must be a valid email address.",
          path: [{ key: "email" }],
        },
      ]);
      expect(staticResult.input).toEqual({ email: "not-an-email" });
    }

    const schema = Validator.schema(entries);
    const standardResult = await schema.safeParse({ email: "not-an-email" });
    expect(standardResult.success).toBe(false);
    if (!standardResult.success) {
      expect(Array.isArray(standardResult.issues)).toBe(true);
      expect(standardResult.issues).toEqual([
        {
          message: "The email field must be a valid email address.",
          path: [{ key: "email" }],
        },
      ]);
      expect(standardResult.input).toEqual({ email: "not-an-email" });
    }
  });

  test("Validator.flatten normalizes standard issues array into a flat issue bag", async () => {
    const schema = Validator.schema({
      email: Validator.required().email(),
      "profile.name": Validator.required().string(),
    });

    const result = await schema.safeParse({ email: "bad" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = Validator.flatten(result.issues);
      expect(flat).toEqual({
        email: ["The email field must be a valid email address."],
        "profile.name": ["The profile.name field is required."],
      });
    }
  });
});
