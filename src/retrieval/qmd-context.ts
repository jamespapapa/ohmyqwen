export interface ProjectQmdContextInput {
  project: {
    name: string;
    description?: string;
  };
  summary: string;
  architecture: string[];
  keyModules: Array<{
    name: string;
    path: string;
    role: string;
  }>;
  ontologyGraph?: {
    topChannels?: Array<{
      id: string;
      count: number;
    }>;
    topDomains?: Array<{
      id: string;
      count: number;
    }>;
  };
  ontologyProjections?: {
    topProjectionTypes?: string[];
  };
  eaiCatalog?: {
    interfaceCount: number;
    topInterfaces: Array<{
      interfaceId: string;
      interfaceName: string;
      purpose: string;
    }>;
  };
  frontBackGraph?: {
    workspaceCount: number;
    linkCount: number;
  };
  learnedKnowledge?: {
    candidateCount: number;
    validatedCount: number;
    staleCount?: number;
    topCandidates: Array<{
      label: string;
      kind: string;
      status: string;
      score: number;
    }>;
  };
}

export interface ProjectQmdContextPayload {
  globalContext: string;
  contexts: Array<{
    pathPrefix: string;
    contextText: string;
  }>;
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function normalizeModulePrefix(modulePath: string): string {
  const normalized = modulePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const first = normalized.split("/").find(Boolean);
  return first ? `/${first}` : "/";
}

function compactLines(lines: string[], limit: number): string[] {
  return unique(lines.map((line) => line.trim()).filter(Boolean)).slice(0, limit);
}

export function buildProjectQmdContextPayload(input: ProjectQmdContextInput): ProjectQmdContextPayload {
  const topChannels = (input.ontologyGraph?.topChannels ?? []).slice(0, 6);
  const topConcepts = (input.ontologyGraph?.topDomains ?? []).slice(0, 6);
  const topProjectionTypes = input.ontologyProjections?.topProjectionTypes?.slice(0, 6) ?? [];
  const strongestModules = input.keyModules.slice(0, 10);
  const topInterfaces = input.eaiCatalog?.topInterfaces.slice(0, 6) ?? [];
  const knowledge = input.learnedKnowledge?.topCandidates.slice(0, 6) ?? [];

  const globalLines = compactLines(
    [
      `${input.project.name}: ${input.summary}`,
      input.project.description ? `project-description: ${input.project.description}` : "",
      input.architecture.slice(0, 6).map((line) => `architecture: ${line}`).join("\n"),
      topChannels.length > 0
        ? `ontology-channels: ${topChannels.map((channel) => `${channel.id}(${channel.count})`).join(", ")}`
        : "",
      topConcepts.length > 0
        ? `ontology-concepts: ${topConcepts.map((concept) => `${concept.id}(${concept.count})`).join(", ")}`
        : "",
      topProjectionTypes.length > 0
        ? `ontology-projections: ${topProjectionTypes.join(", ")}`
        : "",
      input.eaiCatalog
        ? `eai-catalog: ${input.eaiCatalog.interfaceCount} interfaces`
        : "",
      input.frontBackGraph
        ? `front-back-graph: ${input.frontBackGraph.workspaceCount} frontend workspaces, ${input.frontBackGraph.linkCount} links`
        : "",
      input.learnedKnowledge
        ? `learned-knowledge: ${input.learnedKnowledge.candidateCount} candidates, ${input.learnedKnowledge.validatedCount} validated, ${input.learnedKnowledge.staleCount ?? 0} stale`
        : "",
    ],
    10
  );

  const moduleContexts = new Map<string, string[]>();
  for (const module of strongestModules) {
    const pathPrefix = normalizeModulePrefix(module.path);
    const lines = moduleContexts.get(pathPrefix) ?? [];
    lines.push(`${module.name}: ${module.role}`);
    moduleContexts.set(pathPrefix, lines);
  }

  if (topInterfaces.length > 0) {
    const lines = moduleContexts.get("/") ?? [];
    lines.push(
      `top-eai: ${topInterfaces.map((entry) => `${entry.interfaceId} ${entry.interfaceName}`).join(", ")}`
    );
    moduleContexts.set("/", lines);
  }

  if (knowledge.length > 0) {
    const lines = moduleContexts.get("/") ?? [];
    lines.push(
      `learned-candidates: ${knowledge
        .map((entry) => `${entry.label}(${entry.kind},${entry.status},${entry.score.toFixed(2)})`)
        .join(", ")}`
    );
    moduleContexts.set("/", lines);
  }

  return {
    globalContext: globalLines.join("\n"),
    contexts: Array.from(moduleContexts.entries())
      .map(([pathPrefix, lines]) => ({
        pathPrefix,
        contextText: compactLines(lines, 8).join("\n"),
      }))
      .filter((entry) => entry.contextText)
      .sort((a, b) => a.pathPrefix.localeCompare(b.pathPrefix)),
  };
}
