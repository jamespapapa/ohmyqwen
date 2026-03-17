import type { EaiDictionaryEntry } from "./eai-dictionary.js";
import type { FrontBackGraphLink, FrontBackGraphSnapshot, FrontendRouteEntry, FrontendScreenEntry } from "./front-back-graph.js";
import type { LearnedKnowledgeSnapshot } from "./learned-knowledge.js";

interface StructureSymbolLike {
  name: string;
  line: number;
  className?: string;
}

interface StructureFileEntryLike {
  path: string;
  packageName?: string;
  summary: string;
  classes: StructureSymbolLike[];
  methods: StructureSymbolLike[];
  functions: StructureSymbolLike[];
  calls: string[];
  resources?: {
    storeKinds?: string[];
    redisAccessTypes?: string[];
    redisOps?: string[];
    redisKeys?: string[];
    dbAccessTypes?: string[];
    dbModelNames?: string[];
    dbTableNames?: string[];
    dbQueryNames?: string[];
    controlGuardNames?: string[];
  };
}

export interface AnalyzeInputCompactionLimits {
  maxStructureEntries: number;
  maxFrontendScreens: number;
  maxFrontendRoutes: number;
  maxFrontBackLinks: number;
  maxEaiEntries: number;
  maxEaiUsagePathsPerEntry: number;
  maxEaiCallSitesPerEntry: number;
  maxLearnedKnowledgeCandidates: number;
}

export interface AnalyzeInputCompactionSummary {
  compactMode: boolean;
  structureEntriesBefore: number;
  structureEntriesAfter: number;
  frontendScreensBefore: number;
  frontendScreensAfter: number;
  frontendRoutesBefore: number;
  frontendRoutesAfter: number;
  frontBackLinksBefore: number;
  frontBackLinksAfter: number;
  eaiEntriesBefore: number;
  eaiEntriesAfter: number;
  learnedKnowledgeCandidatesBefore: number;
  learnedKnowledgeCandidatesAfter: number;
}

export interface CompactAnalyzeKnowledgeInputsResult {
  structureEntries: Record<string, StructureFileEntryLike>;
  frontBackGraph: FrontBackGraphSnapshot;
  eaiEntries: EaiDictionaryEntry[];
  learnedKnowledge?: LearnedKnowledgeSnapshot;
  summary: AnalyzeInputCompactionSummary;
}

interface AnalyzeInputCompactionThresholds {
  structureEntryCount: number;
  frontBackScreenCount: number;
  frontBackLinkCount: number;
  eaiEntryCount: number;
}

const DEFAULT_THRESHOLDS: AnalyzeInputCompactionThresholds = {
  structureEntryCount: 5000,
  frontBackScreenCount: 2500,
  frontBackLinkCount: 3000,
  eaiEntryCount: 900
};

const DEFAULT_LIMITS: AnalyzeInputCompactionLimits = {
  maxStructureEntries: 2200,
  maxFrontendScreens: 1400,
  maxFrontendRoutes: 1600,
  maxFrontBackLinks: 1400,
  maxEaiEntries: 520,
  maxEaiUsagePathsPerEntry: 8,
  maxEaiCallSitesPerEntry: 8,
  maxLearnedKnowledgeCandidates: 180
};

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function toForwardSlash(value: string): string {
  return value.replace(/\\/g, "/");
}

