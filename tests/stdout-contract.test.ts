import { inspect } from "node:util";
import { describe, expect, test, isBun } from "./harness.js";
import { relayStdoutToStderr, writeToStdout } from "../src/cli/StdoutContract.js";

/**
 * The `--json` contract stands on this module: while it is installed, nothing
 * an application prints may reach stdout, and everything it prints must still
 * reach stderr. In Bun no console method goes through `process.stdout.write`,
 * so each one is covered here on purpose.
 */
interface Captured {
  stdout: string[];
  stderr: string[];
  release: () => void;
}

/**
 * Captures both streams *before* the relay is installed, so the relay adopts
 * these as the originals — console.error included, since Bun's console writes
 * to the file descriptor rather than through `process.stderr`.
 */
function capture(): Captured {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const realStdoutWrite = process.stdout.write;
  const realStderrWrite = process.stderr.write;
  const realError = console.error;

  process.stdout.write = ((chunk: any) => { stdout.push(String(chunk)); return true; }) as any;
  process.stderr.write = ((chunk: any) => { stderr.push(String(chunk)); return true; }) as any;
  console.error = (...args: any[]) => {
    stderr.push(args.map((arg) => (typeof arg === "string" ? arg : inspect(arg))).join(" "));
  };

  return {
    stdout,
    stderr,
    release: () => {
      process.stdout.write = realStdoutWrite;
      process.stderr.write = realStderrWrite;
      console.error = realError;
    },
  };
}

describe("stdout contract", () => {
  test("relays every console method that would reach stdout", () => {
    const captured = capture();
    const restore = relayStdoutToStderr();
    try {
      console.log("log line");
      console.info("info line");
      console.debug("debug line");
      console.dir({ dir: 1 });
      (console as any).dirxml?.({ dirxml: 1 });
      console.table([{ table: 1 }]);
      console.count("widgets");
      console.count("widgets");
      console.group("group label");
      console.log("inside the group");
      console.groupEnd();
      console.trace("trace line");
      (console as any).write?.("written without a newline");
      process.stdout.write("a direct stream write\n");
    } finally {
      restore();
      captured.release();
    }

    expect(captured.stdout).toEqual([]);
    const relayed = captured.stderr.join("\n");
    for (const expected of [
      "log line",
      "info line",
      "debug line",
      "dir: 1",
      "dirxml: 1",
      "table",
      "widgets: 1",
      "widgets: 2",
      "group label",
      "inside the group",
      "trace line",
      // console.write() is Bun's own.
      ...(isBun ? ["written without a newline"] : []),
      "a direct stream write",
    ]) {
      expect(relayed).toContain(expected);
    }
  });

  test("lets the payload through to the real stdout", () => {
    const captured = capture();
    const restore = relayStdoutToStderr();
    try {
      console.log("noise");
      writeToStdout('{"applied":[]}\n');
    } finally {
      restore();
      captured.release();
    }

    expect(captured.stdout).toEqual(['{"applied":[]}\n']);
    expect(captured.stderr.join("\n")).toContain("noise");
  });

  test("puts the original functions back, by identity", () => {
    const before = {
      log: console.log,
      table: console.table,
      count: console.count,
      group: console.group,
      groupEnd: console.groupEnd,
      trace: console.trace,
      write: (console as any).write,
      streamWrite: process.stdout.write,
      bunStdout: isBun ? Bun.stdout : undefined,
    };

    const restore = relayStdoutToStderr();
    expect(console.log).not.toBe(before.log);
    if (isBun) expect(Bun.stdout).toBe(Bun.stderr);
    restore();

    expect(console.log).toBe(before.log);
    expect(console.table).toBe(before.table);
    expect(console.count).toBe(before.count);
    expect(console.group).toBe(before.group);
    expect(console.groupEnd).toBe(before.groupEnd);
    expect(console.trace).toBe(before.trace);
    expect((console as any).write).toBe(before.write);
    expect(process.stdout.write).toBe(before.streamWrite);
    if (isBun) expect(Bun.stdout).toBe(before.bunStdout!);
  });

  test("stays installed until the last handle is released, in any order", () => {
    const captured = capture();
    const originalLog = console.log;
    const outer = relayStdoutToStderr();
    const inner = relayStdoutToStderr();

    try {
      // The outer command finishes first — the inner one is still under contract.
      outer();
      console.log("still relayed");
      expect(captured.stdout).toEqual([]);
      expect(captured.stderr.join("\n")).toContain("still relayed");
      expect(console.log).not.toBe(originalLog);

      // Releasing the last handle, whichever it is, tears the relay down.
      inner();
      expect(console.log).toBe(originalLog);
    } finally {
      captured.release();
    }
  });

  test("releasing the same handle twice does not free someone else's", () => {
    const captured = capture();
    const first = relayStdoutToStderr();
    const second = relayStdoutToStderr();

    try {
      first();
      first();
      console.log("still relayed");
      expect(captured.stdout).toEqual([]);
    } finally {
      second();
      captured.release();
    }
  });
});
