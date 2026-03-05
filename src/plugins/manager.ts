import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PluginContribution } from "../core/types.js";
import { createContextPreloadPlugin } from "./builtin/context-preload.js";
import { createGitlabLogsPlugin } from "./builtin/gitlab-logs.js";
import {
  LoadedPlugin,
  PluginExecutionContext,
  PluginManagerResult,
  PluginPhase,
  RuntimePlugin
} from "./types.js";

const PluginConfigSchema = z.object({
  plugins: z
    .array(
      z.object({
        name: z.string().min(1),
        enabled: z.boolean().default(true),
        options: z.record(z.string(), z.unknown()).default({})
      })
    )
    .default([
      { name: "context-preload", enabled: true, options: {} },
      { name: "gitlab-logs", enabled: true, options: {} }
    ])
});

type PluginConfig = z.infer<typeof PluginConfigSchema>;

function getBuiltinRegistry(): Record<string, RuntimePlugin> {
  return {
    "context-preload": createContextPreloadPlugin(),
    "gitlab-logs": createGitlabLogsPlugin()
  };
}

async function readPluginConfig(cwd: string): Promise<PluginConfig> {
  const configPath = path.resolve(cwd, "config", "plugins.json");
  try {
    const raw = await fs.readFile(configPath, "utf8");
    return PluginConfigSchema.parse(JSON.parse(raw));
  } catch {
    return PluginConfigSchema.parse({});
  }
}

export class PluginManager {
  private constructor(private readonly plugins: LoadedPlugin[]) {}

  public static async create(cwd = process.cwd()): Promise<PluginManager> {
    const config = await readPluginConfig(cwd);
    const registry = getBuiltinRegistry();

    const loaded: LoadedPlugin[] = [];
    for (const entry of config.plugins) {
      const plugin = registry[entry.name];
      if (!plugin) {
        continue;
      }

      loaded.push({
        name: entry.name,
        plugin,
        enabled: entry.enabled,
        options: entry.options
      });
    }

    return new PluginManager(loaded);
  }

  public async runHook(
    phase: PluginPhase,
    context: PluginExecutionContext
  ): Promise<PluginManagerResult> {
    const contributions: PluginContribution[] = [];
    const warnings: string[] = [];

    for (const loaded of this.plugins) {
      if (!loaded.enabled) {
        continue;
      }

      const hook = loaded.plugin[phase];
      if (!hook) {
        continue;
      }

      try {
        const result = await hook(context);
        if (!result) {
          continue;
        }

        if (result.warnings) {
          warnings.push(...result.warnings.map((line) => `[${loaded.name}] ${line}`));
        }

        contributions.push({
          plugin: loaded.name,
          phase,
          summary: result.summary,
          context: result.context,
          warnings: result.warnings,
          metadata: result.metadata
        });
      } catch (error) {
        warnings.push(
          `[${loaded.name}] hook ${phase} failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return {
      contributions,
      warnings
    };
  }
}
