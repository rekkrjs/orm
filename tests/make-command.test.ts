import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { CommandRunner } from "../src/commands/CommandRunner.js";
import { makeMakeCommandCommand } from "../src/commands/MakeCommandCommand.js";
import { mkdir, rm, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { OrmConfig } from "../src/config/OrmConfig.js";

const baseConfig = { connection: { client: "pg", connection: {} } } as unknown as OrmConfig;

const runner = new CommandRunner();

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `make-command-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("make:command — file creation", () => {
  it("creates file with derived signature from PascalCase name", async () => {
    const cmd = makeMakeCommandCommand(baseConfig);
    await runner.run(cmd, ["SendEmailsCommand", `--dir=${tmpDir}`]);

    const content = await readFile(join(tmpDir, "SendEmailsCommand.ts"), "utf-8");
    expect(content).toContain("class SendEmailsCommand extends Command");
    expect(content).toContain('static signature = "app:send-emails"');
  });

  it("appends Command suffix when missing from name", async () => {
    const cmd = makeMakeCommandCommand(baseConfig);
    await runner.run(cmd, ["SendEmails", `--dir=${tmpDir}`]);

    const content = await readFile(join(tmpDir, "SendEmailsCommand.ts"), "utf-8");
    expect(content).toContain("class SendEmailsCommand");
  });

  it("uses --command option to override derived signature", async () => {
    const cmd = makeMakeCommandCommand(baseConfig);
    await runner.run(cmd, ["SendEmailsCommand", `--dir=${tmpDir}`, "--command=email:send"]);

    const content = await readFile(join(tmpDir, "SendEmailsCommand.ts"), "utf-8");
    expect(content).toContain('static signature = "email:send"');
  });

  it("uses config commandsPath as default dir", async () => {
    const config = {
      ...baseConfig,
      commands: { commandsPath: tmpDir },
    } as OrmConfig;

    const cmd = makeMakeCommandCommand(config);
    await runner.run(cmd, ["NotifyUserCommand"]);

    const content = await readFile(join(tmpDir, "NotifyUserCommand.ts"), "utf-8");
    expect(content).toContain("class NotifyUserCommand");
  });

  it("--dir overrides config commandsPath", async () => {
    const otherDir = join(tmpDir, "other");
    const config = {
      ...baseConfig,
      commands: { commandsPath: join(tmpDir, "config-path") },
    } as OrmConfig;

    const cmd = makeMakeCommandCommand(config);
    await runner.run(cmd, ["OverrideCommand", `--dir=${otherDir}`]);

    const content = await readFile(join(otherDir, "OverrideCommand.ts"), "utf-8");
    expect(content).toContain("class OverrideCommand");
  });

  it("creates nested dir if missing", async () => {
    const nestedDir = join(tmpDir, "deep", "nested");
    const cmd = makeMakeCommandCommand(baseConfig);
    await runner.run(cmd, ["DeepCommand", `--dir=${nestedDir}`]);

    const content = await readFile(join(nestedDir, "DeepCommand.ts"), "utf-8");
    expect(content).toContain("class DeepCommand");
  });

  it("skips and does not overwrite existing file", async () => {
    const filePath = join(tmpDir, "ExistingCommand.ts");
    await writeFile(filePath, "// original", "utf-8");

    const cmd = makeMakeCommandCommand(baseConfig);
    await runner.run(cmd, ["ExistingCommand", `--dir=${tmpDir}`]);

    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("// original");
  });
});

describe("make:command — class name derivation", () => {
  it("handles snake_case input", async () => {
    const cmd = makeMakeCommandCommand(baseConfig);
    await runner.run(cmd, ["send_emails", `--dir=${tmpDir}`]);

    const content = await readFile(join(tmpDir, "SendEmailsCommand.ts"), "utf-8");
    expect(content).toContain("class SendEmailsCommand");
  });

  it("handles kebab-case input", async () => {
    const cmd = makeMakeCommandCommand(baseConfig);
    await runner.run(cmd, ["send-emails", `--dir=${tmpDir}`]);

    const content = await readFile(join(tmpDir, "SendEmailsCommand.ts"), "utf-8");
    expect(content).toContain("class SendEmailsCommand");
  });
});

describe("make:command — stub content", () => {
  it("stub imports Command from @rekkr/orm/commands", async () => {
    const cmd = makeMakeCommandCommand(baseConfig);
    await runner.run(cmd, ["StubCheckCommand", `--dir=${tmpDir}`]);

    const content = await readFile(join(tmpDir, "StubCheckCommand.ts"), "utf-8");
    expect(content).toContain('import { Command } from "@rekkr/orm/commands"');
  });

  it("stub has empty handle method", async () => {
    const cmd = makeMakeCommandCommand(baseConfig);
    await runner.run(cmd, ["StubCheckCommand", `--dir=${tmpDir}`]);

    const content = await readFile(join(tmpDir, "StubCheckCommand.ts"), "utf-8");
    expect(content).toContain("async handle()");
  });
});
