// ABOUTME: Tests for cache key computation with prompt incorporation.
// ABOUTME: Verifies that custom prompts produce distinct cache keys.

import { describe, it, expect } from "vitest";
import { computeRefinementHash } from "./cache.js";

describe("computeRefinementHash with prompt", () => {
  it("returns 'none' for empty refinements and no prompt", () => {
    expect(computeRefinementHash([])).toBe("none");
  });

  it("produces different hash when prompt is included", () => {
    const withoutPrompt = computeRefinementHash([]);
    const withPrompt = computeRefinementHash(["||", "Use dark theme"]);
    expect(withoutPrompt).not.toBe(withPrompt);
  });

  it("produces different hashes for different prompts", () => {
    const hash1 = computeRefinementHash(["||", "Use dark theme"]);
    const hash2 = computeRefinementHash(["||", "Use light theme"]);
    expect(hash1).not.toBe(hash2);
  });

  it("same refinements + same prompt produce identical hash", () => {
    const hash1 = computeRefinementHash(["make it red", "||", "dark theme"]);
    const hash2 = computeRefinementHash(["make it red", "||", "dark theme"]);
    expect(hash1).toBe(hash2);
  });

  it("same refinements with vs without prompt produce different hashes", () => {
    const withoutPrompt = computeRefinementHash(["make it red"]);
    const withPrompt = computeRefinementHash(["make it red", "||", "dark theme"]);
    expect(withoutPrompt).not.toBe(withPrompt);
  });
});
