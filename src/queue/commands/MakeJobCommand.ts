import { Command } from "../../commands/Command.js";
import { normalizePathList } from "../../utils.js";
import { mkdir, writeFile, access } from "fs/promises";
import { join } from "path";
import type { OrmConfig } from "../../config/OrmConfig.js";

function toClassName(name: string): string {
  return name
    .split(/[_\-\s\/]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function buildJobStub(className: string, queue: string): string {
  return `import { DispatchableJob, registerJob } from "@rekkr/orm/queue";

export default class ${className} extends DispatchableJob {
  static queue = "${queue}";
  static maxAttempts = 3;
  static delay = 0;

  async handle(): Promise<void> {
    //
  }
}

registerJob(${className});
`;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

export function makeMakeJobCommand(config: OrmConfig) {
  return class MakeJobCommand extends Command {
    static signature = "make:job {name : Job class name} {--queue= : Queue name} {--dir= : Output directory}";
    static description = "Create a new job file.";

    async handle() {
      const rawName   = this.argument("name");
      const className = toClassName(rawName);
      const queue     = (this.option("queue") as string | undefined) ?? "default";

      const jobsPaths = config.queue?.jobsPath
        ? normalizePathList(config.queue.jobsPath)
        : [];
      const dir = (this.option("dir") as string | undefined)
        ?? jobsPaths[0]
        ?? "./src/jobs";

      await mkdir(dir, { recursive: true });

      const fileName = className.endsWith("Job") ? className : `${className}Job`;
      const filePath = join(dir, `${fileName}.ts`);

      if (await exists(filePath)) {
        this.warn(`Skipped: ${filePath} already exists`);
        return;
      }

      await writeFile(filePath, buildJobStub(fileName, queue), "utf-8");
      this.info(`Created job: ${filePath}`);
    }
  };
}