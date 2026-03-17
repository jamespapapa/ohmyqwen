import { describe, expect, it } from "vitest";
import { loadLlmRuntimeSettings, resolveLlmModelProfile } from "../src/llm/settings.js";

describe("llm runtime settings", () => {
  it("includes gpt-5.2 in selectable built-in models", async () => {
    const settings = await loadLlmRuntimeSettings(process.cwd(), true);

    expect(settings.defaultModelId).toBe("Qwen3-235B-A22B-Instruct-2507-FP8");
    expect(settings.models.map((model) => model.id)).toEqual(
      expect.arrayContaining(["Qwen3-235B-A22B-Instruct-2507-FP8", "openai/gpt-5.2"])
    );
  });

  it("resolves gpt-5.2 profile when explicitly selected", async () => {
    const settings = await loadLlmRuntimeSettings(process.cwd(), true);
    const selected = resolveLlmModelProfile(settings, "openai/gpt-5.2");

    expect(selected.id).toBe("openai/gpt-5.2");
    expect(selected.label).toBe("GPT 5.2 (OpenCode)");
    expect(selected.contextWindowTokens).toBeGreaterThanOrEqual(32768);
  });
});
