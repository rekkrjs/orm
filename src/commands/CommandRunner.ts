import { parseArgs, styleText } from "node:util";
import { parseSignature, type ParsedSignature } from "./SignatureParser.js";
import { getPromptService } from "./Prompt.js";
import {
  Command,
  isCommandConstructor,
  type CommandContext,
  type CommandEntry,
} from "./Command.js";

const ANSI = {
  green:  (s: string) => styleText("green", s),
  yellow: (s: string) => styleText("yellow", s, { stream: process.stderr }),
  red:    (s: string) => styleText(["bgRed", "whiteBright"], s, { stream: process.stderr }),
};

function format(msg: string | object): string {
  return typeof msg === "string" ? msg : JSON.stringify(msg, null, 2);
}

/** Normalize the forms accepted by parseArgs for a declared boolean option. */
export function parseBooleanOptionValue(
  value: string | boolean | undefined,
  name: string,
): boolean | undefined {
  if (value === undefined || typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`--${name} must be true or false, got "${value}".`);
}

export class CommandRunner {
  async run(entry: CommandEntry, rawArgs: string[]): Promise<void> {
    const signature = isCommandConstructor(entry) ? entry.signature : entry.signature;

    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
      this.printHelp(parseSignature(signature), isCommandConstructor(entry) ? entry.description : entry.description);
      return;
    }

    const sig = parseSignature(signature);

    let args: Record<string, string | string[] | undefined>;
    let options: Record<string, string | boolean | undefined>;
    try {
      ({ args, options } = this.parseRawArgs(sig, rawArgs));
    } catch (err) {
      console.error(ANSI.red(`\n Error: ${err instanceof Error ? err.message : String(err)} `));
      this.printHelp(sig, isCommandConstructor(entry) ? entry.description : entry.description, "stderr");
      process.exitCode = 1;
      return;
    }

