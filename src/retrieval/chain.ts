import { createProviderRegistry, PROVIDER_EXECUTION_ORDER } from "./factory.js";
import {
  RetrievalChainResult,
  RetrievalDocument,
  RetrievalHit,
  RetrievalProviderName,
  RetrievalProviderResult,
  RetrievalQuery,
  ResolvedRetrievalConfig
} from "./types.js";
import { sortHits, withTimeout } from "./utils.js";

function providerTimeout(config: ResolvedRetrievalConfig, provider: RetrievalProviderName): number {
  if (provider === "qmd") {
    return Math.max(config.timeoutMs.qmd * 2, config.timeoutMs.provider);
  }

  if (provider === "semantic") {
    return config.timeoutMs.semantic;
  }

  return config.timeoutMs.provider;
}

function mergeHits(primaryHits: RetrievalHit[], secondaryHits: RetrievalHit[], topK: number): RetrievalHit[] {
  const merged = new Map<string, RetrievalHit>();

  for (const hit of primaryHits) {
    merged.set(hit.path, {
      path: hit.path,
      score: hit.score * 0.7,
      reasons: [...hit.reasons, "merge:primary"]
    });
  }

  for (const hit of secondaryHits) {
    const existing = merged.get(hit.path);
    if (!existing) {
      merged.set(hit.path, {
        path: hit.path,
        score: hit.score * 0.3,
        reasons: [...hit.reasons, "merge:secondary"]
      });
      continue;
    }

    merged.set(hit.path, {
      path: hit.path,
      score: existing.score + hit.score * 0.3,
      reasons: [...existing.reasons, ...hit.reasons, "merge:secondary"]
    });
  }

  return sortHits(Array.from(merged.values())).slice(0, topK);
}

function chooseByPriority(
  providerResults: Map<RetrievalProviderName, RetrievalProviderResult>,
  priority: RetrievalProviderName[]
): { provider: RetrievalProviderName; result: RetrievalProviderResult } | undefined {
  for (const provider of priority) {
    const result = providerResults.get(provider);
    if (!result) {
      continue;
    }

    if (result.status === "ok" && result.hits.length > 0) {
      return {
        provider,
        result
      };
    }
  }

  return undefined;
}

function buildFallbackHits(documents: RetrievalDocument[], topK: number): RetrievalHit[] {
  return documents
    .map((document, index) => ({
      path: document.path,
      score: document.changed ? 5 - index * 0.01 : 1 - index * 0.01,
      reasons: [document.changed ? "fallback:changed-file" : "fallback:index-order"]
    }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.path.localeCompare(b.path)))
    .slice(0, topK);
}

export async function runRetrievalChain(options: {
  cwd: string;
  query: RetrievalQuery;
  documents: RetrievalDocument[];
  config: ResolvedRetrievalConfig;
}): Promise<RetrievalChainResult> {
  const registry = createProviderRegistry();
  const previous = new Map<RetrievalProviderName, RetrievalProviderResult>();
  const enabled = new Set(options.config.providerPriority);

  for (const providerName of PROVIDER_EXECUTION_ORDER) {
    if (!enabled.has(providerName)) {
      continue;
    }

    const provider = registry.get(providerName);
    if (!provider) {
      continue;
    }

    try {
      const result = await withTimeout(
        provider.run({
          cwd: options.cwd,
          query: options.query,
          documents: options.documents,
          previous,
          config: options.config
        }),
        providerTimeout(options.config, providerName),
        `${providerName} provider timeout`
      );

      previous.set(providerName, result);
    } catch (error) {
      previous.set(providerName, {
        provider: providerName,
        status: "failed",
        tookMs: 0,
        hits: [],
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  let selected = chooseByPriority(previous, options.config.providerPriority);
  let selectedProvider: RetrievalProviderName;
  let selectedHits: RetrievalHit[];
  let fallbackUsed = false;
  let fallbackReason: string | undefined;

  if (selected) {
    selectedProvider = selected.provider;
    selectedHits = [...selected.result.hits];

    const qmdResult = previous.get("qmd");
    const hybridResult = previous.get("hybrid");
    if (
      selectedProvider === "qmd" &&
      qmdResult?.status === "ok" &&
      qmdResult.hits.length > 0 &&
      hybridResult?.status === "ok" &&
      hybridResult.hits.length > 0
    ) {
      selectedHits = mergeHits(qmdResult.hits, hybridResult.hits, options.config.topK.final);
    }

    const firstProvider = options.config.providerPriority[0];
    if (firstProvider && selectedProvider !== firstProvider) {
      fallbackUsed = true;
      fallbackReason = `primary provider '${firstProvider}' unavailable or empty`;
    }

    const firstResult = firstProvider ? previous.get(firstProvider) : undefined;
    if (firstProvider && firstResult && firstResult.status !== "ok") {
      fallbackUsed = true;
      fallbackReason = firstResult.error || `primary provider '${firstProvider}' status=${firstResult.status}`;
    }
  } else {
    selectedProvider = "lexical";
    selectedHits = buildFallbackHits(options.documents, options.config.topK.final);
    fallbackUsed = true;
    fallbackReason = "all configured providers returned empty/failed results";
  }

  if (selectedHits.length === 0) {
    selectedHits = buildFallbackHits(options.documents, options.config.topK.final);
    fallbackUsed = true;
    fallbackReason = fallbackReason ?? "selected provider produced empty hits";
  }

  const providerResults = Array.from(previous.values());

  return {
    hits: selectedHits.slice(0, options.config.topK.final),
    diagnostics: {
      selectedProvider,
      fallbackUsed,
      fallbackReason,
      providerResults,
      querySignals: {
        task: options.query.task,
        diffSummary: options.query.diffSummary,
        errorLogs: options.query.errorLogs,
        verifyFeedback: options.query.verifyFeedback,
        targetFiles: options.query.targetFiles,
        stage: options.query.stage,
        patchAttempt: options.query.patchAttempt
      }
    }
  };
}
