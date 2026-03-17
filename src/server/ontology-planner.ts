import { z } from "zod";
import { inferQuestionActionHints, type AskQuestionType } from "./question-types.js";
import {
  OntologyGraphSnapshotSchema,
  type OntologyEdge,
  type OntologyGraphSnapshot,
  type OntologyNode
} from "./ontology-graph.js";
import {
  OntologyProjectionSnapshotSchema,
  type OntologyProjectionSnapshot
} from "./ontology-projections.js";

const OntologyLifecycleStatusSchema = z.enum([
  "candidate",
  "validated",
  "derived",
  "stale",
  "contested",
  "deprecated"
]);

export interface RankedOntologyNode {
  node: OntologyNode;
  score: number;
  reasons: string[];
}

export interface RankedOntologyProjection {
  projection: OntologyProjectionSnapshot["projections"][number];
  score: number;
  reasons: string[];
}

export interface OntologySupportCandidate {
  nodeId: string;
  path: string;
  title: string;
  summary: string;
  score: number;
  reasons: string[];
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function toForwardSlash(value: string): string {
  return value.replace(/\\/g, "/");
}

function tokenize(value: string): string[] {
  return unique(
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9가-힣_:/.-]+/gi, " ")
      .split(/\s+/)
      .filter((item) => item.length >= 2)
  );
}

function pickNodeText(node: OntologyNode): string[] {
  const attributes = Object.values(node.attributes ?? {}).flatMap((value) => {
    if (Array.isArray(value)) {
      return value.map((item) => String(item));
    }
    return [String(value ?? "")];
  });
  return unique([
    node.label,
    node.summary,
    ...node.metadata.domains,
    ...node.metadata.subdomains,
    ...node.metadata.channels,
    ...node.metadata.actions,
    ...node.metadata.moduleRoles,
    ...node.metadata.processRoles,
    ...node.metadata.evidencePaths,
    ...attributes
  ]);
}

