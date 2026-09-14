/**
 * Compile-time assertions for backed enum descriptors. Real checks happen in
 * `tsc` via `tsconfig.test.json`. Runtime body is trivial.
 */
import { expect, test } from "bun:test";
import {
  Model,
  backedEnum,
  type BackedEnumDefinition,
  type CastDefinition,
  type EnumValue,
} from "../src/index.js";

const PublicationState = backedEnum({
  Draft: "draft",
  Published: "published",
});

type PublicationState = EnumValue<typeof PublicationState>;

// The TypeScript enum contract of TypeBox 1.x `Type.Enum` and Elysia 2
// `t.Enum`: every property, symbol keys included, holds a string or number,
// and only string keys contribute enum values.
type TypeScriptEnumLike = Record<PropertyKey, string | number>;
type TypeScriptEnumValues<T extends TypeScriptEnumLike> = T[Extract<keyof T, string>];

const enumLike: TypeScriptEnumLike = PublicationState;
const enumLikeValue: TypeScriptEnumValues<typeof PublicationState> = "published";
// @ts-expect-error string-keyed values must stay the declared literals.
const invalidEnumLikeValue: TypeScriptEnumValues<typeof PublicationState> = "archived";

const draft: PublicationState = PublicationState.Draft;
const published: PublicationState = "published";
// @ts-expect-error EnumValue must reject strings outside the descriptor.
const archived: PublicationState = "archived";

const plainCases = { Draft: "draft", Published: "published" } as const;
const looseCases: Record<PropertyKey, string> = { Draft: "draft" };
// @ts-expect-error a plain object is not a backed enum descriptor.
const plainDefinition: BackedEnumDefinition = plainCases;
// @ts-expect-error a symbol index signature does not satisfy the brand.
const looseDefinition: BackedEnumDefinition = looseCases;
// @ts-expect-error a plain object is not a model cast.
const plainCast: CastDefinition = plainCases;

class Article extends Model {
  static override timestamps = false;
  static override casts = { state: PublicationState };
}

const cast: CastDefinition = PublicationState;
new Article().mergeCasts({ state: PublicationState });

void [invalidEnumLikeValue, archived, plainDefinition, looseDefinition, plainCast];

test("backed enum descriptors satisfy enum-like and cast contracts", () => {
  expect(Object.values(enumLike)).toEqual(["draft", "published"]);
  expect([enumLikeValue, draft, published]).toEqual(["published", "draft", "published"]);
  expect(Article.casts.state).toBe(PublicationState);
  expect(cast).toBe(PublicationState);
});
