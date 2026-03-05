import { HybridRetrievalProvider } from "./providers/hybrid.js";
import { LexicalRetrievalProvider } from "./providers/lexical.js";
import { QmdRetrievalProvider } from "./providers/qmd.js";
import { SemanticRetrievalProvider } from "./providers/semantic.js";
import { RetrievalProvider, RetrievalProviderName } from "./types.js";

export function createProviderRegistry(): Map<RetrievalProviderName, RetrievalProvider> {
  return new Map<RetrievalProviderName, RetrievalProvider>([
    ["qmd", new QmdRetrievalProvider()],
    ["lexical", new LexicalRetrievalProvider()],
    ["semantic", new SemanticRetrievalProvider()],
    ["hybrid", new HybridRetrievalProvider()]
  ]);
}

export const PROVIDER_EXECUTION_ORDER: RetrievalProviderName[] = [
  "qmd",
  "lexical",
  "semantic",
  "hybrid"
];
