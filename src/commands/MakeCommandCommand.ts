import { Command } from "./Command.js";
import { normalizePathList } from "../utils.js";
import { mkdir, writeFile, access } from "fs/promises";
import { join } from "path";
import type { OrmConfig } from "../config/OrmConfig.js";

function toClassName(name: string): string {
  return name
    .split(/[_\-\s\/]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function toCommandSignature(className: string): string {
  const stripped = className.replace(/Command$/i, "");
  const kebab = stripped
    .replace(/([A-Z])/g, (m, l, i) => (i === 0 ? l : `-${l}`))
    .toLowerCase();
  return `app:${kebab}`;
}

function buildCommandStub(className: string, signature: string): string {
  return `import { Command } from "@rekkr/orm/commands";

export class ${className} extends Command {
  static signature = "${signature}";
  static description = "";

  async handle() {
    //
  }
}
`;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

export function makeMakeCommandCommand(config: OrmConfig) {
  return class MakeCommandCommand extends Command {
    static signature = "make:command {name : Command class name} {--dir= : Output directory} {--command= : Override the command signature}";
    static description = "Create a new command file.";

    async handle() {
      const rawName   = this.argument("name");
      const className = toClassName(rawName);

      const signature = (this.option("command") as string | undefined)
        ?? toCommandSignature(className);

      const commandsPaths = normalizePathList(config.commands?.commandsPath);
      const dir = (this.option("dir") as string | undefined)
        ?? commandsPaths[0]
        ?? "./app/commands";

      await mkdir(dir, { recursive: true });

      const fileName = className.endsWith("Command") ? className : `${className}Command`;
      const filePath = join(dir, `${fileName}.ts`);

      if (await exists(filePath)) {
        this.warn(`Skipped: ${filePath} already exists`);
        return;
      }

      await writeFile(filePath, buildCommandStub(fileName, signature), "utf-8");
      this.info(`Created command: ${filePath}`);
    }
  };
}
