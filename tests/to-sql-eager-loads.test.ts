import { expect, test, describe, beforeAll } from "bun:test";
import { Collection, Model, Schema } from "../src/index.js";
import { PermissiveModel, setupTestDb, type PublicShape } from "./helpers.js";

class ECurriculum extends PermissiveModel {
  static table = "eager_curricula";
  program() {
    return this.belongsTo(EProgram);
  }
  subjects() {
    return this.belongsToMany(ESubject, "eager_curriculum_subjects").withPivot(["year_level", "term"]).withTimestamps();
  }
}

class EProgram extends PermissiveModel {
  static table = "eager_programs";
  curricula() {
    return this.hasMany(ECurriculum);
  }
}

class ESubject extends PermissiveModel {
  static table = "eager_subjects";
  curricula() {
    return this.belongsToMany(ECurriculum, "eager_curriculum_subjects");
  }
}

describe("toSqlWithEagerLoads", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("eager_curricula", (table) => {
      table.increments("id");
      table.string("name");
      table.integer("program_id").unsigned().nullable();
      table.timestamps();
    });
    await Schema.create("eager_programs", (table) => {
      table.increments("id");
      table.string("title");
      table.timestamps();
    });
    await Schema.create("eager_subjects", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });
    await Schema.create("eager_curriculum_subjects", (table) => {
      table.increments("id");
      table.integer("curriculum_id");
      table.integer("subject_id");
      table.integer("year_level");
      table.integer("term");
      table.timestamps();
    });
  });

  test("toSqlWithEagerLoads returns main query only when no eager loads", () => {
    const sql = ECurriculum.query().toSqlWithEagerLoads([]);
    expect(sql).toContain('SELECT * FROM "eager_curricula"');
  });

  test("toSqlWithEagerLoads returns main query and relation queries", async () => {
    const curriculum = await ECurriculum.create({ name: "Test Curriculum" });
    const sql = ECurriculum.with("program", "subjects").toSqlWithEagerLoads([curriculum]);
    const queries = sql.split(";\n");
    expect(queries.length).toBe(3);
    expect(queries[0]).toContain('SELECT * FROM "eager_curricula"');
    expect(queries[1]).toContain('FROM "eager_programs"');
    expect(queries[2]).toContain('FROM "eager_subjects"');
    expect(queries[2]).toContain("year_level");
    expect(queries[2]).toContain("term");
    expect(queries[2]).toContain("created_at");
    expect(queries[2]).toContain("updated_at");
  });

  test("toSqlWithEagerLoads includes orderBy from main query", async () => {
    const curriculum = await ECurriculum.create({ name: "Test" });
    const sql = ECurriculum.with("program").orderBy("created_at", "desc").toSqlWithEagerLoads([curriculum]);
    expect(sql).toContain("ORDER BY");
    expect(sql).toContain("created_at");
  });
});

// ─── Type-level test: nested constraint map preserves loaded relation types ───

describe("nested constraint map typed loading", () => {
  test("gradingPeriods type is Collection<GradingPeriod> not method", () => {
    class GPeriod extends PermissiveModel { static table = "g_periods"; }
    class Sem extends PermissiveModel {
      static table = "sems";
      gradingPeriods() { return this.hasMany(GPeriod); }
    }
    class AcalYear extends PermissiveModel {
      static table = "acal_years";
      semesters() { return this.hasMany(Sem); }
    }

    const builder = AcalYear.with({
      semesters: (q) => q.with({
        gradingPeriods: (q2) => q2.where("active", true),
      }),
    });

    // Runtime: builder is a Builder — type check is the goal
    // TypeScript: builder result type should have semesters as Collection<...>
    // and each semester's gradingPeriods as Collection<GPeriod>
    type Result = Awaited<ReturnType<typeof builder.find>>;
    type Semesters = NonNullable<Result>["semesters"];
    type GradingPeriodsOnSem = Semesters extends Collection<infer Elem>
      ? Elem extends { gradingPeriods: infer GP } ? GP : never
      : never;

    // If types are correct, GradingPeriodsOnSem should be Collection<GPeriod>
    // This is a compile-time assertion — if it fails, tsc fails
    const _assert: GradingPeriodsOnSem extends Collection<PublicShape<GPeriod>> ? true : false = true;
    expect(_assert).toBe(true);
  });
});

