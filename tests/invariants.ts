import { afterEach, expect } from "./harness.js";

// A test whose server URL is unset skips itself, so a run without the servers
// would come out green having tested none of them. Refused unless asked for.
const servers = { POSTGRES_TEST_URL: process.env.POSTGRES_TEST_URL, MYSQL_TEST_URL: process.env.MYSQL_TEST_URL, REDIS_TEST_URL: process.env.REDIS_TEST_URL || process.env.REDIS_URL };
const missing = Object.entries(servers).filter(([, url]) => !url).map(([key]) => key);
if (missing.length > 0 && process.env.ORM_TEST_SKIP_SERVERS !== "1") {
  throw new Error(`${missing.join(", ")} unset: the tests that need them would be skipped. Set them (bun test and vitest both read .env), or set ORM_TEST_SKIP_SERVERS=1 to skip them knowingly.`);
}

const prototype = Object.getOwnPropertyDescriptors(Object.prototype);

afterEach(() => {
  expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(prototype);
});
