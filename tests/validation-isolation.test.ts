import { describe, expect, test } from "bun:test";
import { Validator } from "../src/validation/Validator.js";
import { ValidationError } from "../src/validation/ValidationError.js";

describe.serial("validation prototype isolation", () => {
  for (const segment of ["__proto__", "constructor", "prototype"]) {
    test(`form normalization rejects ${segment} even when validation fails`, async () => {
      const form = new FormData();
      form.set(`${segment}[audit_polluted]`, "yes");
      try {
        await expect(Validator.make(form, { required: Validator.required() }).validate()).rejects.toBeInstanceOf(ValidationError);
        expect(({} as any).audit_polluted).toBeUndefined();
        await expect(Validator.make(form, {}).validate()).rejects.toBeInstanceOf(ValidationError);
      } finally {
        delete (Object.prototype as any).audit_polluted;
        delete (Object as any).audit_polluted;
      }
    });

    test(`validated output rejects wildcard paths containing ${segment}`, async () => {
      const data = JSON.parse(`{"${segment}":{"role":"admin"}}`);
      try {
        const result = await Validator.safeParse({ "*.role": Validator.rule().string() }, data);
        expect(({} as any).role).toBeUndefined();
        expect(result.success).toBe(false);
      } finally {
        delete (Object.prototype as any).role;
        delete (Object as any).role;
      }
    });

    test(`rejects ${segment} at the root, middle and leaf of either writer`, async () => {
      for (const path of [segment, `items.${segment}.role`, `items.${segment}`]) {
        await expect(Validator.make(new URLSearchParams([[path, "admin"]]), {}).validate()).rejects.toBeInstanceOf(ValidationError);
        const result = await Validator.safeParse({ [path]: Validator.rule().default("admin") }, {});
        expect(result.success).toBe(false);
      }
    });
  }

  test("inherited ordinary names become own containers without modifying their owners", async () => {
    const before = Object.getOwnPropertyDescriptors(Object.prototype.toString);
    try {
      const form = new FormData();
      form.set("toString[value]", "safe");
      const output = await Validator.make(form, { "toString.value": Validator.rule().string() }).validate();
      expect(output).toEqual({ toString: { value: "safe" } });
      expect(Object.getOwnPropertyDescriptors(Object.prototype.toString)).toEqual(before);
    } finally {
      delete (Object.prototype.toString as any).value;
    }
  });
});
