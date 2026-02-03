// ABOUTME: In-memory cache with filesystem persistence for generated UIs.
// ABOUTME: Cache key is computed from tool name, schema hash, and refinement hash.

import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { log } from "./log.js";

export interface CacheEntry {
  html: string;
  generatedAt: string;
  toolName: string;
  schemaHash: string;
  refinementHash: string;
}

export interface Cache {
  get(toolName: string, schemaHash: string, refinementHash: string): CacheEntry | undefined;
  set(toolName: string, schemaHash: string, refinementHash: string, html: string): void;
  invalidate(toolName: string): void;
  save(): void;
  load(): void;
}

export function createCache(cacheDir: string): Cache {
  const cacheFile = join(cacheDir, "cache.json");
  const entries = new Map<string, CacheEntry>();

  function computeKey(toolName: string, schemaHash: string, refinementHash: string): string {
    return `${toolName}:${schemaHash}:${refinementHash}`;
  }

  return {
    get(toolName: string, schemaHash: string, refinementHash: string): CacheEntry | undefined {
      const key = computeKey(toolName, schemaHash, refinementHash);
      return entries.get(key);
    },

    set(toolName: string, schemaHash: string, refinementHash: string, html: string): void {
      const key = computeKey(toolName, schemaHash, refinementHash);
      entries.set(key, {
        html,
        generatedAt: new Date().toISOString(),
        toolName,
        schemaHash,
        refinementHash,
      });
      // Auto-save on write
      this.save();
    },

    invalidate(toolName: string): void {
      // Remove all entries for this tool
      for (const [key, entry] of entries) {
        if (entry.toolName === toolName) {
          entries.delete(key);
        }
      }
      this.save();
    },

    save(): void {
      try {
        const dir = dirname(cacheFile);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        const data = Object.fromEntries(entries);
        writeFileSync(cacheFile, JSON.stringify(data, null, 2));
      } catch (err) {
        log(`Failed to save cache: ${err}`);
      }
    },

    load(): void {
      try {
        if (existsSync(cacheFile)) {
          const data = JSON.parse(readFileSync(cacheFile, "utf-8"));
          entries.clear();
          for (const [key, entry] of Object.entries(data)) {
            entries.set(key, entry as CacheEntry);
          }
          log(`Loaded ${entries.size} cached UI(s) from disk`);
        }
      } catch (err) {
        log(`Failed to load cache: ${err}`);
      }
    },
  };
}

export function computeSchemaHash(schema: Record<string, unknown>): string {
  const json = JSON.stringify(schema, Object.keys(schema).sort());
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}

export function computeRefinementHash(refinements: string[]): string {
  if (refinements.length === 0) {
    return "none";
  }
  const joined = refinements.join("|");
  return createHash("sha256").update(joined).digest("hex").slice(0, 16);
}