    try {
      if (isCommandConstructor(entry)) {
        const instance = new entry();
        instance._parsedArgs = args;
        instance._parsedOptions = options;
        await instance.handle();
      } else {
        const ctx = this.buildContext(args, options);
        await entry.handle(ctx);
      }
    } catch (err) {
      console.error(ANSI.red(`\n Error: ${err instanceof Error ? err.message : String(err)} `));
      this.printHelp(sig, isCommandConstructor(entry) ? entry.description : entry.description, "stderr");
      process.exitCode = 1;
    }
  }

  private parseRawArgs(
    sig: ParsedSignature,
    rawArgs: string[],
  ): {
    args: Record<string, string | string[] | undefined>;
    options: Record<string, string | boolean | undefined>;
  } {
    // Build parseArgs options config from signature options
    const optionsConfig: Record<string, { type: "string" | "boolean"; default?: string | boolean }> = {};
    for (const opt of sig.options) {
      optionsConfig[opt.name] = {
        type: opt.type,
        ...(opt.defaultValue !== undefined
          ? { default: opt.type === "boolean" ? opt.defaultValue === "true" : opt.defaultValue }
          : {}),
      };
    }

    const { values, positionals } = parseArgs({
      args: rawArgs,
      options: optionsConfig,
      allowPositionals: true,
      strict: false,
    });

    // Map positionals to named args by order
    const parsedArgs: Record<string, string | string[] | undefined> = {};
    let positionalIdx = 0;

    for (const argDef of sig.args) {
      if (argDef.variadic) {
        const rest = positionals.slice(positionalIdx);
        parsedArgs[argDef.name] = rest.length > 0 ? rest : argDef.defaultValue ? [argDef.defaultValue] : [];
        positionalIdx = positionals.length;
      } else {
        const val = positionals[positionalIdx];
        if (val !== undefined) {
          parsedArgs[argDef.name] = val;
          positionalIdx++;
        } else if (argDef.defaultValue !== undefined) {
          parsedArgs[argDef.name] = argDef.defaultValue;
        } else if (argDef.required) {
          throw new Error(`Missing required argument: ${argDef.name}`);
        }
      }
    }

    // Map options — apply defaults for any not provided
    const parsedOptions: Record<string, string | boolean | undefined> = {};
    for (const opt of sig.options) {
      const val = values[opt.name];
      if (val !== undefined) {
        parsedOptions[opt.name] = opt.type === "boolean"
          ? parseBooleanOptionValue(val as string | boolean, opt.name)
          : val as string;
      } else if (opt.defaultValue !== undefined) {
        parsedOptions[opt.name] = opt.type === "boolean" ? opt.defaultValue === "true" : opt.defaultValue;
      } else if (opt.type === "boolean") {
        parsedOptions[opt.name] = false;
      }
    }

    return { args: parsedArgs, options: parsedOptions };
  }

  private buildContext(
    args: Record<string, string | string[] | undefined>,
    options: Record<string, string | boolean | undefined>,
  ): CommandContext {
    return {
      argument(name) {
        const val = args[name];
        if (val === undefined || val === null) throw new Error(`Missing required argument: ${name}`);
        return Array.isArray(val) ? (val[0] ?? "") : val;
      },
      argumentOptional(name) {
        const val = args[name];
        if (val === undefined || val === null) return undefined;
        return Array.isArray(val) ? val[0] : val;
      },
      argumentArray(name) {
        const val = args[name];
        if (!val) return [];
        return Array.isArray(val) ? val : [val];
      },
      option(name) {
        return options[name];
      },
      prompt(question, defaultValue) {
        return getPromptService().prompt(question, defaultValue);
      },
      confirm(question, defaultValue) {
        return getPromptService().confirm(question, defaultValue);
      },
      info(msg)  { console.log(ANSI.green(format(msg))); },
      warn(msg)  { console.warn(ANSI.yellow(format(msg))); },
      error(msg) { console.error(ANSI.red(format(msg))); },
      line(msg = "") { console.log(format(msg)); },
    };
  }

  // Usage printed because something failed goes to stderr: a command's stdout
  // may be a contract (`--json`), and help text would corrupt it.
  private printHelp(sig: ParsedSignature, description?: string, stream: "stdout" | "stderr" = "stdout"): void {
    const out = stream === "stderr" ? console.error : console.log;
    const c = {
      dim:    (s: string) => styleText("dim", s),
      bold:   (s: string) => styleText("bold", s),
      green:  (s: string) => styleText("green", s),
      yellow: (s: string) => styleText("yellow", s),
      cyan:   (s: string) => styleText("cyan", s),
    };

    const usageArgs = sig.args.map((a) => {
      if (a.variadic) return c.dim(` [${a.name}...]`);
      if (!a.required) return c.dim(` [${a.name}]`);
      return ` ${c.green(`<${a.name}>`)}`;
    }).join("");

    out(`\n${c.bold("Usage:")} orm run ${c.yellow(sig.name)}${usageArgs}${sig.options.length ? c.dim(" [options]") : ""}\n`);

    if (description) {
      out(`  ${description}\n`);
    }

    if (sig.args.length > 0) {
      out(c.bold("Arguments:"));
      for (const a of sig.args) {
        const label = a.variadic ? `${a.name}...` : a.required ? a.name : `${a.name}?`;
        const def = a.defaultValue ? c.dim(` (default: ${a.defaultValue})`) : "";
        const desc = a.description ? `  ${a.description}` : "";
        out(`  ${c.green(label.padEnd(20))}${def}${desc}`);
      }
      out("");
    }

    if (sig.options.length > 0) {
      out(c.bold("Options:"));
      for (const o of sig.options) {
        const flag = o.type === "boolean" ? `--${o.name}` : `--${o.name}=<value>`;
        const def = o.defaultValue ? c.dim(` (default: ${o.defaultValue})`) : "";
        const desc = o.description ? `  ${o.description}` : "";
        out(`  ${c.cyan(flag.padEnd(22))}${def}${desc}`);
      }
      out("");
    }
  }
}
