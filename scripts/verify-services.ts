import assert from "node:assert/strict";
import { RedisClient } from "bun";
import { Connection } from "../src/index.js";

// Required in CI: an unset URL or unavailable service is a failure, not a skip.
for (const key of ["POSTGRES_TEST_URL", "MYSQL_TEST_URL"] as const) {
  assert(process.env[key], `${key} is required for the integration job`);
  const connection = new Connection({ url: process.env[key]!, max: 1 });
  try {
    assert.equal((await connection.query("SELECT 1 AS ready"))[0].ready, 1);
    console.log(`${connection.getDriverName()}: ready`);
  } finally { await connection.close(); }
}
assert(process.env.REDIS_TEST_URL, "REDIS_TEST_URL is required for the integration job");
const redis = new RedisClient(process.env.REDIS_TEST_URL);
try { assert.equal(await redis.send("PING", []), "PONG"); console.log("redis: ready"); }
finally { redis.close(); }
