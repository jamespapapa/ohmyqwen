import type { EaiDictionaryEntry } from "./eai-dictionary.js";

export interface EaiLinkedEvidence {
  interfaceId: string;
  interfaceName: string;
  purpose: string;
  sourcePath: string;
  envPaths: string[];
  moduleUsagePaths: string[];
  javaCallSiteMethods: string[];
  reasons: string[];
  score: number;
}

interface LinkableEvidenceItem {
  path: string;
  reason?: string;
  snippet?: string;
  codeFile?: boolean;
  moduleMatched?: boolean;
}

function toForwardSlash(value: string): string {
  return value.replace(/\\/g, "/");
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function extractPotentialInterfaceIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(/\b([A-Z][0-9A-Z]{8})\b/g)) {
    if (match[1]) {
      ids.add(match[1]);
    }
  }
  for (const match of text.matchAll(/\bcall([A-Z][0-9A-Z]{8})(?:[A-Z0-9_]*)\s*\(/g)) {
    if (match[1]) {
      ids.add(match[1]);
    }
  }
  return Array.from(ids);
}

function pathMatchesAnyModule(filePath: string, moduleCandidates: string[]): boolean {
  const normalized = toForwardSlash(filePath).toLowerCase();
  return moduleCandidates.some((moduleName) => normalized.startsWith(`${moduleName.toLowerCase()}/`));
}

export function buildLinkedEaiEvidence(options: {
  question: string;
  moduleCandidates?: string[];
  hydratedEvidence?: LinkableEvidenceItem[];
  hits?: LinkableEvidenceItem[];
  entries: EaiDictionaryEntry[];
  limit?: number;
}): EaiLinkedEvidence[] {
  const moduleCandidates = options.moduleCandidates ?? [];
  const hydratedEvidence = options.hydratedEvidence ?? [];
  const hits = options.hits ?? [];
  const limit = Math.max(1, options.limit ?? 6);
  const directIds = new Set<string>(extractPotentialInterfaceIds(options.question));

  for (const item of [...hydratedEvidence, ...hits]) {
    for (const field of [item.path, item.reason ?? "", item.snippet ?? ""]) {
      for (const interfaceId of extractPotentialInterfaceIds(field)) {
        directIds.add(interfaceId);
      }
    }
  }

  const ranked = options.entries
    .map((entry) => {
      let score = 0;
      const reasons: string[] = [];
      const normalizedUsagePaths = [entry.sourcePath, ...entry.envPaths, ...entry.usagePaths].map(toForwardSlash);
      const matchedHydratedPaths = hydratedEvidence.filter((item) => item.path && normalizedUsagePaths.includes(toForwardSlash(item.path)));
      const matchedCallSites = entry.javaCallSites.filter((site) =>
        hydratedEvidence.some((item) => toForwardSlash(item.path) === toForwardSlash(site.path))
      );

      if (directIds.has(entry.interfaceId)) {
        score += 700;
        reasons.push("direct-interface-id");
      }
      if (matchedCallSites.length > 0) {
        score += 220 + matchedCallSites.length * 30;
        reasons.push("java-callsite-match");
      }
      if (matchedHydratedPaths.length > 0) {
        score += 160 + matchedHydratedPaths.length * 20;
        reasons.push("hydrated-path-match");
      }
      if (moduleCandidates.length > 0) {
        const moduleUsageHit = entry.moduleUsagePaths.some((usagePath) => pathMatchesAnyModule(usagePath, moduleCandidates));
        const moduleCallHit = entry.javaCallSites.some((site) => pathMatchesAnyModule(site.path, moduleCandidates));
        if (moduleUsageHit || moduleCallHit) {
          score += 120;
          reasons.push("module-scoped-usage");
        }
      }
      const matchingHits = hits.filter((item) => normalizedUsagePaths.includes(toForwardSlash(item.path)));
      if (matchingHits.length > 0) {
        score += 60 + matchingHits.length * 10;
        reasons.push("search-hit-match");
      }
      if (entry.interfaceName && options.question.includes(entry.interfaceName)) {
        score += 40;
        reasons.push("question-name-match");
      }

      return {
        interfaceId: entry.interfaceId,
        interfaceName: entry.interfaceName,
        purpose: entry.purpose,
        sourcePath: entry.sourcePath,
        envPaths: entry.envPaths,
        moduleUsagePaths: entry.moduleUsagePaths,
        javaCallSiteMethods: unique(
          entry.javaCallSites
            .filter((site) => site.methodName)
            .map((site) => site.methodName as string)
        ).slice(0, 8),
        reasons: unique(reasons),
        score
      } satisfies EaiLinkedEvidence;
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.interfaceId.localeCompare(b.interfaceId);
    })
    .slice(0, limit);

  return ranked;
}
