import { expect, test, describe, beforeAll } from "bun:test";
import { Collection, Model, Schema } from "../src/index.js";
import { PermissiveModel, setupTestDb } from "./helpers.js";

function expectType<T>(_value: T): void {}

class EAuthor extends PermissiveModel {
  static table = "e_authors";
  static timestamps = false;
  books() {
    return this.hasMany(EBook, "author_id");
  }
  profile() {
    return this.hasOne(EProfile, "author_id");
  }
}

class EBook extends PermissiveModel {
  static table = "e_books";
  static timestamps = false;
  author() {
    return this.belongsTo(EAuthor, "author_id");
  }
  chapters() {
    return this.hasMany(EChapter, "book_id");
  }
}

class EChapter extends PermissiveModel {
  static table = "e_chapters";
  static timestamps = false;
}

class EProfile extends PermissiveModel {
  static table = "e_profiles";
  static timestamps = false;
  author() {
    return this.belongsTo(EAuthor, "author_id");
  }
}

class TypedEBook extends PermissiveModel.define<{ id: number; author_id: number; title: string }>("typed_e_books") {}

class TypedEAuthor extends PermissiveModel.define<{ id: number; name: string }>("typed_e_authors") {
  books() {
    return this.hasMany(TypedEBook, "author_id");
  }
}

