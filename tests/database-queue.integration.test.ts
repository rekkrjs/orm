import { describe, expect, test } from "bun:test";
import { Connection } from "../src/index.js";
import { DatabaseQueueDriver } from "../src/queue/DatabaseQueueDriver.js";
import { createDriverContext, serverUrl, type ServerDriver } from "./driver-harness.js";

async function secondConnection(driver: ServerDriver, first: Connection, namespace: string): Promise<Connection> {
  const config = first.getConfig();
  const connection = new Connection(
    "url" in config
      ? { ...config, max: 1 }
      : config,
  );
  if (driver === "mysql") await connection.run("SET time_zone = '+00:00'");
  else await connection.run(`SET search_path TO "${namespace}"`);
  return connection;
}

for (const driver of ["mysql", "postgres"] as const) {
  const run = serverUrl(driver) ? test.serial : test.skip;

  describe.serial(`${driver} database queue integration`, () => {
    run("migrates and reserves a job exactly once across competing workers", async () => {
      const context = await createDriverContext(driver);
      const other = await secondConnection(driver, context.connection, context.namespace);
      const firstWorker = new DatabaseQueueDriver(context.connection);
      const secondWorker = new DatabaseQueueDriver(other);

      try {
        await firstWorker.migrate();
        await firstWorker.dispatch("critical", "OnlyOnce", JSON.stringify({ args: [1] }), 0, 3);

        const reservations = await Promise.all([
          firstWorker.reserve("critical", 90),
          secondWorker.reserve("critical", 90),
        ]);
        const jobs = reservations.filter((job) => job !== null);

        expect(jobs).toHaveLength(1);
        expect(jobs[0]?.jobClass).toBe("OnlyOnce");
        expect(jobs[0]?.attempts).toBe(1);

        await firstWorker.release(jobs[0]!.id, jobs[0]!.reservationToken, 0);
        const retried = await secondWorker.reserve("critical", 90);
        expect(retried?.id).toBe(jobs[0]?.id);
        expect(retried?.attempts).toBe(2);

        await secondWorker.fail(retried!.id, retried!.reservationToken, "expected failure");
        expect(await firstWorker.size("critical")).toBe(0);
        const failed = await context.connection.query("SELECT exception FROM failed_jobs");
        expect(failed[0]?.exception).toBe("expected failure");
      } finally {
        await other.close();
        await context.dispose();
      }
    });
  });
}
