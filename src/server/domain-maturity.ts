import type { DomainPack } from "./domain-packs.js";
import type { FrontBackGraphSnapshot } from "./front-back-graph.js";
import type { EaiDictionaryEntry } from "./eai-dictionary.js";
import type { DownstreamFlowTrace } from "./flow-trace.js";
import { extractQuestionCapabilityTags } from "./flow-capabilities.js";

interface StructureSymbolLike {
  name: string;
  className?: string;
}

interface StructureEntryLike {
  path: string;
  packageName?: string;
  classes: StructureSymbolLike[];
  methods: StructureSymbolLike[];
  functions: StructureSymbolLike[];
  calls: string[];
  summary: string;
}

interface StructureSnapshotLike {
  entries: Record<string, StructureEntryLike>;
}

export interface DomainMaturityBreakdown {
  vocabularyCoverage: number;
  frontendCoverage: number;
  backendCoverage: number;
  crossLayerCoverage: number;
  downstreamCoverage: number;
  integrationCoverage: number;
  regressionCoverage: number;
}

export interface DomainMaturityResult {
  id: string;
  name: string;
  description: string;
  score: number;
  band: "seed" | "emerging" | "usable" | "mature" | "strong";
  matchedCapabilityTags: string[];
  counts: {
    capabilitiesMatched: number;
    screenCount: number;
    backendRouteCount: number;
    linkCount: number;
    downstreamTraceCount: number;
    eaiCount: number;
    exemplarPassed: number;
    exemplarTotal: number;
  };
  breakdown: DomainMaturityBreakdown;
  strongestSignals: string[];
  weakestSignals: string[];
}

export interface DomainMaturitySummary {
  overallScore: number;
  activeCount: number;
  matureCount: number;
  strongestDomains: string[];
  weakestDomains: string[];
}