function countOverlap(tokens: string[], corpus: string[]): number {
  if (tokens.length === 0 || corpus.length === 0) {
    return 0;
  }
  const corpusTokens = new Set(corpus.flatMap((item) => tokenize(item)));
  let overlap = 0;
  for (const token of tokens) {
    if (corpusTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

function isDirectActionHint(action: string): boolean {
  return [
    "action-auth",
    "action-register",
    "action-write",
    "action-update",
    "action-delete",
    "action-callback",
    "action-token"
  ].includes(action);
}

function actionAlignmentScore(nodeActions: string[], desiredActions: string[]): { delta: number; reasons: string[] } {
  if (nodeActions.length === 0 || desiredActions.length === 0) {
    return { delta: 0, reasons: [] };
  }

  const overlaps = desiredActions.filter((action) => nodeActions.includes(action));
  if (overlaps.length > 0) {
    return {
      delta: overlaps.length * 1.35,
      reasons: [`actions:${overlaps.slice(0, 4).join(",")}`]
    };
  }

  const directDesired = desiredActions.filter(isDirectActionHint);
  if (directDesired.length > 0) {
    return {
      delta: -1.45,
      reasons: ["action-mismatch"]
    };
  }

  return { delta: -0.55, reasons: ["action-mismatch"] };
}

function preferredNodeTypes(questionType: AskQuestionType): string[] {
  switch (questionType) {
    case "cross_layer_flow":
      return ["route", "api", "controller", "service", "async-channel", "control-guard", "decision-path", "path", "retrieval-unit", "knowledge-input"];
    case "symbol_deep_trace":
      return ["symbol", "service", "controller", "control-guard", "decision-path", "retrieval-unit", "path"];
    case "module_role_explanation":
      return ["module", "knowledge-cluster", "knowledge-input", "retrieval-unit"];
    case "process_or_batch_trace":
      return ["service", "async-channel", "path", "knowledge-input", "retrieval-unit", "module"];
    case "channel_or_partner_integration":
      return ["route", "api", "controller", "service", "async-channel", "control-guard", "decision-path", "knowledge-cluster", "knowledge-input", "retrieval-unit"];
    case "state_store_schema":
      return ["data-store", "data-contract", "data-model", "data-query", "data-table", "cache-key", "service", "symbol", "control-guard", "decision-path", "knowledge-input", "retrieval-unit", "file"];
    case "config_or_resource_explanation":
      return ["knowledge-input", "knowledge-cluster", "file", "eai-interface", "data-store", "async-channel", "data-contract", "data-model", "data-query", "data-table", "cache-key", "service", "symbol"];
    case "business_capability_trace":
      return ["service", "controller", "async-channel", "control-guard", "decision-path", "api", "route", "retrieval-unit", "knowledge-cluster"];
    case "domain_capability_overview":
      return ["module", "knowledge-cluster", "knowledge-input", "service", "retrieval-unit"];
  }
}

function preferredProjectionTypes(questionType: AskQuestionType): string[] {
  switch (questionType) {
    case "cross_layer_flow":
      return ["front-back-flow", "integration", "knowledge-lifecycle"];
    case "channel_or_partner_integration":
      return ["integration", "front-back-flow", "knowledge-lifecycle"];
    case "state_store_schema":
      return ["code-structure", "integration", "knowledge-lifecycle"];
    case "module_role_explanation":
      return ["code-structure", "knowledge-lifecycle"];
    case "process_or_batch_trace":
      return ["code-structure", "knowledge-lifecycle", "integration"];
    case "symbol_deep_trace":
      return ["code-structure", "front-back-flow"];
    case "config_or_resource_explanation":
      return ["code-structure", "integration"];
    case "business_capability_trace":
      return ["front-back-flow", "code-structure", "integration"];
    case "domain_capability_overview":
      return ["code-structure", "front-back-flow", "integration"];
  }
}

function statusWeight(status: z.infer<typeof OntologyLifecycleStatusSchema>): number {
  switch (status) {
    case "validated":
      return 1.4;
    case "derived":
      return 0.9;
    case "candidate":
      return 0.45;
    case "stale":
      return -1.1;
    case "contested":
      return -0.8;
    case "deprecated":
      return -2.4;
  }
}

function looksLikeCodePath(value: string): boolean {
  return /\.[a-z0-9]+$/i.test(value) || value.includes("/");
}

function resolveEvidencePaths(node: OntologyNode): string[] {
  return unique(
    node.metadata.evidencePaths
      .map(toForwardSlash)
      .filter((entry) => looksLikeCodePath(entry) && !entry.startsWith("path-target:"))
  );
}

export function collectOntologyQueryTerms(matches: RankedOntologyNode[], limit = 12): string[] {
  const terms = unique(
    matches.flatMap((match) => [
      match.node.label,
      ...match.node.metadata.domains,
      ...match.node.metadata.subdomains,
      ...match.node.metadata.channels,
      ...match.node.metadata.actions,
      ...match.node.metadata.moduleRoles,
      ...match.node.metadata.processRoles,
      ...pickNodeText(match.node).slice(0, 4)
    ])
  );
  return terms.slice(0, limit);
}

export function rankOntologyNodesForQuestion(options: {
  snapshot: OntologyGraphSnapshot;
  question: string;
  questionType: AskQuestionType;
  questionTags?: string[];
  moduleCandidates?: string[];
  matchedKnowledgeIds?: string[];
  matchedRetrievalUnitIds?: string[];
  limit?: number;
}): RankedOntologyNode[] {
  const snapshot = OntologyGraphSnapshotSchema.parse(options.snapshot);
  const questionTokens = tokenize(options.question);
  const signalTokens = unique([...(options.questionTags ?? []), ...(options.moduleCandidates ?? [])]).flatMap((item) => tokenize(item));
  const desiredActions = inferQuestionActionHints(options.question, [
    ...(options.questionTags ?? []),
    ...(options.matchedKnowledgeIds ?? [])
  ]);
  const preferredTypes = new Set(preferredNodeTypes(options.questionType));
  const matchedKnowledge = new Set(options.matchedKnowledgeIds ?? []);
  const matchedUnits = new Set(options.matchedRetrievalUnitIds ?? []);

  return snapshot.nodes
    .map((node) => {
      const corpus = pickNodeText(node);
      const overlap = countOverlap(questionTokens, corpus);
      const signalOverlap = countOverlap(signalTokens, [
        ...node.metadata.domains,
        ...node.metadata.subdomains,
        ...node.metadata.channels,
        ...node.metadata.actions,
        ...node.metadata.moduleRoles,
        ...node.metadata.processRoles,
        ...Object.values(node.attributes ?? {}).map((value) => String(value ?? ""))
      ]);

      let score = overlap * 1.45 + signalOverlap * 1.1 + statusWeight(node.metadata.validatedStatus);
      const reasons = [`status:${node.metadata.validatedStatus}`];
      const actionAlignment = actionAlignmentScore(node.metadata.actions, desiredActions);
      score += actionAlignment.delta;
      reasons.push(...actionAlignment.reasons);

      if (preferredTypes.has(node.type)) {
        score += 1.5;
        reasons.push(`preferred-type:${node.type}`);
      }
      if (node.metadata.sourceType === "ontology-input") {
        score += 0.6;
        reasons.push("source:ontology-input");
      }
      if (node.metadata.sourceType === "ontology-review") {
        score += 0.35;
        reasons.push("source:ontology-review");
      }
      if (node.metadata.validatedStatus === "deprecated") {
        reasons.push("deprecated-penalty");
      }
      if (node.metadata.validatedStatus === "contested") {
        reasons.push("contested-penalty");
      }
      if (matchedKnowledge.has(node.id) || matchedKnowledge.has(String(node.attributes.candidateId ?? "")) || matchedKnowledge.has(String(node.attributes.packId ?? ""))) {
        score += 1.05;
        reasons.push("matched-knowledge");
      }
      if (matchedUnits.has(String(node.attributes.unitId ?? "")) || matchedUnits.has(node.id.replace(/^retrieval-unit:/, ""))) {
        score += 0.9;
        reasons.push("matched-retrieval-unit");
      }

      for (const moduleCandidate of options.moduleCandidates ?? []) {
        const moduleToken = moduleCandidate.toLowerCase();
        if (pickNodeText(node).some((entry) => entry.toLowerCase().includes(moduleToken))) {
          score += 1.2;
          reasons.push(`module:${moduleCandidate}`);
          break;
        }
      }

      return {
        node,
        score,
        reasons: unique(reasons)
      };
    })
    .filter((entry) => entry.score > 0.2 && entry.node.metadata.validatedStatus !== "deprecated")
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.node.id.localeCompare(b.node.id)))
    .slice(0, options.limit ?? 8);
}

export function rankOntologyProjectionsForQuestion(options: {
  snapshot: OntologyProjectionSnapshot;
  question: string;
  questionType: AskQuestionType;
  matchedNodeIds?: string[];
  limit?: number;
}): RankedOntologyProjection[] {
  const snapshot = OntologyProjectionSnapshotSchema.parse(options.snapshot);
  const questionTokens = tokenize(options.question);
  const preferredTypes = new Set(preferredProjectionTypes(options.questionType));
  const matchedNodeIds = new Set(options.matchedNodeIds ?? []);

  return snapshot.projections
    .map((projection) => {
      const corpus = [
        projection.title,
        projection.summary,
        ...projection.representativePaths.map((path) => path.label)
      ];
      const overlap = countOverlap(questionTokens, corpus);
      const matchedNodeOverlap = projection.nodeIds.filter((id) => matchedNodeIds.has(id)).length;
      let score = overlap * 1.3 + matchedNodeOverlap * 0.75;
      const reasons = [] as string[];
      if (preferredTypes.has(projection.type)) {
        score += 1.4;
        reasons.push(`preferred-projection:${projection.type}`);
      }
      if (matchedNodeOverlap > 0) {
        reasons.push(`matched-nodes:${matchedNodeOverlap}`);
      }
      if (projection.representativePaths.length > 0) {
        score += Math.min(1.0, projection.representativePaths.length * 0.15);
        reasons.push(`paths:${projection.representativePaths.length}`);
      }
      return {
        projection,
        score,
        reasons: unique(reasons)
      };
    })
    .filter((entry) => entry.score > 0.1)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.projection.id.localeCompare(b.projection.id)))
    .slice(0, options.limit ?? 4);
}

