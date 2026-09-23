import { describe, test, expect } from "./harness.js";
import { pluralize, snakeCase } from "../src/utils.js";

describe("snakeCase", () => {
  test("keeps acronyms together", () => {
    // Previously: parse_j_s_o_n_data, http_server -> h_t_t_p_server, etc.
    expect(snakeCase("parseJSONData")).toBe("parse_json_data");
    expect(snakeCase("HTTPServer")).toBe("http_server");
    expect(snakeCase("userID")).toBe("user_id");
    expect(snakeCase("XMLHttpRequest")).toBe("xml_http_request");
    expect(snakeCase("APIKey")).toBe("api_key");
  });

  test("ordinary names are unchanged", () => {
    expect(snakeCase("simpleName")).toBe("simple_name");
    expect(snakeCase("User")).toBe("user");
    expect(snakeCase("BlogPost")).toBe("blog_post");
    expect(snakeCase("Already_Snake")).toBe("already_snake");
    expect(snakeCase("a")).toBe("a");
    expect(snakeCase("")).toBe("");
  });
});

describe("pluralize", () => {
  test("handles the endings a bare +s gets wrong", () => {
    expect(pluralize("category")).toBe("categories");
    expect(pluralize("box")).toBe("boxes");
    expect(pluralize("dish")).toBe("dishes");
    expect(pluralize("leaf")).toBe("leaves");
  });

  test("regular words", () => {
    expect(pluralize("tag")).toBe("tags");
    expect(pluralize("taggable")).toBe("taggables");
    expect(pluralize("day")).toBe("days");
  });

  test("an already-plural input is not detected — documented limitation", () => {
    // "class" has to become "classes", so an -s ending cannot also mean
    // "leave it alone". Pass an explicit table name for those.
    expect(pluralize("tags")).toBe("tagses");
    expect(pluralize("class")).toBe("classes");
  });
});
