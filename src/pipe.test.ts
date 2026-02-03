// ABOUTME: Tests for the pipe protocol helpers.
// ABOUTME: Verifies reading upstream URL from stdin and writing to stdout.

import { describe, it, expect } from "vitest";
import { Readable, Writable } from "node:stream";
import { readUpstreamUrl, writeUpstreamUrl } from "./pipe.js";

function readableFrom(data: string): Readable {
  return new Readable({
    read() {
      this.push(data);
      this.push(null);
    },
  });
}

function collectWritable(): { stream: Writable; data: () => string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _encoding, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  return { stream, data: () => Buffer.concat(chunks).toString() };
}

describe("readUpstreamUrl", () => {
  it("reads the first line from input", async () => {
    const input = readableFrom("http://localhost:3000\n");
    const url = await readUpstreamUrl({ input });
    expect(url).toBe("http://localhost:3000");
  });

  it("trims whitespace from the URL", async () => {
    const input = readableFrom("  http://localhost:3000  \n");
    const url = await readUpstreamUrl({ input });
    expect(url).toBe("http://localhost:3000");
  });

  it("times out after configured timeout", async () => {
    // Stream that never emits data
    const input = new Readable({ read() {} });
    await expect(
      readUpstreamUrl({ input, timeoutMs: 50 }),
    ).rejects.toThrow("Timed out waiting for upstream URL on stdin");
  });

  it("rejects on EOF before receiving URL", async () => {
    const input = readableFrom("");
    await expect(readUpstreamUrl({ input })).rejects.toThrow(
      "stdin closed before upstream URL was received",
    );
  });

  it("only reads the first line when multiple lines are present", async () => {
    const input = readableFrom("http://first:3000\nhttp://second:4000\n");
    const url = await readUpstreamUrl({ input });
    expect(url).toBe("http://first:3000");
  });
});

describe("writeUpstreamUrl", () => {
  it("writes URL followed by newline", () => {
    const { stream, data } = collectWritable();
    writeUpstreamUrl("http://localhost:8080", stream);
    expect(data()).toBe("http://localhost:8080\n");
  });
});
