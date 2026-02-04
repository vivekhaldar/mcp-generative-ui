// ABOUTME: Pipe protocol for chaining with mcpblox via Unix pipes.
// ABOUTME: Reads upstream URL from stdin and writes own URL to stdout.

import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

interface ReadOptions {
  input?: Readable;
  timeoutMs?: number;
}

export function readUpstreamUrl(opts: ReadOptions = {}): Promise<string> {
  const input = opts.input ?? process.stdin;
  const timeoutMs = opts.timeoutMs ?? 120000;

  return new Promise((resolve, reject) => {
    const rl = createInterface({ input });
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        rl.close();
        reject(new Error("Timed out waiting for upstream URL on stdin"));
      }
    }, timeoutMs);

    rl.on("line", (line: string) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rl.close();
        resolve(line.trim());
      }
    });

    rl.on("close", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error("stdin closed before upstream URL was received"));
      }
    });
  });
}

export function writeUpstreamUrl(
  url: string,
  output: Writable = process.stdout,
): void {
  output.write(url + "\n");
}