export interface DomainMaturityOutput {
  domains: DomainMaturityResult[];
  summary: DomainMaturitySummary;
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compilePattern(pattern: string): RegExp | null {
  const raw = pattern.trim();
  if (!raw) {
    return null;
  }
  try {
    return new RegExp(raw, "i");
  } catch {
    try {
      return new RegExp(escapeRegExp(raw), "i");
    } catch {
      return null;
    }
  }
}

function buildDomainPatterns(domainPack: DomainPack): RegExp[] {
  return domainPack.capabilityTags
    .flatMap((capability) => [
      capability.tag,
      ...(capability.aliases ?? []),
      ...(capability.questionPatterns ?? []),
      ...(capability.textPatterns ?? []),
      ...(capability.searchTerms ?? []),
      ...(capability.pathHints ?? []),
      ...(capability.symbolHints ?? []),
      ...(capability.apiHints ?? [])
    ])
    .map(compilePattern)
    .filter((pattern): pattern is RegExp => Boolean(pattern));
}

function itemMatchesDomainByTagsOrText(
  domainPack: DomainPack,
  texts: Array<string | undefined>,
  tags?: string[]
): boolean {
  const tagSet = new Set(tags ?? []);
  if (domainPack.capabilityTags.some((capability) => tagSet.has(capability.tag))) {
    return true;
  }
  const joined = texts.filter(Boolean).join("\n");
  if (!joined) {
    return false;
  }
  return buildDomainPatterns(domainPack).some((pattern) => pattern.test(joined));
}

function resolveBand(score: number): DomainMaturityResult["band"] {
  if (score >= 90) return "strong";
  if (score >= 75) return "mature";
  if (score >= 50) return "usable";
  if (score >= 25) return "emerging";
  return "seed";
}

function evaluateExemplars(options: {
  domainPack: DomainPack;
  frontBackGraph?: FrontBackGraphSnapshot;
  structure?: StructureSnapshotLike;
}): { passed: number; total: number } {
  const total = options.domainPack.exemplars.length;
  if (total === 0) {
    return { passed: 0, total: 0 };
  }

  let passed = 0;
  const graphText = options.frontBackGraph
    ? options.frontBackGraph.links
        .map((link) =>
          [
            link.frontend.screenCode,
            link.frontend.routePath,
            link.api.rawUrl,
            link.api.normalizedUrl,
            link.gateway.controllerMethod,
            link.backend.path,
            link.backend.controllerMethod,
            ...link.backend.serviceHints,
            ...(link.capabilityTags ?? [])
          ]
            .filter(Boolean)
            .join(" ")
        )
        .join("\n")
    : "";
  const structureText = options.structure
    ? Object.values(options.structure.entries)
        .map((entry) =>
          [
            entry.path,
            entry.packageName,
            entry.summary,
            ...entry.classes.map((item) => item.name),
            ...entry.methods.map((item) => item.name),
            ...entry.functions.map((item) => item.name),
            ...entry.calls
          ]
            .filter(Boolean)
            .join(" ")
        )
        .join("\n")
    : "";

  for (const exemplar of options.domainPack.exemplars) {
    const questionTags = new Set(extractQuestionCapabilityTags(exemplar.question, { domainPacks: [options.domainPack] }));
    const expectedTags = exemplar.expectedTags ?? [];
    const expectedPaths = exemplar.expectedPaths ?? [];
    const expectedApiPatterns = exemplar.expectedApiPatterns ?? [];
    const expectedControllerPatterns = exemplar.expectedControllerPatterns ?? [];
    const tagsOk = expectedTags.length === 0 || expectedTags.some((tag) => questionTags.has(tag));
    const pathsOk = expectedPaths.length === 0 || expectedPaths.some((pattern) => graphText.includes(pattern) || structureText.includes(pattern));
    const apiOk = expectedApiPatterns.length === 0 || expectedApiPatterns.some((pattern) => graphText.match(compilePattern(pattern) ?? /^$/));
    const controllerOk =
      expectedControllerPatterns.length === 0 ||
      expectedControllerPatterns.some((pattern) => (graphText + "\n" + structureText).match(compilePattern(pattern) ?? /^$/));
    if (tagsOk && pathsOk && apiOk && controllerOk) {
      passed += 1;
    }
  }

  return { passed, total };
}

export function computeDomainMaturity(options: {
  domainPacks: DomainPack[];
  frontBackGraph?: FrontBackGraphSnapshot;
  structure?: StructureSnapshotLike;
  eaiEntries?: EaiDictionaryEntry[];
  downstreamTraces?: DownstreamFlowTrace[];
}): DomainMaturityOutput {
  const structureEntries = Object.values(options.structure?.entries ?? {});
  const eaiEntries = options.eaiEntries ?? [];
  const downstreamTraces = options.downstreamTraces ?? [];

  const domains = options.domainPacks.map((domainPack) => {
    const matchedCapabilities = domainPack.capabilityTags
      .filter((capability) => {
        const capabilityPatterns = [
          capability.tag,
          ...(capability.aliases ?? []),
          ...(capability.questionPatterns ?? []),
          ...(capability.textPatterns ?? []),
          ...(capability.searchTerms ?? []),
          ...(capability.pathHints ?? []),
          ...(capability.symbolHints ?? []),
          ...(capability.apiHints ?? [])
        ]
          .map(compilePattern)
          .filter((pattern): pattern is RegExp => Boolean(pattern));

        const frontMatched = (options.frontBackGraph?.links ?? []).some((link) =>
          (link.capabilityTags ?? []).includes(capability.tag) ||
          capabilityPatterns.some((pattern) =>
            pattern.test(
              [
                link.frontend.screenCode,
                link.frontend.routePath,
                link.api.rawUrl,
                link.api.normalizedUrl,
                link.backend.path,
                link.backend.controllerMethod,
                ...link.backend.serviceHints
              ]
                .filter(Boolean)
                .join("\n")
            )
          )
        );
        const structureMatched = structureEntries.some((entry) =>
          capabilityPatterns.some((pattern) =>
            pattern.test(
              [
                entry.path,
                entry.packageName,
                entry.summary,
                ...entry.classes.map((item) => item.name),
                ...entry.methods.map((item) => item.name),
                ...entry.functions.map((item) => item.name),
                ...entry.calls
              ]
                .filter(Boolean)
                .join("\n")
            )
          )
        );
        const eaiMatched = eaiEntries.some((entry) =>
          capabilityPatterns.some((pattern) =>
            pattern.test(
              [
                entry.interfaceId,
                entry.interfaceName,
                entry.purpose,
                entry.sourcePath,
                ...entry.usagePaths,
                ...entry.moduleUsagePaths,
                ...entry.javaCallSites.map((site) => `${site.path} ${site.methodName ?? ""}`)
              ]
                .filter(Boolean)
                .join("\n")
            )
          )
        );
        return frontMatched || structureMatched || eaiMatched;
      })
      .map((capability) => capability.tag);

    const matchedScreens = (options.frontBackGraph?.frontend.screens ?? []).filter((screen) =>
      itemMatchesDomainByTagsOrText(domainPack, [screen.filePath, screen.screenCode, ...screen.routePaths, ...screen.apiPaths, ...(screen.labels ?? [])], screen.capabilityTags)
    );
    const matchedBackendRoutes = (options.frontBackGraph?.backend.routes ?? []).filter((route) =>
      itemMatchesDomainByTagsOrText(domainPack, [route.filePath, route.path, route.internalPath, route.controllerClass, route.controllerMethod, ...route.serviceHints, ...(route.labels ?? [])], route.capabilityTags)
    );
    const matchedLinks = (options.frontBackGraph?.links ?? []).filter((link) =>
      itemMatchesDomainByTagsOrText(
        domainPack,
        [
          link.frontend.screenCode,
          link.frontend.routePath,
          link.api.rawUrl,
          link.api.normalizedUrl,
          link.gateway.controllerMethod,
          link.backend.path,
          link.backend.controllerMethod,
          ...link.backend.serviceHints
        ],
        link.capabilityTags
      )
    );
    const matchedDownstreamTraces = downstreamTraces.filter((trace) =>
      itemMatchesDomainByTagsOrText(domainPack, [trace.serviceMethod, trace.backendControllerMethod, trace.phase, ...trace.steps, ...trace.eaiInterfaces])
    );
    const matchedEaiEntries = eaiEntries.filter((entry) =>
      itemMatchesDomainByTagsOrText(
        domainPack,
        [
          entry.interfaceId,
          entry.interfaceName,
          entry.purpose,
          entry.sourcePath,
          ...entry.usagePaths,
          ...entry.moduleUsagePaths,
          ...entry.javaCallSites.map((site) => `${site.path} ${site.methodName ?? ""}`)
        ]
      )
    );
    const matchedStructureEntries = structureEntries.filter((entry) =>
      itemMatchesDomainByTagsOrText(
        domainPack,
        [
          entry.path,
          entry.packageName,
          entry.summary,
          ...entry.classes.map((item) => item.name),
          ...entry.methods.map((item) => item.name),
          ...entry.functions.map((item) => item.name),
          ...entry.calls
        ]
      )
    );

    const vocabularyCoverage = Math.round(
      clamp((matchedCapabilities.length / Math.max(1, domainPack.capabilityTags.length)) * 20, 0, 20)
    );
    const frontendCoverage = Math.round(
      clamp(matchedScreens.length * 4 + matchedScreens.filter((screen) => screen.apiPaths.length > 0).length * 3, 0, 15)
    );
    const backendCoverage = Math.round(
      clamp(matchedBackendRoutes.length * 4 + matchedStructureEntries.length * 1.5, 0, 15)
    );
    const crossLayerCoverage = Math.round(clamp(matchedLinks.length * 6, 0, 20));
    const downstreamCoverage = Math.round(
      clamp(
        (matchedDownstreamTraces.length > 0
          ? matchedDownstreamTraces.length
          : matchedLinks.filter((link) => link.backend.serviceHints.length > 0).length) * 4,
        0,
        15
      )
    );
    const integrationCoverage = Math.round(clamp(matchedEaiEntries.length * 3, 0, 10));
    const exemplarEval = evaluateExemplars({
      domainPack,
      frontBackGraph: options.frontBackGraph,
      structure: options.structure
    });
    const regressionCoverage = exemplarEval.total > 0 ? Math.round((exemplarEval.passed / exemplarEval.total) * 5) : 0;

    const breakdown: DomainMaturityBreakdown = {
      vocabularyCoverage,
      frontendCoverage,
      backendCoverage,
      crossLayerCoverage,
      downstreamCoverage,
      integrationCoverage,
      regressionCoverage
    };
    const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
    const strongestSignals = unique([
      matchedCapabilities.length > 0 ? `tags=${matchedCapabilities.slice(0, 4).join(",")}` : "",
      matchedScreens.length > 0 ? `screens=${matchedScreens.length}` : "",
      matchedBackendRoutes.length > 0 ? `backendRoutes=${matchedBackendRoutes.length}` : "",
      matchedLinks.length > 0 ? `flowLinks=${matchedLinks.length}` : "",
      matchedEaiEntries.length > 0 ? `eai=${matchedEaiEntries.length}` : ""
    ]).slice(0, 5);
    const weakestSignals = unique([
      matchedScreens.length === 0 ? "no-frontend-coverage" : "",
      matchedBackendRoutes.length === 0 && matchedStructureEntries.length === 0 ? "no-backend-coverage" : "",
      matchedLinks.length === 0 ? "no-cross-layer-links" : "",
      matchedDownstreamTraces.length === 0 ? "no-downstream-traces" : "",
      matchedEaiEntries.length === 0 ? "no-eai-evidence" : "",
      exemplarEval.total === 0 ? "no-exemplars" : exemplarEval.passed < exemplarEval.total ? "partial-exemplar-pass" : ""
    ]).slice(0, 5);

    return {
      id: domainPack.id,
      name: domainPack.name,
      description: domainPack.description,
      score,
      band: resolveBand(score),
      matchedCapabilityTags: matchedCapabilities,
      counts: {
        capabilitiesMatched: matchedCapabilities.length,
        screenCount: matchedScreens.length,
        backendRouteCount: matchedBackendRoutes.length + matchedStructureEntries.length,
        linkCount: matchedLinks.length,
        downstreamTraceCount: matchedDownstreamTraces.length,
        eaiCount: matchedEaiEntries.length,
        exemplarPassed: exemplarEval.passed,
        exemplarTotal: exemplarEval.total
      },
      breakdown,
      strongestSignals,
      weakestSignals
    } satisfies DomainMaturityResult;
  });

  const overallScore = domains.length > 0 ? Math.round(domains.reduce((sum, item) => sum + item.score, 0) / domains.length) : 0;
  const strongestDomains = [...domains]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => `${item.name}(${item.score})`);
  const weakestDomains = [...domains]
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((item) => `${item.name}(${item.score})`);

  return {
    domains: domains.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.name.localeCompare(b.name))),
    summary: {
      overallScore,
      activeCount: domains.length,
      matureCount: domains.filter((item) => item.score >= 75).length,
      strongestDomains,
      weakestDomains
    }
  };
}
