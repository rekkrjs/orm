import { describe, it, expect, beforeEach, afterEach } from "./harness.js";
import { parseSignature, parseSignatureName } from "../src/commands/SignatureParser.js";
import {
  Command,
  defineCommand,
  registerCommand,
  resolveCommand,
  listCommands,
  clearCommands,
  isCommandConstructor,
} from "../src/commands/Command.js";
import { CommandRunner } from "../src/commands/CommandRunner.js";
import { setPromptService, type PromptService } from "../src/commands/Prompt.js";
import { registerOrmCommands } from "../src/cli/index.js";
import { Connection } from "../src/connection/Connection.js";
import type { OrmConfig } from "../src/config/OrmConfig.js";

// ─── SignatureParser ───────────────────────────────────────────────────────────

describe("parseSignatureName", () => {
  it("extracts command name", () => {
    expect(parseSignatureName("email:send {user}")).toBe("email:send");
    expect(parseSignatureName("migrate")).toBe("migrate");
    expect(parseSignatureName("  db:seed  {--fresh} ")).toBe("db:seed");
  });
});

describe("parseSignature", () => {
  it("parses required argument", () => {
    const sig = parseSignature("email:send {user}");
    expect(sig.name).toBe("email:send");
    expect(sig.args).toHaveLength(1);
    expect(sig.args[0]).toMatchObject({ name: "user", required: true, variadic: false });
  });

  it("parses optional argument", () => {
    const sig = parseSignature("cmd {file?}");
    expect(sig.args[0]).toMatchObject({ name: "file", required: false, variadic: false });
  });

  it("parses variadic argument", () => {
    const sig = parseSignature("cmd {files*}");
    expect(sig.args[0]).toMatchObject({ name: "files", required: false, variadic: true });
  });

  it("parses argument with default", () => {
    const sig = parseSignature("cmd {env=production}");
    expect(sig.args[0]).toMatchObject({ name: "env", required: false, defaultValue: "production" });
  });

  it("parses boolean option", () => {
    const sig = parseSignature("cmd {--force}");
    expect(sig.options[0]).toMatchObject({ name: "force", type: "boolean" });
  });

  it("parses string option with default", () => {
    const sig = parseSignature("cmd {--queue=default}");
    expect(sig.options[0]).toMatchObject({ name: "queue", type: "string", defaultValue: "default" });
  });

  it("parses string option without default", () => {
    const sig = parseSignature("cmd {--output=}");
    expect(sig.options[0]).toMatchObject({ name: "output", type: "string", defaultValue: undefined });
  });

  it("parses inline description", () => {
    const sig = parseSignature("cmd {user : The user email}");
    expect(sig.args[0]).toMatchObject({ name: "user", description: "The user email" });
  });

  it("parses option inline description", () => {
    const sig = parseSignature("cmd {--force : Skip confirmation}");
    expect(sig.options[0]).toMatchObject({ name: "force", description: "Skip confirmation" });
  });

  it("parses mixed args and options", () => {
    const sig = parseSignature("email:send {user} {subject?} {--queue=default} {--force}");
    expect(sig.name).toBe("email:send");
    expect(sig.args).toHaveLength(2);
    expect(sig.options).toHaveLength(2);
    expect(sig.args[0].name).toBe("user");
    expect(sig.args[1].name).toBe("subject");
    expect(sig.options[0].name).toBe("queue");
    expect(sig.options[1].name).toBe("force");
  });

  it("handles no args or options", () => {
    const sig = parseSignature("db:migrate");
    expect(sig.name).toBe("db:migrate");
    expect(sig.args).toHaveLength(0);
    expect(sig.options).toHaveLength(0);
  });
});

// ─── Registry ─────────────────────────────────────────────────────────────────

describe("Command registry", () => {
  beforeEach(() => clearCommands());

  it("registers and resolves class-based command", () => {
    class PingCommand extends Command {
      static signature = "ping";
      async handle() {}
    }
    registerCommand(PingCommand);
    expect(resolveCommand("ping")).toBe(PingCommand);
  });

  it("registers and resolves function-based command", () => {
    const cmd = defineCommand({ signature: "pong", async handle() {} });
    registerCommand(cmd);
    expect(resolveCommand("pong")).toBe(cmd);
  });

  it("listCommands returns all registered", () => {
    class A extends Command { static signature = "a"; async handle() {} }
    const b = defineCommand({ signature: "b", async handle() {} });
    registerCommand(A);
    registerCommand(b);
    expect(listCommands()).toHaveLength(2);
  });

  it("isCommandConstructor distinguishes class from definition", () => {
    class A extends Command { static signature = "a"; async handle() {} }
    const b = defineCommand({ signature: "b", async handle() {} });
    expect(isCommandConstructor(A)).toBe(true);
    expect(isCommandConstructor(b)).toBe(false);
  });

  it("overwrites existing command with same name", () => {
    class V1 extends Command { static signature = "cmd"; async handle() {} }
    class V2 extends Command { static signature = "cmd"; async handle() {} }
    registerCommand(V1);
    registerCommand(V2);
    expect(resolveCommand("cmd")).toBe(V2);
  });
});

