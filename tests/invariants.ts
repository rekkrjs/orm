import { afterEach, expect } from "./harness.js";

const prototype = Object.getOwnPropertyDescriptors(Object.prototype);

afterEach(() => {
  expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(prototype);
});