describe("string relation type narrowing still works", () => {
  test("with('subjects') still narrows to Collection<Subject>", () => {
    class Subject2 extends PermissiveModel { static table = "subjects2"; }
    class Curriculum2 extends PermissiveModel {
      static table = "curricula2";
      subjects() { return this.hasMany(Subject2); }
    }

    const builder = Curriculum2.with("subjects");

    type Result = Awaited<ReturnType<typeof builder.find>>;
    type SubjectsType = NonNullable<Result>["subjects"];

    const _assert: SubjectsType extends Collection<PublicShape<Subject2>> ? true : false = true;
    expect(_assert).toBe(true);
  });
});

describe("string with() produces exact loaded type (no deferred union)", () => {
  test("with('program') gives Program | null, not method | Program | null", () => {
    class Prog extends PermissiveModel { static table = "progs"; }
    class Cur extends PermissiveModel {
      static table = "curs";
      program() { return this.belongsTo(Prog); }
    }

    const builder = Cur.with("program");

    // The loaded type for program must be exactly Prog | null
    type Result = Awaited<ReturnType<typeof builder.first>>;
    type ProgramType = NonNullable<Result>["program"];

    // If this compiles, ProgramType is assignable to Prog | null (not a union with the method)
    const _assert: ProgramType extends PublicShape<Prog> | null ? true : false = true;
    // And the method type must NOT bleed in — function should not be assignable to Prog | null
    const _assertNoMethod: (() => any) extends ProgramType ? false : true = true;
    expect(_assert).toBe(true);
    expect(_assertNoMethod).toBe(true);
  });
});