export function buildOntologySupportCandidates(options: {
  rankedNodes: RankedOntologyNode[];
  existingPaths: string[];
  limit?: number;
}): OntologySupportCandidate[] {
  const existingPaths = new Set(options.existingPaths.map((entry) => toForwardSlash(entry)));
  const support: OntologySupportCandidate[] = [];

  for (const match of options.rankedNodes) {
    if (["contested", "deprecated"].includes(match.node.metadata.validatedStatus)) {
      continue;
    }
    for (const evidencePath of resolveEvidencePaths(match.node)) {
      if (existingPaths.has(evidencePath)) {
        continue;
      }
      support.push({
        nodeId: match.node.id,
        path: evidencePath,
        title: match.node.label,
        summary: match.node.summary,
        score: Number((match.score + 0.35).toFixed(3)),
        reasons: unique([`ontology-node=${match.node.id}`, ...match.reasons])
      });
      existingPaths.add(evidencePath);
      if (support.length >= (options.limit ?? 4)) {
        return support;
      }
    }
  }

  return support;
}

export function findOntologyEdgesForNodes(options: {
  snapshot: OntologyGraphSnapshot;
  nodeIds: string[];
  limit?: number;
}): OntologyEdge[] {
  const snapshot = OntologyGraphSnapshotSchema.parse(options.snapshot);
  const nodeIds = new Set(options.nodeIds);
  return snapshot.edges
    .filter((edge) => nodeIds.has(edge.fromId) || nodeIds.has(edge.toId))
    .slice(0, options.limit ?? 24);
}