describe("built-in command registration", () => {
  it("registers every core, queue and search command only when its feature is configured", async () => {
    const connection = new Connection({ url: "sqlite://:memory:" });
    const core = [
      "db:seed", "make:command", "make:migration", "make:model", "make:policy",
      "migrate", "migrate:fresh", "migrate:refresh", "migrate:reset", "migrate:rollback", "migrate:status",
      "queue:install", "schema:dump", "schema:squash", "types:generate",
    ];
    const search = [
      "make:searchable", "search:create-index", "search:delete-index", "search:flush",
      "search:fts:optimize", "search:fts:rebuild", "search:import", "search:list-indexes",
      "search:reimport", "search:reindex", "search:status", "search:sync-index-settings", "search:verify",
    ];
    const names = () => listCommands().map((entry) => parseSignatureName(entry.signature)).sort();
    try {
      clearCommands();
      registerOrmCommands({} as OrmConfig, connection);
      expect(names()).toEqual([...core].sort());

      clearCommands();
      registerOrmCommands({ queue: {}, search: {} } as OrmConfig, connection);
      expect(names()).toEqual([...core, "make:job", ...search].sort());
    } finally {
      clearCommands();
      await connection.close();
    }
  });
});

// ─── CommandRunner ─────────────────────────────────────────────────────────────