describe("model json type", () => {
  test("json() includes Model.define attributes", () => {
    interface SectionAttrs {
      id: number;
      name: string;
      year_level: number;
    }

    class Section extends PermissiveModel.define<SectionAttrs>("typed_json_sections") {}

    const section = new Section({ id: 1, name: "A", year_level: 2 });
    const json = section.json();

    const _id: number = json.id;
    const _name: string = json.name;
    const _yearLevel: number = json.year_level;

    expect(_id).toBe(1);
    expect(_name).toBe("A");
    expect(_yearLevel).toBe(2);
  });

  test("json() includes loaded relation shapes", () => {
    interface AdviserAttrs {
      id: number;
      name: string;
    }
    interface SubjectAttrs {
      id: number;
      title: string;
    }
    interface SectionAttrs {
      id: number;
      adviser_id: number | null;
      name: string;
    }

    class Adviser extends PermissiveModel.define<AdviserAttrs>("typed_json_advisers") {}
    class Subject extends PermissiveModel.define<SubjectAttrs>("typed_json_subjects") {}
    class Section extends PermissiveModel.define<SectionAttrs>("typed_json_sections") {
      adviser() { return this.belongsTo(Adviser); }
      subjects() { return this.hasMany(Subject); }
    }

    const builder = Section.with("adviser", "subjects");

    type Result = NonNullable<Awaited<ReturnType<typeof builder.find>>>;
    type Json = ReturnType<Result["json"]>;
    type AdviserJson = Json["adviser"];
    type SubjectsJson = Json["subjects"];
    type IsAny<T> = 0 extends (1 & T) ? true : false;

    const _hasAdviserKey: "adviser" extends keyof Json ? true : false = true;
    const _hasSubjectsKey: "subjects" extends keyof Json ? true : false = true;
    const _jsonIsNotAny: IsAny<Json> extends true ? false : true = true;
    const _noAppends: "$appends" extends keyof Json ? false : true = true;
    const _noMergedCasts: "$mergedCasts" extends keyof Json ? false : true = true;
    const _noDirtyKeys: "$dirtyKeys" extends keyof Json ? false : true = true;
    const _adviserName: NonNullable<AdviserJson>["name"] extends string ? true : false = true;
    const _subjectsAreArray: SubjectsJson extends Array<any> ? true : false = true;
    const _subjectTitle: SubjectsJson[number]["title"] extends string ? true : false = true;

    expect(_hasAdviserKey).toBe(true);
    expect(_hasSubjectsKey).toBe(true);
    expect(_jsonIsNotAny).toBe(true);
    expect(_noAppends).toBe(true);
    expect(_noMergedCasts).toBe(true);
    expect(_noDirtyKeys).toBe(true);
    expect(_adviserName).toBe(true);
    expect(_subjectsAreArray).toBe(true);
    expect(_subjectTitle).toBe(true);
  });

  test("with() accepts array relation lists without losing eager-load typing", () => {
    interface StudentAttrs {
      id: number;
      name: string;
    }
    interface AdmissionAttrs {
      id: number;
      student_id: number | null;
    }

    class Student extends PermissiveModel.define<StudentAttrs>("typed_json_students") {}
    class Admission extends PermissiveModel.define<AdmissionAttrs>("typed_json_admissions") {
      student() { return this.belongsTo(Student); }
    }

    const builder = Admission.with(["student"]);

    type Result = NonNullable<Awaited<ReturnType<typeof builder.find>>>;
    type StudentRelation = Result["student"];
    type IsAny<T> = 0 extends (1 & T) ? true : false;

    const _relationIsModel: StudentRelation extends PublicShape<Student> | null ? true : false = true;
    const _relationIsNotAny: IsAny<StudentRelation> extends true ? false : true = true;

    expect(_relationIsModel).toBe(true);
    expect(_relationIsNotAny).toBe(true);
  });

  test("json() keeps loaded relation shapes through chained array with()", () => {
    interface AdviserAttrs {
      id: number;
      name: string;
    }
    interface BranchAttrs {
      id: number;
      name: string;
    }
    interface SectionAttrs {
      id: number;
      adviser_id: number | null;
      branch_id: number | null;
      name: string;
    }

    class Adviser extends PermissiveModel.define<AdviserAttrs>("typed_json_chain_advisers") {}
    class Branch extends PermissiveModel.define<BranchAttrs>("typed_json_chain_branches") {}
    class Section extends PermissiveModel.define<SectionAttrs>("typed_json_chain_sections") {
      adviser() { return this.belongsTo(Adviser); }
      branch() { return this.belongsTo(Branch); }
    }

    const builder = Section
      .with("adviser")
      .with(["branch"]);

    type Result = NonNullable<Awaited<ReturnType<typeof builder.find>>>;
    type Json = ReturnType<Result["json"]>;

    const _hasAdviserKey: "adviser" extends keyof Json ? true : false = true;
    const _hasBranchKey: "branch" extends keyof Json ? true : false = true;
    const _adviserName: NonNullable<Json["adviser"]>["name"] extends string ? true : false = true;
    const _branchName: NonNullable<Json["branch"]>["name"] extends string ? true : false = true;
    // @ts-expect-error Model methods should not be part of serialized JSON keys.
    type LoadSumMethodShouldNotSerialize = Json["loadSum"];

    expect(_hasAdviserKey).toBe(true);
    expect(_hasBranchKey).toBe(true);
    expect(_adviserName).toBe(true);
    expect(_branchName).toBe(true);
  });

  test("json() keeps nested eager-loaded relation json shapes", () => {
    interface SubjectAttrs {
      id: number;
      name: string;
    }
    interface DepartmentAttrs {
      id: number;
      name: string;
    }
    interface AdmissionSubjectAttrs {
      id: number;
      admission_id: number | null;
      department_id: number | null;
      subject_id: number | null;
    }
    interface AdmissionAttrs {
      id: number;
    }

    class Department extends PermissiveModel.define<DepartmentAttrs>("typed_json_nested_departments") {}
    class Subject extends PermissiveModel.define<SubjectAttrs>("typed_json_nested_subjects") {
      department() { return this.belongsTo(Department); }
    }
    class AdmissionSubject extends PermissiveModel.define<AdmissionSubjectAttrs>("typed_json_nested_admission_subjects") {
      subject() { return this.belongsTo(Subject); }
    }
    class Admission extends PermissiveModel.define<AdmissionAttrs>("typed_json_nested_admissions") {
      subjects() { return this.hasMany(AdmissionSubject); }
    }

    const builder = Admission.with(["subjects", "subjects.subject"]);

    type Result = NonNullable<Awaited<ReturnType<typeof builder.find>>>;
    type Json = ReturnType<Result["json"]>;
    type SubjectRow = Json["subjects"][number];
    type NestedSubject = SubjectRow["subject"];
    type IsAny<T> = 0 extends (1 & T) ? true : false;

    const _subjectsAreArray: Json["subjects"] extends Array<any> ? true : false = true;
    const _subjectRowHasSubject: "subject" extends keyof SubjectRow ? true : false = true;
    const _nestedSubjectIsNotAny: IsAny<NestedSubject> extends true ? false : true = true;
    const _nestedSubjectIsNotFunction: NestedSubject extends (...args: any[]) => any ? false : true = true;
    const _nestedSubjectHasNoInternalKeys: "$appends" extends keyof NonNullable<NestedSubject> ? false : true = true;
    const _nestedSubjectHasNoModelMethods: "save" extends keyof NonNullable<NestedSubject> ? false : true = true;
    const _nestedSubjectHasNoRelationMethods: "department" extends keyof NonNullable<NestedSubject> ? false : true = true;
    const _nestedSubjectName: NonNullable<NestedSubject>["name"] extends string ? true : false = true;
    // @ts-expect-error Serialized nested relations must not expose model internals.
    type NestedSubjectAppends = NonNullable<NestedSubject>["$appends"];
    // @ts-expect-error Serialized nested relations must not expose model methods.
    type NestedSubjectSave = NonNullable<NestedSubject>["save"];
    // @ts-expect-error Unloaded nested relation methods must not appear in JSON.
    type NestedSubjectDepartment = NonNullable<NestedSubject>["department"];

    expect(_subjectsAreArray).toBe(true);
    expect(_subjectRowHasSubject).toBe(true);
    expect(_nestedSubjectIsNotAny).toBe(true);
    expect(_nestedSubjectIsNotFunction).toBe(true);
    expect(_nestedSubjectHasNoInternalKeys).toBe(true);
    expect(_nestedSubjectHasNoModelMethods).toBe(true);
    expect(_nestedSubjectHasNoRelationMethods).toBe(true);
    expect(_nestedSubjectName).toBe(true);
  });

  test("json() excludes relation methods and internal state keys on plain models", () => {
    class Subject extends PermissiveModel {
      static table = "typed_json_plain_subjects";
    }
    class AdmissionSubject extends PermissiveModel {
      static table = "typed_json_plain_admission_subjects";
      subject() { return this.belongsTo(Subject); }
    }

    type Json = ReturnType<AdmissionSubject["json"]>;
    type IsAny<T> = 0 extends (1 & T) ? true : false;

    const _isAny: IsAny<Json> extends true ? false : true = true;
    const _noSubjectMethod: Json extends { subject: (...args: any[]) => any } ? false : true = true;
    const _noInternalState: "$casts" extends keyof Json ? false : true = true;
    const _noRelationKeys: "$relations" extends keyof Json ? false : true = true;

    expect(_isAny).toBe(true);
    expect(_noSubjectMethod).toBe(true);
    expect(_noInternalState).toBe(true);
    expect(_noRelationKeys).toBe(true);
  });

  test("json() excludes internals from nested eager-loaded plain models", () => {
    class Department extends PermissiveModel {
      static table = "typed_json_plain_nested_departments";
    }
    class Subject extends PermissiveModel {
      static table = "typed_json_plain_nested_subjects";
      department() { return this.belongsTo(Department); }
    }
    class AdmissionSubject extends PermissiveModel {
      static table = "typed_json_plain_nested_admission_subjects";
      subject() { return this.belongsTo(Subject); }
    }
    class Admission extends PermissiveModel {
      static table = "typed_json_plain_nested_admissions";
      subjects() { return this.hasMany(AdmissionSubject); }
    }

    const builder = Admission.with(["subjects", "subjects.subject"]);

    type Result = NonNullable<Awaited<ReturnType<typeof builder.find>>>;
    type Json = ReturnType<Result["json"]>;
    type SubjectRow = Json["subjects"][number];
    type NestedSubject = NonNullable<SubjectRow["subject"]>;
    type IsAny<T> = 0 extends (1 & T) ? true : false;

    const _nestedSubjectIsNotAny: IsAny<NestedSubject> extends true ? false : true = true;
    const _nestedSubjectHasNoAppends: "$appends" extends keyof NestedSubject ? false : true = true;
    const _nestedSubjectHasNoSave: "save" extends keyof NestedSubject ? false : true = true;
    const _nestedSubjectHasNoDepartmentMethod: "department" extends keyof NestedSubject ? false : true = true;

    // @ts-expect-error Serialized nested relations must not expose model internals.
    type NestedSubjectAppends = NestedSubject["$appends"];
    // @ts-expect-error Serialized nested relations must not expose model methods.
    type NestedSubjectSave = NestedSubject["save"];
    // @ts-expect-error Unloaded nested relation methods must not appear in JSON.
    type NestedSubjectDepartment = NestedSubject["department"];

    expect(_nestedSubjectIsNotAny).toBe(true);
    expect(_nestedSubjectHasNoAppends).toBe(true);
    expect(_nestedSubjectHasNoSave).toBe(true);
    expect(_nestedSubjectHasNoDepartmentMethod).toBe(true);
  });

  test("json() includes withCount result keys", () => {
    interface AdmissionAttrs {
      id: number;
      section_id: number;
    }
    interface SectionAttrs {
      id: number;
      name: string;
    }

    class Admission extends PermissiveModel.define<AdmissionAttrs>("typed_json_count_admissions") {}
    class Section extends PermissiveModel.define<SectionAttrs>("typed_json_count_sections") {
      admissions() { return this.hasMany(Admission); }
    }

    const builder = Section
      .withCount("admissions")
      .withCount("admissions", "total_admissions");
    const staticAutocompleteBuilder = Section.withCount("admissions");
    const queryAutocompleteBuilder = Section.query().withCount("admissions");

    type Result = NonNullable<Awaited<ReturnType<typeof builder.find>>>;
    type Json = ReturnType<Result["json"]>;
    type StaticAutocompleteResult = NonNullable<Awaited<ReturnType<typeof staticAutocompleteBuilder.find>>>;
    type QueryAutocompleteResult = NonNullable<Awaited<ReturnType<typeof queryAutocompleteBuilder.find>>>;

    const _hasDefaultCount: "admissions_count" extends keyof Json ? true : false = true;
    const _hasAliasCount: "total_admissions" extends keyof Json ? true : false = true;
    const _defaultCount: Json["admissions_count"] extends number ? true : false = true;
    const _aliasCount: Json["total_admissions"] extends number ? true : false = true;
    const _staticAutocompleteCount: ReturnType<StaticAutocompleteResult["json"]>["admissions_count"] extends number ? true : false = true;
    const _queryAutocompleteCount: ReturnType<QueryAutocompleteResult["json"]>["admissions_count"] extends number ? true : false = true;
    // @ts-expect-error Unknown keys should not be admitted by a broad Record<string, any>.
    type MissingCount = Json["missing_count"];

    expect(_hasDefaultCount).toBe(true);
    expect(_hasAliasCount).toBe(true);
    expect(_defaultCount).toBe(true);
    expect(_aliasCount).toBe(true);
    expect(_staticAutocompleteCount).toBe(true);
    expect(_queryAutocompleteCount).toBe(true);
  });

  test("relation aggregates infer related model columns", () => {
    interface AdmissionAttrs {
      id: number;
      section_id: number;
      score: number;
      status: string;
    }
    interface SectionAttrs {
      id: number;
      year_level: number;
    }

    class Admission extends PermissiveModel.define<AdmissionAttrs>("typed_json_aggregate_admissions") {}
    class Section extends PermissiveModel.define<SectionAttrs>("typed_json_aggregate_sections") {
      admissions() { return this.hasMany(Admission); }
    }

    const sumBuilder = Section.withSum("admissions", "id");
    const avgBuilder = Section.withAvg("admissions", "score", (query) => query.where("status", "enrolled"));
    const minBuilder = Section.withMin("admissions", "score", "minimum_score");
    const maxBuilder = Section.withMax("admissions", "score", "maximum_score", (query) => query.where("status", "enrolled"));
    const builderAvg = Section.query().withAvg("admissions", "score", (query) => query.where("status", "enrolled"));
    const builderMax = Section.query().withMax("admissions", "score", "maximum_score", (query) => query.where("status", "enrolled"));

    expect(sumBuilder).toBeDefined();
    expect(avgBuilder).toBeDefined();
    expect(minBuilder).toBeDefined();
    expect(maxBuilder).toBeDefined();
    expect(builderAvg.toSql()).toContain("\"status\" = 'enrolled'");
    expect(builderMax.toSql()).toContain("\"status\" = 'enrolled'");
  });
});
