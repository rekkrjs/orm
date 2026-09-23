import { expect, test } from "./harness.js";
import { Model } from "../src/index.js";

class ReadonlyConfigModel extends Model {
  static override timestamps = false;
  static override fillable = ["name"] as const;
  static override hidden = ["secret"] as const;
  static override visible = ["name"] as const;
  static override appends = ["label"] as const;
  static override touches = ["owner"] as const;
}

class ReadonlyGuardedModel extends Model {
  static override guarded = ["id"] as const;
}

test("model configuration accepts readonly tuples", () => {
  const keys = ["secret"] as const;
  const model = new ReadonlyConfigModel();

  model.makeHidden(keys).makeVisible(keys).append(keys).setAppends(keys);
  const mutableCopy: string[] = [...ReadonlyConfigModel.fillable];

  expect(mutableCopy).toEqual(["name"]);
  expect(ReadonlyGuardedModel.guarded).toEqual(["id"]);
});