describe("CommandRunner — class-based", () => {
  const runner = new CommandRunner();

  it("injects required argument", async () => {
    let received: string | undefined;
    class GreetCommand extends Command {
      static signature = "greet {name}";
      async handle() { received = this.argument("name"); }
    }
    await runner.run(GreetCommand, ["Alice"]);
    expect(received).toBe("Alice");
  });

  it("sets exitCode 1 on missing required argument", async () => {
    class NeedArg extends Command {
      static signature = "need {arg}";
      async handle() { this.argument("arg"); }
    }
    await runner.run(NeedArg, []);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("provides default for optional argument", async () => {
    let received: string | undefined;
    class EnvCmd extends Command {
      static signature = "deploy {env=production}";
      async handle() { received = this.argumentOptional("env"); }
    }
    await runner.run(EnvCmd, []);
    expect(received).toBe("production");
  });

  it("injects variadic argument as array", async () => {
    let received: string[] = [];
    class FilesCmd extends Command {
      static signature = "process {files*}";
      async handle() { received = this.argumentArray("files"); }
    }
    await runner.run(FilesCmd, ["a.ts", "b.ts", "c.ts"]);
    expect(received).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("injects boolean option defaulting to false", async () => {
    let received: string | boolean | undefined;
    class ForceCmd extends Command {
      static signature = "push {--force}";
      async handle() { received = this.option("force"); }
    }
    await runner.run(ForceCmd, []);
    expect(received).toBe(false);
  });

  it("injects boolean option when flag present", async () => {
    let received: string | boolean | undefined;
    class ForceCmd extends Command {
      static signature = "push {--force}";
      async handle() { received = this.option("force"); }
    }
    await runner.run(ForceCmd, ["--force"]);
    expect(received).toBe(true);
  });

  it("parses explicit boolean values instead of treating false as truthy", async () => {
    const received: boolean[] = [];
    class ForceCmd extends Command {
      static signature = "push {--force}";
      async handle() { received.push(this.option("force") as boolean); }
    }
    await runner.run(ForceCmd, ["--force=false"]);
    await runner.run(ForceCmd, ["--force=true"]);
    expect(received).toEqual([false, true]);
  });

  it("rejects invalid explicit boolean values", async () => {
    let handled = false;
    class ForceCmd extends Command {
      static signature = "push {--force}";
      async handle() { handled = true; }
    }
    await runner.run(ForceCmd, ["--force=maybe"]);
    expect(handled).toBe(false);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("injects string option with default", async () => {
    let received: string | boolean | undefined;
    class QueueCmd extends Command {
      static signature = "dispatch {--queue=default}";
      async handle() { received = this.option("queue"); }
    }
    await runner.run(QueueCmd, []);
    expect(received).toBe("default");
  });

  it("injects string option override", async () => {
    let received: string | boolean | undefined;
    class QueueCmd extends Command {
      static signature = "dispatch {--queue=default}";
      async handle() { received = this.option("queue"); }
    }
    await runner.run(QueueCmd, ["--queue=critical"]);
    expect(received).toBe("critical");
  });

  it("handles mixed args and options", async () => {
    let user = "", queue: string | boolean | undefined, force: string | boolean | undefined;
    class SendCmd extends Command {
      static signature = "email:send {user} {--queue=default} {--force}";
      async handle() {
        user = this.argument("user");
        queue = this.option("queue");
        force = this.option("force");
      }
    }
    await runner.run(SendCmd, ["alice@example.com", "--queue=emails", "--force"]);
    expect(user).toBe("alice@example.com");
    expect(queue).toBe("emails");
    expect(force).toBe(true);
  });
});

describe("CommandRunner — function-based", () => {
  const runner = new CommandRunner();

  it("injects argument via context", async () => {
    let received: string | undefined;
    const cmd = defineCommand({
      signature: "greet {name}",
      async handle({ argument }) { received = argument("name"); },
    });
    await runner.run(cmd, ["Bob"]);
    expect(received).toBe("Bob");
  });

  it("injects option via context", async () => {
    let received: string | boolean | undefined;
    const cmd = defineCommand({
      signature: "push {--force}",
      async handle({ option }) { received = option("force"); },
    });
    await runner.run(cmd, ["--force"]);
    expect(received).toBe(true);
  });

  it("provides default option via context", async () => {
    let received: string | boolean | undefined;
    const cmd = defineCommand({
      signature: "deploy {--env=production}",
      async handle({ option }) { received = option("env"); },
    });
    await runner.run(cmd, []);
    expect(received).toBe("production");
  });

  it("injects variadic args via context", async () => {
    let received: string[] = [];
    const cmd = defineCommand({
      signature: "process {files*}",
      async handle({ argumentArray }) { received = argumentArray("files"); },
    });
    await runner.run(cmd, ["a.ts", "b.ts"]);
    expect(received).toEqual(["a.ts", "b.ts"]);
  });

  it("sets exitCode 1 on missing required argument via context", async () => {
    const cmd = defineCommand({
      signature: "need {arg}",
      async handle({ argument }) { argument("arg"); },
    });
    await runner.run(cmd, []);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe("Command prompts", () => {
  const runner = new CommandRunner();
  const calls: string[] = [];

  beforeEach(() => {
    calls.length = 0;
    const mockPromptService: PromptService = {
      async prompt(question: string, defaultValue?: string): Promise<string> {
        calls.push(`prompt:${question}:${defaultValue ?? ""}`);
        return "Jane Doe";
      },
      async confirm(question: string, defaultValue?: boolean): Promise<boolean> {
        calls.push(`confirm:${question}:${String(defaultValue)}`);
        return true;
      },
    };
    setPromptService(mockPromptService);
  });

  afterEach(() => {
    setPromptService(null);
  });

  it("supports prompt/confirm in class-based commands", async () => {
    let name = "";
    let approved = false;
    class AskCommand extends Command {
      static signature = "ask";
      async handle() {
        name = await this.prompt("Name", "Guest");
        approved = await this.confirm("Proceed?", false);
      }
    }
    await runner.run(AskCommand, []);
    expect(name).toBe("Jane Doe");
    expect(approved).toBe(true);
    expect(calls).toEqual([
      "prompt:Name:Guest",
      "confirm:Proceed?:false",
    ]);
  });

  it("supports prompt/confirm in function-based commands", async () => {
    let name = "";
    let approved = false;
    const cmd = defineCommand({
      signature: "ask:fn",
      async handle(ctx) {
        name = await ctx.prompt("Your name");
        approved = await ctx.confirm("Save?", true);
      },
    });

    await runner.run(cmd, []);
    expect(name).toBe("Jane Doe");
    expect(approved).toBe(true);
    expect(calls).toEqual([
      "prompt:Your name:",
      "confirm:Save?:true",
    ]);
  });
});

describe("Command output helpers", () => {
  it("info/warn/error/line exist on instance", () => {
    class TestCmd extends Command {
      static signature = "test";
      async handle() {}
    }
    const instance = new TestCmd();
    expect(typeof instance.info).toBe("function");
    expect(typeof instance.warn).toBe("function");
    expect(typeof instance.error).toBe("function");
    expect(typeof instance.line).toBe("function");
  });
});
