// ABOUTME: Tests for the stderr logging helper.
// ABOUTME: Verifies log() writes to stderr and not stdout.

import { describe, it, expect, vi, afterEach } from "vitest";
import { log } from "./log.js";

describe("log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes to stderr", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    log("hello");
    expect(stderrSpy).toHaveBeenCalledWith("hello\n");
  });

  it("does not write to stdout", () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    log("hello");
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
