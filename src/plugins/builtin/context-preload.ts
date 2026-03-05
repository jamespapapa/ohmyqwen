import { promises as fs } from "node:fs";
import path from "node:path";
import { RuntimePlugin } from "../types.js";

interface PreloadFile {
  small?: string[];
  mid?: string[];
  big?: string[];
}

async function loadPreload(cwd: string): Promise<PreloadFile> {
  const preloadPath = path.resolve(cwd, ".ohmyqwen", "cache", "context-preload.json");
  try {
    const raw = await fs.readFile(preloadPath, "utf8");
    const parsed = JSON.parse(raw) as PreloadFile;
    return parsed;
  } catch {
    return {};
  }
}

function selectTierContext(preload: PreloadFile, tier: "small" | "mid" | "big"): string[] {
  if (tier === "small") {
    return preload.small ?? [];
  }

  if (tier === "mid") {
    return [...(preload.small ?? []), ...(preload.mid ?? [])];
  }

  return [...(preload.small ?? []), ...(preload.mid ?? []), ...(preload.big ?? [])];
}

export function createContextPreloadPlugin(): RuntimePlugin {
  return {
    name: "context-preload",
    async beforePlan(context) {
      const preload = await loadPreload(context.cwd);
      const selected = selectTierContext(preload, context.input.contextTier);

      if (selected.length === 0) {
        return {
          summary: "context preload unavailable",
          warnings: ["No context-preload cache found; continuing without preload"]
        };
      }

      return {
        summary: `loaded ${selected.length} preload context lines`,
        context: selected.slice(0, 40),
        metadata: {
          tier: context.input.contextTier,
          lines: selected.length
        }
      };
    }
  };
}
