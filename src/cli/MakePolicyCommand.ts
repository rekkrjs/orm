import { Command } from "../commands/Command.js";
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

function ensurePolicySuffix(className: string): string {
  return className.endsWith("Policy") ? className : `${className}Policy`;
}

function buildPolicyStub(policyClass: string, modelName?: string): string {
  const modelType = modelName?.trim() ? modelName.trim() : "any";
  const header = modelName?.trim()
    ? `type ${modelType} = any;\n\n`
    : "";
  return `${header}export default class ${policyClass} {
  view(user: any, model: ${modelType}): boolean {
    return true;
  }

  create(user: any): boolean {
    return true;
  }

  update(user: any, model: ${modelType}): boolean {
    return true;
  }

  delete(user: any, model: ${modelType}): boolean {
    return true;
  }
}
`;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

export function makeMakePolicyCommand(config: OrmConfig) {
  return class extends Command.define("make:policy {name : Policy class name} {--model= : Related model class name} {--dir= : Directory to create the policy in}") {
    static description = "Create a new policy file.";

    async handle() {
      const rawName = this.argument("name");
      const modelName = this.option("model") as string | undefined;
      const policyClass = ensurePolicySuffix(toClassName(rawName));

      const policyRoots = config.policyPath
        ? normalizePathList(config.policyPath)
        : [];
      const hasSrcDir = await exists("./src");
      const outputDir = (this.option("dir") as string | undefined)
        ?? policyRoots[0]
        ?? (hasSrcDir ? "./src/policies" : "./app/policies");

      await mkdir(outputDir, { recursive: true });
      const policyPath = join(outputDir, `${policyClass}.ts`);
      if (await exists(policyPath)) {
        this.warn(`Skipped: ${policyPath} already exists`);
        return;
      }
      await writeFile(policyPath, buildPolicyStub(policyClass, modelName), "utf-8");
      this.info(`Created policy: ${policyPath}`);
    }
  };
}