function normalize(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

function slug(value: string | undefined | null): string {
  return normalize(value).replace(/[^a-z0-9가-힣._/-]+/g, "-");
}

function takeSorted<T>(items: T[], limit: number): T[] {
  return items.slice(0, Math.max(1, limit));
}

function hasResourceSignals(entry: StructureFileEntryLike | undefined): boolean {
  const resources = entry?.resources;
  if (!resources) {
    return false;
  }
  return [
    ...(resources.storeKinds ?? []),
    ...(resources.redisAccessTypes ?? []),
    ...(resources.redisOps ?? []),
    ...(resources.redisKeys ?? []),
    ...(resources.dbAccessTypes ?? []),
    ...(resources.dbModelNames ?? []),
    ...(resources.dbTableNames ?? []),
    ...(resources.dbQueryNames ?? []),
    ...(resources.controlGuardNames ?? [])
  ].length > 0;
}

function structurePathKindScore(path: string): number {
  const normalized = normalize(path);
  if (/controller\//.test(normalized)) return 24;
  if (/(service|manager|support)\//.test(normalized)) return 20;
  if (/(repository|mapper|dao)\//.test(normalized)) return 18;
  if (/gateway\//.test(normalized)) return 16;
  if (/batch\//.test(normalized)) return 12;
  return 0;
}

function buildStructureClassFileMap(entries: Record<string, StructureFileEntryLike>): Map<string, string> {
  const output = new Map<string, string>();
  for (const [entryPath, entry] of Object.entries(entries)) {
    for (const klass of entry.classes ?? []) {
      if (klass.name && !output.has(klass.name)) {
        output.set(klass.name, toForwardSlash(entryPath));
      }
    }
  }
  return output;
}

function scoreFrontBackLink(link: FrontBackGraphLink): number {
  return Math.round(
    link.confidence * 100 +
      (link.backend.serviceHints.length * 10) +
      (link.evidence.length * 6) +
      (link.gateway.controllerMethod ? 18 : 0) +
      (link.frontend.routePath ? 8 : 0) +
      (link.api.functionName ? 8 : 0) +
      (link.capabilityTags?.length ?? 0) * 3
  );
}

function scoreScreen(screen: FrontendScreenEntry, preferredScreenPaths: Set<string>): number {
  return (
    (preferredScreenPaths.has(screen.filePath) ? 100 : 0) +
    screen.httpCalls.length * 10 +
    screen.routePaths.length * 8 +
    screen.apiPaths.length * 5 +
    (screen.labels?.length ?? 0) * 2 +
    (screen.capabilityTags?.length ?? 0)
  );
}

function scoreRoute(route: FrontendRouteEntry, preferredScreenPaths: Set<string>, preferredRoutePaths: Set<string>): number {
  return (
    (preferredScreenPaths.has(route.screenPath) ? 60 : 0) +
    (preferredRoutePaths.has(route.routePath) ? 40 : 0) +
    (route.notes?.length ?? 0) * 2 +
    (route.capabilityTags?.length ?? 0)
  );
}

function scoreStructureEntry(
  entryPath: string,
  entry: StructureFileEntryLike,
  preferredPaths: Set<string>,
  preferredClassNames: Set<string>
): number {
  const normalizedPath = toForwardSlash(entryPath);
  const classNames = unique((entry.classes ?? []).map((item) => item.name));
  const methodClassNames = unique((entry.methods ?? []).map((item) => item.className ?? ""));
  const matchesPreferredClass = [...classNames, ...methodClassNames].some((name) => preferredClassNames.has(name));
  const summaryText = `${entry.summary} ${classNames.join(" ")}`.toLowerCase();
  return (
    (preferredPaths.has(normalizedPath) ? 120 : 0) +
    (matchesPreferredClass ? 60 : 0) +
    (hasResourceSignals(entry) ? 28 : 0) +
    structurePathKindScore(normalizedPath) +
    (/controller|service|gateway|repository|mapper|dao|redis|cache|session|entity|validator|guard/.test(summaryText)
      ? 10
      : 0)
  );
}

function scoreEaiEntry(
  entry: EaiDictionaryEntry,
  preferredPaths: Set<string>,
  preferredClassNames: Set<string>
): number {
  const usageMatches = entry.usagePaths.filter((usagePath) => preferredPaths.has(toForwardSlash(usagePath))).length;
  const callMatches = entry.javaCallSites.filter(
    (site) => preferredPaths.has(toForwardSlash(site.path)) || preferredClassNames.has(site.className ?? "")
  );
  return (
    usageMatches * 80 +
    callMatches.length * 60 +
    entry.javaCallSites.filter((site) => site.direct).length * 10 +
    entry.usagePaths.length +
    entry.moduleUsagePaths.length
  );
}

function scoreLearnedKnowledgeCandidate(
  candidate: NonNullable<LearnedKnowledgeSnapshot["candidates"]>[number],
  preferredPathHints: Set<string>,
  preferredScreenPrefixes: Set<string>,
  preferredControllerHints: Set<string>,
  preferredServiceHints: Set<string>,
  preferredApiPrefixes: Set<string>
): number {
  const pathMatches = (candidate.pathHints ?? []).filter((hint) => preferredPathHints.has(normalize(hint))).length;
  const screenMatches = (candidate.screenPrefixes ?? []).filter((hint) => preferredScreenPrefixes.has(normalize(hint))).length;
  const controllerMatches = (candidate.controllerHints ?? []).filter((hint) => preferredControllerHints.has(normalize(hint))).length;
  const serviceMatches = (candidate.serviceHints ?? []).filter((hint) => preferredServiceHints.has(normalize(hint))).length;
  const apiMatches = (candidate.apiPrefixes ?? []).filter((hint) => preferredApiPrefixes.has(normalize(hint))).length;
  const statusScore = candidate.status === "validated" ? 80 : candidate.status === "candidate" ? 10 : -20;
  return statusScore + candidate.score + pathMatches * 18 + screenMatches * 14 + controllerMatches * 16 + serviceMatches * 16 + apiMatches * 18;
}

export function resolveAnalyzeInputCompactionLimits(counts: {
  structureEntryCount: number;
  frontBackScreenCount: number;
  frontBackLinkCount: number;
  eaiEntryCount: number;
  thresholds?: Partial<AnalyzeInputCompactionThresholds>;
  limits?: Partial<AnalyzeInputCompactionLimits>;
}): AnalyzeInputCompactionLimits | undefined {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(counts.thresholds ?? {}) };
  const shouldCompact =
    counts.structureEntryCount >= thresholds.structureEntryCount ||
    counts.frontBackScreenCount >= thresholds.frontBackScreenCount ||
    counts.frontBackLinkCount >= thresholds.frontBackLinkCount ||
    counts.eaiEntryCount >= thresholds.eaiEntryCount;

  if (!shouldCompact) {
    return undefined;
  }

  return { ...DEFAULT_LIMITS, ...(counts.limits ?? {}) };
}

export function compactAnalyzeKnowledgeInputs(options: {
  structureEntries: Record<string, StructureFileEntryLike>;
  frontBackGraph?: FrontBackGraphSnapshot;
  eaiEntries?: EaiDictionaryEntry[];
  learnedKnowledge?: LearnedKnowledgeSnapshot;
  limits: AnalyzeInputCompactionLimits;
}): CompactAnalyzeKnowledgeInputsResult {
  const structureEntries = options.structureEntries;
  const frontBackGraph = options.frontBackGraph;
  const eaiEntries = options.eaiEntries ?? [];
  const learnedKnowledge = options.learnedKnowledge;
  const limits = options.limits;

  if (!frontBackGraph) {
    return {
      structureEntries,
      frontBackGraph: {
        version: 1,
        generatedAt: new Date().toISOString(),
        meta: {
          backendWorkspaceDir: "",
          frontendWorkspaceDirs: [],
          asOfDate: ""
        },
        frontend: { routeCount: 0, screenCount: 0, apiCount: 0, routes: [], screens: [] },
        backend: { routeCount: 0, gatewayRoutes: [], routes: [] },
        links: [],
        diagnostics: { parseFailures: [], unmatchedFrontendApis: [], unmatchedFrontendScreens: [] }
      },
      eaiEntries,
      learnedKnowledge,
      summary: {
        compactMode: false,
        structureEntriesBefore: Object.keys(structureEntries).length,
        structureEntriesAfter: Object.keys(structureEntries).length,
        frontendScreensBefore: 0,
        frontendScreensAfter: 0,
        frontendRoutesBefore: 0,
        frontendRoutesAfter: 0,
        frontBackLinksBefore: 0,
        frontBackLinksAfter: 0,
        eaiEntriesBefore: eaiEntries.length,
        eaiEntriesAfter: eaiEntries.length,
        learnedKnowledgeCandidatesBefore: learnedKnowledge?.candidates.length ?? 0,
        learnedKnowledgeCandidatesAfter: learnedKnowledge?.candidates.length ?? 0
      }
    };
  }

  const classFileMap = buildStructureClassFileMap(structureEntries);
  const sortedLinks = [...frontBackGraph.links]
    .sort((a, b) => {
      const diff = scoreFrontBackLink(b) - scoreFrontBackLink(a);
      if (diff !== 0) return diff;
      return `${a.backend.controllerMethod}:${a.frontend.screenPath}`.localeCompare(`${b.backend.controllerMethod}:${b.frontend.screenPath}`);
    });
  const selectedLinks = takeSorted(sortedLinks, limits.maxFrontBackLinks);

  const preferredScreenPaths = new Set(selectedLinks.map((link) => link.frontend.screenPath));
  const preferredRoutePaths = new Set(selectedLinks.map((link) => link.frontend.routePath ?? "").filter(Boolean));
  const preferredBackendPaths = new Set(selectedLinks.map((link) => toForwardSlash(link.backend.filePath)));
  const preferredGatewayMethods = new Set(selectedLinks.map((link) => link.gateway.controllerMethod ?? "").filter(Boolean));
  const preferredControllerClasses = new Set(
    selectedLinks.map((link) => (link.backend.controllerMethod.split(".")[0] ?? "").trim()).filter(Boolean)
  );
  const preferredServiceHints = new Set(selectedLinks.flatMap((link) => link.backend.serviceHints.map((hint) => hint.trim())).filter(Boolean));
  const preferredServiceClasses = new Set(Array.from(preferredServiceHints).map((hint) => hint.split(".")[0] ?? "").filter(Boolean));
  const preferredServicePaths = new Set(
    Array.from(preferredServiceClasses)
      .map((className) => classFileMap.get(className))
      .filter(Boolean)
      .map((entry) => toForwardSlash(entry!))
  );
  const preferredPaths = new Set([...preferredBackendPaths, ...preferredServicePaths]);
  const preferredClassNames = new Set([...preferredControllerClasses, ...preferredServiceClasses]);

  const sortedScreens = [...frontBackGraph.frontend.screens].sort((a, b) => {
    const diff = scoreScreen(b, preferredScreenPaths) - scoreScreen(a, preferredScreenPaths);
    if (diff !== 0) return diff;
    return a.filePath.localeCompare(b.filePath);
  });
  const selectedScreens = takeSorted(sortedScreens, limits.maxFrontendScreens);
  const selectedScreenPaths = new Set(selectedScreens.map((screen) => screen.filePath));

  const sortedRoutes = [...frontBackGraph.frontend.routes]
    .filter((route) => selectedScreenPaths.has(route.screenPath) || preferredRoutePaths.has(route.routePath))
    .sort((a, b) => {
      const diff = scoreRoute(b, preferredScreenPaths, preferredRoutePaths) - scoreRoute(a, preferredScreenPaths, preferredRoutePaths);
      if (diff !== 0) return diff;
      return `${a.routePath}:${a.screenPath}`.localeCompare(`${b.routePath}:${b.screenPath}`);
    });
  const selectedRoutes = takeSorted(sortedRoutes, limits.maxFrontendRoutes);

  const selectedGatewayRoutes = frontBackGraph.backend.gatewayRoutes.filter((route) =>
    preferredGatewayMethods.has(`${route.controllerClass}.${route.controllerMethod}`)
  );
  const selectedBackendRoutes = frontBackGraph.backend.routes.filter((route) =>
    selectedLinks.some(
      (link) =>
        route.filePath === link.backend.filePath &&
        `${route.controllerClass}.${route.controllerMethod}` === link.backend.controllerMethod
    )
  );

  const sortedStructureEntries = Object.entries(structureEntries).sort(([pathA, entryA], [pathB, entryB]) => {
    const diff = scoreStructureEntry(pathB, entryB, preferredPaths, preferredClassNames) - scoreStructureEntry(pathA, entryA, preferredPaths, preferredClassNames);
    if (diff !== 0) return diff;
    return pathA.localeCompare(pathB);
  });
  const selectedStructureEntries = Object.fromEntries(takeSorted(sortedStructureEntries, limits.maxStructureEntries));
  const selectedStructurePaths = new Set(Object.keys(selectedStructureEntries).map((entry) => toForwardSlash(entry)));

  const sortedEaiEntries = [...eaiEntries].sort((a, b) => {
    const diff = scoreEaiEntry(b, selectedStructurePaths, preferredClassNames) - scoreEaiEntry(a, selectedStructurePaths, preferredClassNames);
    if (diff !== 0) return diff;
    return a.interfaceId.localeCompare(b.interfaceId);
  });
  const selectedEaiEntries = takeSorted(sortedEaiEntries, limits.maxEaiEntries).map((entry) => ({
    ...entry,
    usagePaths: takeSorted(
      [...entry.usagePaths].sort((a, b) => {
        const aPreferred = selectedStructurePaths.has(toForwardSlash(a)) ? 1 : 0;
        const bPreferred = selectedStructurePaths.has(toForwardSlash(b)) ? 1 : 0;
        if (aPreferred !== bPreferred) return bPreferred - aPreferred;
        return a.localeCompare(b);
      }),
      limits.maxEaiUsagePathsPerEntry
    ),
    moduleUsagePaths: takeSorted(
      [...entry.moduleUsagePaths].sort((a, b) => {
        const aPreferred = selectedStructurePaths.has(toForwardSlash(a)) ? 1 : 0;
        const bPreferred = selectedStructurePaths.has(toForwardSlash(b)) ? 1 : 0;
        if (aPreferred !== bPreferred) return bPreferred - aPreferred;
        return a.localeCompare(b);
      }),
      limits.maxEaiUsagePathsPerEntry
    ),
    javaCallSites: takeSorted(
      [...entry.javaCallSites].sort((a, b) => {
        const aScore = (selectedStructurePaths.has(toForwardSlash(a.path)) ? 100 : 0) + (a.direct ? 10 : 0);
        const bScore = (selectedStructurePaths.has(toForwardSlash(b.path)) ? 100 : 0) + (b.direct ? 10 : 0);
        if (aScore !== bScore) return bScore - aScore;
        return `${a.className ?? ""}.${a.methodName ?? ""}`.localeCompare(`${b.className ?? ""}.${b.methodName ?? ""}`);
      }),
      limits.maxEaiCallSitesPerEntry
    )
  }));

  const preferredPathHints = new Set(Array.from(preferredPaths).map((entry) => normalize(entry.split("/")[0] ?? entry)));
  const preferredScreenPrefixes = new Set(
    selectedScreens.map((screen) => normalize(screen.screenCode?.split("-")[0] ?? screen.screenCode ?? "")).filter(Boolean)
  );
  const preferredControllerHints = new Set(Array.from(preferredControllerClasses).map(normalize));
  const preferredServiceHintClasses = new Set(Array.from(preferredServiceClasses).map(normalize));
  const preferredApiPrefixes = new Set(
    selectedLinks.map((link) => normalize(link.api.normalizedUrl.split("/").filter(Boolean).slice(0, 3).join("/"))).filter(Boolean)
  );
  const selectedLearnedKnowledge = learnedKnowledge
    ? {
        ...learnedKnowledge,
        candidates: takeSorted(
          [...learnedKnowledge.candidates].sort((a, b) => {
            const diff =
              scoreLearnedKnowledgeCandidate(
                b,
                preferredPathHints,
                preferredScreenPrefixes,
                preferredControllerHints,
                preferredServiceHintClasses,
                preferredApiPrefixes
              ) -
              scoreLearnedKnowledgeCandidate(
                a,
                preferredPathHints,
                preferredScreenPrefixes,
                preferredControllerHints,
                preferredServiceHintClasses,
                preferredApiPrefixes
              );
            if (diff !== 0) return diff;
            return a.id.localeCompare(b.id);
          }),
          limits.maxLearnedKnowledgeCandidates
        )
      }
    : undefined;

  const compactedFrontBackGraph: FrontBackGraphSnapshot = {
    ...frontBackGraph,
    frontend: {
      ...frontBackGraph.frontend,
      routeCount: selectedRoutes.length,
      screenCount: selectedScreens.length,
      apiCount: unique(selectedLinks.map((link) => link.api.normalizedUrl)).length,
      routes: selectedRoutes,
      screens: selectedScreens
    },
    backend: {
      ...frontBackGraph.backend,
      routeCount: selectedBackendRoutes.length + selectedGatewayRoutes.length,
      gatewayRoutes: selectedGatewayRoutes,
      routes: selectedBackendRoutes
    },
    links: selectedLinks
  };

  return {
    structureEntries: selectedStructureEntries,
    frontBackGraph: compactedFrontBackGraph,
    eaiEntries: selectedEaiEntries,
    learnedKnowledge: selectedLearnedKnowledge,
    summary: {
      compactMode: true,
      structureEntriesBefore: Object.keys(structureEntries).length,
      structureEntriesAfter: Object.keys(selectedStructureEntries).length,
      frontendScreensBefore: frontBackGraph.frontend.screens.length,
      frontendScreensAfter: selectedScreens.length,
      frontendRoutesBefore: frontBackGraph.frontend.routes.length,
      frontendRoutesAfter: selectedRoutes.length,
      frontBackLinksBefore: frontBackGraph.links.length,
      frontBackLinksAfter: selectedLinks.length,
      eaiEntriesBefore: eaiEntries.length,
      eaiEntriesAfter: selectedEaiEntries.length,
      learnedKnowledgeCandidatesBefore: learnedKnowledge?.candidates.length ?? 0,
      learnedKnowledgeCandidatesAfter: selectedLearnedKnowledge?.candidates.length ?? 0
    }
  };
}
