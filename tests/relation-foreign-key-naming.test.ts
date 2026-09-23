import { describe, expect, test } from "./harness.js";
import { Connection } from "../src/connection/Connection.js";
import { Model } from "../src/model/Model.js";

class _Student extends Model.define("students") {
  grades() {
    return this.hasMany(Grade);
  }
}

class Grade extends Model.define("grades") {
  student() {
    return this.belongsTo(_Student);
  }
}

describe("relation foreign-key naming", () => {
  test("strips leading underscores from model class names", () => {
    const connection = new Connection({ url: "sqlite://:memory:" });
    Model.setConnection(connection);

    const student = new _Student();
    const grade = new Grade();

    expect(student.grades().getForeignKeyName()).toBe("student_id");
    expect(grade.student().getForeignKeyName()).toBe("student_id");

    return connection.close();
  });
});