describe("Eager Loading", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("e_authors", (table) => {
      table.increments("id");
      table.string("name");
    });
    await Schema.create("e_books", (table) => {
      table.increments("id");
      table.integer("author_id");
      table.string("title");
      table.boolean("published").default(true);
    });
    await Schema.create("e_chapters", (table) => {
      table.increments("id");
      table.integer("book_id");
      table.string("title");
    });
    await Schema.create("e_profiles", (table) => {
      table.increments("id");
      table.integer("author_id");
      table.text("bio").nullable();
    });
  });

  test("with loads hasMany relation in single query", async () => {
    const author = await EAuthor.create({ name: "Alice" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book A" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book B" });

    const authors = await EAuthor.with("books").where("name", "Alice").get();
    expect(authors).toHaveLength(1);
    const loaded = authors[0].getRelation("books");
    expect(loaded).toHaveLength(2);
    expect(loaded[0].getAttribute("title")).toBe("Book A");
  });

  test("with loads belongsTo relation", async () => {
    const author = await EAuthor.create({ name: "Bob" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book C" });

    const books = await EBook.with("author").where("title", "Book C").get();
    expect(books).toHaveLength(1);
    expect(books[0].getRelation("author").getAttribute("name")).toBe("Bob");
  });

  test("with loads hasOne relation", async () => {
    const author = await EAuthor.create({ name: "Carl" });
    await EProfile.create({ author_id: author.getAttribute("id"), bio: "Hello" });

    const authors = await EAuthor.with("profile").where("name", "Carl").get();
    expect(authors).toHaveLength(1);
    expect(authors[0].getRelation("profile").getAttribute("bio")).toBe("Hello");
  });

  test("with loads multiple relations", async () => {
    const author = await EAuthor.create({ name: "Dana" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book D" });
    await EProfile.create({ author_id: author.getAttribute("id"), bio: "Bio D" });

    const authors = await EAuthor.with("books", "profile").where("name", "Dana").get();
    expect(authors).toHaveLength(1);
    expect(authors[0].getRelation("books")).toHaveLength(1);
    expect(authors[0].getRelation("profile")).not.toBeNull();
  });

  test("with on first loads relation", async () => {
    const author = await EAuthor.create({ name: "Eve" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book E" });

    const found = await EAuthor.with("books").where("name", "Eve").first();
    expect(found).not.toBeNull();
    expect(found!.getRelation("books")).toHaveLength(1);
  });

  test("eager loaded relations are available as properties", async () => {
    const author = await EAuthor.create({ name: "Ivy" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book I" });
    await EProfile.create({ author_id: author.getAttribute("id"), bio: "Bio I" });

    const found = await EAuthor.with(["books", "profile"]).where("name", "Ivy").first();
    expect(found).not.toBeNull();
    expect((found as any).books).toHaveLength(1);
    expect((found as any).books[0].getAttribute("title")).toBe("Book I");
    expect((found as any).profile.getAttribute("bio")).toBe("Bio I");
  });

  test("load can refresh an already loaded relation", async () => {
    const author = await EAuthor.create({ name: "Jules" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book J" });

    const found = await EAuthor.with("books").where("name", "Jules").first();
    expect((found as any).books).toHaveLength(1);

    await found!.load("books");
    expect((found as any).books).toHaveLength(1);
  });

  test("loadMissing loads absent relations and preserves loaded ones", async () => {
    const author = await EAuthor.create({ name: "Missing loader" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Original book" });
    const found = await EAuthor.where("id", author.getAttribute("id")).first();

    expect(found!.getRelation("books")).toBeUndefined();
    const loaded = await found!.loadMissing("books");
    const books = found!.getRelation("books");
    expect(loaded).toBe(found!);
    expect(books).toHaveLength(1);

    await EBook.create({ author_id: author.getAttribute("id"), title: "Later book" });
    await found!.loadMissing("books");
    expect(found!.getRelation("books")).toBe(books);
    expect(found!.getRelation("books")).toHaveLength(1);
  });

  test("loadMissing preserves a loaded parent while loading a nested relation", async () => {
    const author = await EAuthor.create({ name: "Nested missing loader" });
    const kept = await EBook.create({ author_id: author.getAttribute("id"), title: "Nested kept book" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Nested omitted book" });
    await EChapter.create({ book_id: kept.getAttribute("id"), title: "Nested chapter" });

    const found = await EAuthor.with({
      books: (query) => query.where("title", "Nested kept book"),
    }).find(author.getAttribute("id"));
    const books = found!.getRelation("books");

    await found!.loadMissing("books.chapters");

    expect(found!.getRelation("books")).toBe(books);
    expect(books.map((book: EBook) => book.getAttribute("title"))).toEqual(["Nested kept book"]);
    expect(books[0].getRelation("chapters")).toHaveLength(1);
  });

  test("loadMissing exposes loaded relation types", () => {
    const assertTypes = (author: TypedEAuthor): void => {
      author.loadMissing("books").then((loaded) => {
        expectType<Collection<TypedEBook>>(loaded.books);
      });
    };

    expect(assertTypes).toBeFunction();
  });

  test("with constrains eager loaded hasMany relation", async () => {
    const author = await EAuthor.create({ name: "Frank" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Published", published: true });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Draft", published: false });

    const authors = await EAuthor.with({ books: (query) => query.where("published", true).orderBy("title") })
      .where("name", "Frank")
      .get();

    const books = authors[0].getRelation("books");
    expect(books).toHaveLength(1);
    expect(books[0].getAttribute("title")).toBe("Published");
  });

  test("with constrains nested eager loaded relation without reloading parent relation", async () => {
    const author = await EAuthor.create({ name: "Grace" });
    const publicBook = await EBook.create({ author_id: author.getAttribute("id"), title: "Public", published: true });
    const draftBook = await EBook.create({ author_id: author.getAttribute("id"), title: "Private", published: false });
    await EChapter.create({ book_id: publicBook.getAttribute("id"), title: "Intro" });
    await EChapter.create({ book_id: publicBook.getAttribute("id"), title: "Appendix" });
    await EChapter.create({ book_id: draftBook.getAttribute("id"), title: "Secret" });

    const authors = await EAuthor.with(
      { books: (query) => query.where("published", true) },
      { "books.chapters": (query) => query.where("title", "Intro") }
    )
      .where("name", "Grace")
      .get();

    const books = authors[0].getRelation("books");
    expect(books).toHaveLength(1);
    expect(books[0].getAttribute("title")).toBe("Public");
    expect(books[0].getRelation("chapters").map((chapter: EChapter) => chapter.getAttribute("title"))).toEqual(["Intro"]);
  });

  test("nested eager loading uses one query per relation level", async () => {
    const first = await EAuthor.create({ name: "Query Count A" });
    const second = await EAuthor.create({ name: "Query Count B" });
    const firstBook = await EBook.create({ author_id: first.id, title: "Counted A" });
    const secondBook = await EBook.create({ author_id: second.id, title: "Counted B" });
    await EChapter.create({ book_id: firstBook.id, title: "Chapter A" });
    await EChapter.create({ book_id: secondBook.id, title: "Chapter B" });

    const connection = EAuthor.getConnection();
    const originalQuery = connection.query.bind(connection);
    const queries: string[] = [];
    connection.query = async (sql: string, bindings?: any[]) => {
      queries.push(sql);
      return await originalQuery(sql, bindings);
    };

    try {
      const authors = await EAuthor.with("books.chapters").whereIn("id", [first.id, second.id]).get();
      expect(authors).toHaveLength(2);
      expect(authors.flatMap((author) => author.books).map((book) => book.chapters[0].title)).toEqual([
        "Chapter A",
        "Chapter B",
      ]);
    } finally {
      connection.query = originalQuery;
    }

    expect(queries).toHaveLength(3);
  });

  test("load supports constrained eager loading", async () => {
    const author = await EAuthor.create({ name: "Helen" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Visible", published: true });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Hidden", published: false });

    await author.load({ books: (query) => query.where("published", true) });

    expect(author.getRelation("books").map((book: EBook) => book.getAttribute("title"))).toEqual(["Visible"]);
  });

  test("json includes eager loaded relations", async () => {
    const author = await EAuthor.create({ name: "Kate" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book K" });
    await EProfile.create({ author_id: author.getAttribute("id"), bio: "Bio K" });

    const found = await EAuthor.with("books", "profile").where("name", "Kate").first();
    expect(found).not.toBeNull();

    const json = found!.json();
    expect(json.name).toBe("Kate");
    expect(json.books).toBeInstanceOf(Array);
    expect(json.books).toHaveLength(1);
    expect(json.books[0].title).toBe("Book K");
    expect(json.profile).toBeInstanceOf(Object);
    expect(json.profile.bio).toBe("Bio K");
  });

  test("json includes null relation for missing hasOne", async () => {
    const author = await EAuthor.create({ name: "Leo" });

    const found = await EAuthor.with("profile").where("name", "Leo").first();
    expect(found).not.toBeNull();

    const json = found!.json();
    expect(json.profile).toBeNull();
  });

  test("json excludes relations hidden via makeHidden", async () => {
    const author = await EAuthor.create({ name: "Mia" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book M" });

    const found = await EAuthor.with("books").where("name", "Mia").first();
    expect(found).not.toBeNull();

    const json = found!.makeHidden("books").json();
    expect(json.name).toBe("Mia");
    expect(json).not.toHaveProperty("books");
  });

  test("json includes eager loaded relations by default", async () => {
    const author = await EAuthor.create({ name: "Noah" });
    await EBook.create({ author_id: author.getAttribute("id"), title: "Book N" });

    const found = await EAuthor.with("books").where("name", "Noah").first();
    expect(found).not.toBeNull();

    const json = found!.json();
    expect(json.name).toBe("Noah");
    expect(json.books).toBeInstanceOf(Array);
    expect(json.books).toHaveLength(1);
  });
});
