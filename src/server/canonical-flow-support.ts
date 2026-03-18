import type { CanonicalLinkedFlowPlan } from "./flow-links.js";
import { tokenizeOntologyText } from "./ontology-signals.js";
import type { RankedRetrievalUnit, RetrievalUnit } from "./retrieval-units.js";

export interface CanonicalFlowSupportUnit {
  unitId: string;
  title: string;
  summary: string;
  score: number;
  reasons: string[];
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

const GENERIC_CANONICAL_FLOW_TOKENS = new Set([
  "gw",
  "api",
  "mo",
  "pc",
  "mysamsunglife",
  "src",
  "views",
  "view",
  "java",
  "com",
  "samsunglife",
  "dcp",
  "frontend",
  "backend",
  "mdp",
  "mdg",
  "pdb",
  "pdt",
  "screen",
  "route",
  "controller",
  "service",
  "request",
  "response",
  "status",
  "check",
  "select",
  "insert",
  "update",
  "delete",
  "remove",
  "save",
  "load",
  "get",
  "set",
  "proc",
  "process",
  "info",
  "main",
  "v1",
  "v2"
]);

function topNamespace(path?: string): string | undefined {
  if (!path) return undefined;
  const segments = path
    .toLowerCase()
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !["gw", "api", "mo", "pc", "mysamsunglife", "v1", "v2"].includes(segment));
  return segments[0];
}

function collectFlowAnchorTokens(plan: CanonicalLinkedFlowPlan): string[] {
  return unique(
    tokenizeOntologyText(
      [
        plan.primary?.screenCode,
        plan.primary?.routePath,
        plan.primary?.apiUrl,
        plan.primary?.backendPath,
        plan.primary?.backendControllerMethod,
        ...(plan.primary?.serviceHints ?? []),
        ...plan.canonicalFlows.flatMap((flow) => [flow.apiUrl, flow.backendPath, flow.backendControllerMethod, ...(flow.serviceHints ?? [])])
      ]
        .filter(Boolean)
        .join(" ")
    ).filter((token) => token.length >= 3 && !GENERIC_CANONICAL_FLOW_TOKENS.has(token))
  );
}

function collectFlowNamespaces(plan: CanonicalLinkedFlowPlan): string[] {
  return unique(
    plan.canonicalFlows.flatMap((flow) => [topNamespace(flow.apiUrl), topNamespace(flow.backendPath)].filter(Boolean) as string[])
  );
}

function supportTypeWeight(unit: RetrievalUnit): number {
  switch (unit.type) {
    case "flow":
      return 16;
    case "resource-schema":
      return 13;
    case "symbol-block":
      return 10;
    case "eai-link":
      return 9;
    case "knowledge-cluster":
      return 4;
    case "module-overview":
      return 3;
    default:
      return 0;
  }
}

function countMatches(haystack: string, needles: string[]): string[] {
  return needles.filter((needle) => haystack.includes(needle.toLowerCase()));
}

function countEdgeSignals(unit: RetrievalUnit, prefix: string): number {
  return unit.edgeIds.filter((edgeId) => edgeId.includes(prefix)).length;
}

function countEntitySignals(unit: RetrievalUnit, prefixes: string[]): number {
  return unit.entityIds.filter((entityId) => prefixes.some((prefix) => entityId.startsWith(prefix))).length;
}

export function buildCanonicalFlowSupportUnits(options: {
  canonicalFlowPlan: CanonicalLinkedFlowPlan | null | undefined;
  rankedUnits: RankedRetrievalUnit[];
  limit?: number;
}): CanonicalFlowSupportUnit[] {
  if (!options.canonicalFlowPlan?.primary) {
    return [];
  }

  const anchorTokens = collectFlowAnchorTokens(options.canonicalFlowPlan);
  const anchorNamespaces = collectFlowNamespaces(options.canonicalFlowPlan);

  return options.rankedUnits
    .map((ranked) => {
      const unit = ranked.unit;
      const haystack = [unit.title, unit.summary, ...unit.searchText, ...unit.evidencePaths].join(" ").toLowerCase();
      let score = ranked.score + supportTypeWeight(unit);
      const reasons = [`unit:${unit.type}`];

      const tokenMatches = countMatches(haystack, anchorTokens);
      const namespaceMatches = anchorNamespaces.filter((namespace) => haystack.includes(namespace.toLowerCase()));
      const directlyAligned = tokenMatches.length > 0 || namespaceMatches.length > 0;
      if (tokenMatches.length > 0) {
        score += Math.min(30, tokenMatches.length * 3.5);
        reasons.push(`token:${tokenMatches.slice(0, 4).join(",")}`);
      }
      if (namespaceMatches.length > 0) {
        score += namespaceMatches.length * 6;
        reasons.push(`namespace:${namespaceMatches.join(",")}`);
      } else if (anchorNamespaces.length > 0 && unit.type !== "knowledge-cluster") {
        score -= 8;
        reasons.push("namespace-mismatch");
      }

      const transitionCount = countEdgeSignals(unit, "edge:transitions-to:");
      if (transitionCount > 0) {
        score += Math.min(16, transitionCount * 2.5);
        reasons.push("transitions");
      }

      const requestPropagationCount = unit.edgeIds.filter(
        (edgeId) => edgeId.includes("edge:propagates-contract:") && edgeId.endsWith(":request")
      ).length;
      if (requestPropagationCount > 0) {
        score += Math.min(16, requestPropagationCount * 2.5);
        reasons.push("request-contract");
      }

      const responsePropagationCount = unit.edgeIds.filter(
        (edgeId) => edgeId.includes("edge:propagates-contract:") && edgeId.endsWith(":response")
      ).length;
      if (responsePropagationCount > 0) {
        score += Math.min(12, responsePropagationCount * 2);
        reasons.push("response-contract");
      }

      const supportEntityCount = countEntitySignals(unit, [
        "data-contract:",
        "store:",
        "data-query:",
        "data-table:",
        "cache-key:",
        "async-channel:",
        "control-guard:",
        "decision-path:"
      ]);
      if (supportEntityCount > 0) {
        score += Math.min(14, supportEntityCount * 1.4);
        reasons.push("support-entities");
      }

      if (!directlyAligned && ["flow", "resource-schema", "symbol-block", "eai-link"].includes(unit.type)) {
        score -= 28;
        reasons.push("direct-alignment-missing");
      }

      if (!directlyAligned && ["flow", "resource-schema", "symbol-block", "eai-link"].includes(unit.type)) {
        return null;
      }

      return {
        unitId: unit.id,
        title: unit.title,
        summary: unit.summary,
        score: Math.round(score * 100) / 100,
        reasons
      };
    })
    .filter((item): item is CanonicalFlowSupportUnit => item !== null)
    .filter((item) => item.score > 0)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.unitId.localeCompare(b.unitId)))
    .slice(0, options.limit ?? 6);
}
