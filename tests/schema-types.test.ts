import { test } from "bun:test";
import { Blueprint } from "../src/schema/Blueprint.js";

test("temporal helpers expose precision without weakening timestamp name arity", () => {
  const table = new Blueprint("timestamps_types");
  table.dateTime("happened_at", 3);
  table.timestamp("published_at", 0);
  table.time("opens_at", 6);
  table.timestamps();
  table.timestamps({ precision: 3 });
  table.timestamps("createdAt", "updatedAt");
  table.timestamps("createdAt", "updatedAt", { precision: 6 });
  table.softDeletes("removed_at", { precision: 3 });
  table.datetimes();
  table.datetimes({ precision: 3 });
  table.datetimes("createdAt", "updatedAt", { precision: 6 });
  table.softDeletesDatetime("removed_at", { precision: 3 });

  if (false) {
    // @ts-expect-error timestamps requires either zero or two names.
    table.timestamps("createdAt");
    // @ts-expect-error timestamps does not accept three names.
    table.timestamps("createdAt", "updatedAt", "deletedAt");
    // @ts-expect-error datetimes requires either zero or two names.
    table.datetimes("createdAt");
  }

  expectType<void>(table.timestamps());
});

function expectType<T>(_value: T): void {}
