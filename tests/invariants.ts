import { afterEach, expect } from "bun:test";

const prototype = Object.getOwnPropertyDescriptors(Object.prototype);

afterEach(() => {
  expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(prototype);
});
