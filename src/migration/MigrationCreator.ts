import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

export class MigrationCreator {
  async create(name: string, path: string): Promise<string> {
    const stub = `import { Migration } from "@rekkr/orm";
import { Schema } from "@rekkr/orm";

export default class ${this.toClassName(name)} extends Migration {
  async up(): Promise<void> {
    // await Schema.create("table_name", (table) => {
    //   table.increments("id");
    //   table.timestamps();
    // });
  }

  async down(): Promise<void> {
    // await Schema.dropIfExists("table_name");
  }
}
`;
    return this.createWithContent(name, path, stub);
  }

  async createWithContent(name: string, path: string, content: string): Promise<string> {
    await mkdir(path, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const filename = `${timestamp}_${this.snakeCase(name)}.ts`;
    const filePath = join(path, filename);
    await writeFile(filePath, content, "utf-8");
    return filePath;
  }

  private snakeCase(str: string): string {
    return str
      .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
      .replace(/^_/g, "");
  }

  private toClassName(name: string): string {
    return name
      .split(/[_\-]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join("");
  }
}
