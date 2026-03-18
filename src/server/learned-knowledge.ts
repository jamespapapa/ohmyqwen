import { z } from "zod";
import {
  extractOntologyTextSignalsFromTexts,
  extractSpecificOntologySignals,
  scoreOntologySignalAlignment
} from "./ontology-signals.js";

export const LearnedKnowledgeKindSchema = z.enum(["domain", "module-role", "process", "channel"]);
export const LearnedKnowledgeStatusSchema = z.enum(["candidate", "validated", "stale"]);

export const LearnedKnowledgeCandidateSchema = z.object({
  id: z.string().min(1),
  kind: LearnedKnowledgeKindSchema,
  status: LearnedKnowledgeStatusSchema,
  label: z.string().min(1),
  description: z.string().default(""),
  tags: z.array(z.string().min(1)).default([]),
  aliases: z.array(z.string().min(1)).default([]),
  apiPrefixes: z.array(z.string().min(1)).default([]),
  screenPrefixes: z.array(z.string().min(1)).default([]),
  controllerHints: z.array(z.string().min(1)).default([]),
  serviceHints: z.array(z.string().min(1)).default([]),
  pathHints: z.array(z.string().min(1)).default([]),
  searchTerms: z.array(z.string().min(1)).default([]),
  evidence: z.array(z.string().min(1)).default([]),
  score: z.number().min(0).max(100),
  counts: z.object({
    links: z.number().int().min(0).default(0),
    screens: z.number().int().min(0).default(0),
    backend: z.number().int().min(0).default(0),
    eai: z.number().int().min(0).default(0),
    uses: z.number().int().min(0).default(0),
    successes: z.number().int().min(0).default(0),
    failures: z.number().int().min(0).default(0)
  }),
  firstSeenAt: z.string().min(1),
  lastSeenAt: z.string().min(1)
});

export const LearnedKnowledgeSummarySchema = z.object({
  candidateCount: z.number().int().min(0),
  validatedCount: z.number().int().min(0),
  staleCount: z.number().int().min(0),
  domainCount: z.number().int().min(0),
  moduleRoleCount: z.number().int().min(0),
  processCount: z.number().int().min(0),
  channelCount: z.number().int().min(0),
  strongestCandidates: z.array(z.string().min(1)).default([])
});

export const LearnedKnowledgeSnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  candidates: z.array(LearnedKnowledgeCandidateSchema),
  summary: LearnedKnowledgeSummarySchema
});

export type LearnedKnowledgeKind = z.infer<typeof LearnedKnowledgeKindSchema>;
export type LearnedKnowledgeStatus = z.infer<typeof LearnedKnowledgeStatusSchema>;
export type LearnedKnowledgeCandidate = z.infer<typeof LearnedKnowledgeCandidateSchema>;
export type LearnedKnowledgeSnapshot = z.infer<typeof LearnedKnowledgeSnapshotSchema>;

export interface LearnedKnowledgeMatch {
  id: string;
  kind: LearnedKnowledgeKind;
  status: LearnedKnowledgeStatus;
  label: string;
  score: number;
  reasons: string[];
  searchTerms: string[];
}

export interface LearnedKnowledgePromotionAction {
  candidateId: string;
  currentStatus: LearnedKnowledgeStatus;
  targetStatus: LearnedKnowledgeStatus;
  score: number;
  reasons: string[];
  confidence: number;
}

export interface LearnedKnowledgeFrontBackLinkLike {
  frontend: {
    screenCode?: string;
    screenPath?: string;
    routePath?: string;
  };
  api: {
    rawUrl: string;
    normalizedUrl: string;
  };
  gateway: {
    path?: string;
    controllerMethod?: string;
  };
  backend: {
    path: string;
    controllerMethod: string;
    filePath: string;
    serviceHints: string[];
  };
}

export interface LearnedKnowledgeFrontBackGraphLike {
  frontend?: {
    routes?: Array<{
      routePath: string;
      screenPath: string;
      screenCode?: string;
      notes?: string[];
      capabilityTags?: string[];
    }>;
    screens?: Array<{
      filePath: string;
      screenCode?: string;
      labels?: string[];
      capabilityTags?: string[];
      routePaths: string[];
      apiPaths: string[];
    }>;
  };
  links: LearnedKnowledgeFrontBackLinkLike[];
}

export interface LearnedKnowledgeStructureEntryLike {
  path: string;
  packageName?: string;
  classes: Array<{ name: string }>;
  methods: Array<{ name: string }>;
  functions: Array<{ name: string }>;
  calls: string[];
  summary: string;
}

export interface LearnedKnowledgeStructureSnapshotLike {
  entries: Record<string, LearnedKnowledgeStructureEntryLike>;
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function toForwardSlash(value: string): string {
  return value.replace(/\\/g, "/");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function tokenize(value: string): string[] {
  return unique(value.toLowerCase().match(/[a-z0-9가-힣._/-]+/g) ?? []);
}

function takeTop(items: string[], limit: number): string[] {
  return unique(items).slice(0, limit);
}

function humanizeIdentifier(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractControllerClass(value: string): string {
  return value.split(".")[0] ?? value;
}

function extractServiceClass(value: string): string {
  return value.split(".")[0] ?? value;
}

function extractScreenPrefix(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(/^[A-Z]+-[A-Z]+[0-9]{4,}/);
  if (!match) {
    return value;
  }
  return match[0].slice(0, Math.min(match[0].length, 11));
}

const ACTION_SEGMENTS = new Set([
  "list",
  "history",
  "detail",
  "detailview",
  "detailinfo",
  "inqury",
  "inquiry",
  "check",
  "proc",
  "apply",
  "insert",
  "update",
  "delete",
  "cancel",
  "save",
  "saveinput",
  "saveinputinfo",
  "getinput",
  "getaccntno",
  "insertaccntno",
  "requestloanmember",
  "loanadmit",
  "checktime",
  "selectcustinfo"
]);

function deriveApiCluster(normalizedUrl: string): string | undefined {
  const segments = toForwardSlash(normalizedUrl)
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return undefined;
  }
  const prefix = segments.slice(0, Math.min(5, segments.length));
  while (prefix.length > 2 && ACTION_SEGMENTS.has(prefix[prefix.length - 1]!.toLowerCase())) {
    prefix.pop();
  }
  return prefix.join("/");
}

const GENERIC_CHANNEL_STOPWORDS = new Set([
  "gw",
  "api",
  "mo",
  "pc",
  "mysamsunglife",
  "screen",
  "route",
  "frontend",
  "backend",
  "controller",
  "service",
  "member",
  "members",
  "login",
  "auth",
  "register",
  "registe",
  "signup",
  "channel",
  "partner",
  "bridge",
  "callback",
  "webhook",
  "embedded",
  "embeded",
  "insurance",
  "benefit",
  "claim",
  "loan",
  "pension",
  "fund",
  "request",
  "response",
  "status",
  "state",
  "info",
  "check",
  "save",
  "insert",
  "update",
  "delete",
  "read",
  "write",
  "inqury",
  "inquiry",
  "progress",
  "proc",
  "process",
  "main",
  "common",
  "view",
  "views",
  "src",
  "java",
  "com",
  "callbackres",
  "v1",
  "v2"
]);

function tokenizePathSegments(value?: string): string[] {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1/$2")
    .split(/[\\/.:_-]+/g)
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
}

function inferChannelCandidates(
  values: Array<{ value?: string; source: "frontend" | "api" | "backend" }>
): string[] {
  const tokenCounts = new Map<string, number>();
  const tokenSourceKinds = new Map<string, Set<"frontend" | "api" | "backend">>();

  for (const entry of values) {
    const normalized = String(entry.value ?? "");
    if (!normalized.trim()) {
      continue;
    }
    const bucketTokens = new Set(
      tokenizePathSegments(normalized).filter(
        (token) => token.length >= 3 && !GENERIC_CHANNEL_STOPWORDS.has(token) && !/^\d+$/.test(token)
      )
    );
    for (const token of bucketTokens) {
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
      const sourceKinds = tokenSourceKinds.get(token) ?? new Set<"frontend" | "api" | "backend">();
      sourceKinds.add(entry.source);
      tokenSourceKinds.set(token, sourceKinds);
    }
  }

  return Array.from(tokenCounts.entries())
    .filter(([, count]) => count >= 2)
    .filter(([token]) => {
      const sourceKinds = tokenSourceKinds.get(token);
      return Boolean(sourceKinds?.has("frontend") && ((sourceKinds?.has("api") ?? false) || (sourceKinds?.has("backend") ?? false)));
    })
    .map(([token]) => token)
    .sort((left, right) => {
      const countDiff = (tokenCounts.get(right) ?? 0) - (tokenCounts.get(left) ?? 0);
      return countDiff !== 0 ? countDiff : left.localeCompare(right);
    });
}

function inferCandidateKind(input: {
  apiCluster?: string;
  pathHints: string[];
  screenPrefixes: string[];
  controllerHints: string[];
}): LearnedKnowledgeKind {
  const texts = [
    input.apiCluster,
    ...input.pathHints,
    ...input.screenPrefixes,
    ...input.controllerHints
  ].filter(Boolean);
  const joined = texts.join(" ").toLowerCase();
  const signals = extractOntologyTextSignalsFromTexts(texts);
  if (
    inferChannelCandidates([
      ...input.screenPrefixes.map((value) => ({ value, source: "frontend" as const })),
      ...[input.apiCluster].filter(Boolean).map((value) => ({ value, source: "api" as const })),
      ...input.pathHints.map((value) => ({ value, source: "backend" as const })),
      ...input.controllerHints.map((value) => ({ value, source: "backend" as const }))
    ]).length > 0 ||
    signals.some((signal) => signal.startsWith("channel:")) ||
    /(partner|channel|bridge|callback|webhook|embedded|embeded|제휴|채널|브릿지|콜백|외부연계)/.test(joined)
  ) {
    return "channel";
  }
  if (/batch|job|scheduler|tasklet|step/.test(joined)) {
    return "process";
  }
  if (/dcp-core|dcp-gateway|dcp-async|dcp-display|dcp-upload/.test(joined)) {
    return "module-role";
  }
  return "domain";
}

function computeCandidateScore(candidate: LearnedKnowledgeCandidate): number {
  const uses = candidate.counts.uses;
  const successRate = uses > 0 ? candidate.counts.successes / uses : 0;
  const base =
    Math.min(40, candidate.counts.links * 4) +
    Math.min(20, candidate.counts.backend * 3) +
    Math.min(15, candidate.counts.screens * 2) +
    Math.min(10, candidate.counts.eai * 2) +
    Math.min(15, candidate.searchTerms.length * 2);
  const usageBonus = Math.min(20, candidate.counts.successes * 4);
  const failurePenalty = Math.min(20, candidate.counts.failures * 3);
  return Math.max(0, Math.min(100, Math.round(base + usageBonus + successRate * 10 - failurePenalty)));
}

function computeCandidateStatus(candidate: LearnedKnowledgeCandidate): LearnedKnowledgeStatus {
  const uses = candidate.counts.uses;
  const successRate = uses > 0 ? candidate.counts.successes / uses : 0;
  const failureRate = uses > 0 ? candidate.counts.failures / uses : 0;
  if (
    uses >= 2 &&
    candidate.counts.failures >= Math.max(2, candidate.counts.successes + 1) &&
    (successRate <= 0.34 || failureRate >= 0.66)
  ) {
    return "stale";
  }
  if (candidate.score >= 60 || candidate.counts.links >= 3 || (uses >= 2 && successRate >= 0.8)) {
    return "validated";
  }
  return "candidate";
}

function normalizeCandidate(candidate: LearnedKnowledgeCandidate): LearnedKnowledgeCandidate {
  const next: LearnedKnowledgeCandidate = {
    ...candidate,
    tags: takeTop(candidate.tags, 12),
    aliases: takeTop(candidate.aliases, 12),
    apiPrefixes: takeTop(candidate.apiPrefixes, 8),
    screenPrefixes: takeTop(candidate.screenPrefixes, 8),
    controllerHints: takeTop(candidate.controllerHints, 8),
    serviceHints: takeTop(candidate.serviceHints, 8),
    pathHints: takeTop(candidate.pathHints, 8),
    searchTerms: takeTop(candidate.searchTerms, 12),
    evidence: takeTop(candidate.evidence, 8)
  };
  next.score = computeCandidateScore(next);
  next.status = computeCandidateStatus(next);
  return next;
}

function createCandidate(input: Omit<LearnedKnowledgeCandidate, "score" | "status">): LearnedKnowledgeCandidate {
  return normalizeCandidate({
    ...input,
    score: 0,
    status: "candidate"
  });
}

function summarize(candidates: LearnedKnowledgeCandidate[]) {
  const validated = candidates.filter((candidate) => candidate.status === "validated");
  const stale = candidates.filter((candidate) => candidate.status === "stale");
  return {
    candidateCount: candidates.length,
    validatedCount: validated.length,
    staleCount: stale.length,
    domainCount: candidates.filter((candidate) => candidate.kind === "domain").length,
    moduleRoleCount: candidates.filter((candidate) => candidate.kind === "module-role").length,
    processCount: candidates.filter((candidate) => candidate.kind === "process").length,
    channelCount: candidates.filter((candidate) => candidate.kind === "channel").length,
    strongestCandidates: candidates
      .slice()
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id.localeCompare(b.id)))
      .slice(0, 8)
      .map((candidate) => candidate.id)
  };
}

export function computeLearnedKnowledgeSnapshot(options: {
  generatedAt: string;
  frontBackGraph?: LearnedKnowledgeFrontBackGraphLike;
  structure?: LearnedKnowledgeStructureSnapshotLike;
  existing?: LearnedKnowledgeSnapshot;
}): LearnedKnowledgeSnapshot {
  const candidates = new Map<string, LearnedKnowledgeCandidate>();
  const existingById = new Map((options.existing?.candidates ?? []).map((item) => [item.id, item]));

  const upsert = (candidate: LearnedKnowledgeCandidate) => {
    const previous = candidates.get(candidate.id) ?? existingById.get(candidate.id);
    if (!previous) {
      candidates.set(candidate.id, normalizeCandidate(candidate));
      return;
    }
    candidates.set(
      candidate.id,
      normalizeCandidate({
        ...previous,
        label: candidate.label || previous.label,
        description: candidate.description || previous.description,
        kind: candidate.kind,
        tags: [...previous.tags, ...candidate.tags],
        aliases: [...previous.aliases, ...candidate.aliases],
        apiPrefixes: [...previous.apiPrefixes, ...candidate.apiPrefixes],
        screenPrefixes: [...previous.screenPrefixes, ...candidate.screenPrefixes],
        controllerHints: [...previous.controllerHints, ...candidate.controllerHints],
        serviceHints: [...previous.serviceHints, ...candidate.serviceHints],
        pathHints: [...previous.pathHints, ...candidate.pathHints],
        searchTerms: [...previous.searchTerms, ...candidate.searchTerms],
        evidence: [...previous.evidence, ...candidate.evidence],
        counts: {
          links: Math.max(previous.counts.links, candidate.counts.links),
          screens: Math.max(previous.counts.screens, candidate.counts.screens),
          backend: Math.max(previous.counts.backend, candidate.counts.backend),
          eai: Math.max(previous.counts.eai, candidate.counts.eai),
          uses: previous.counts.uses,
          successes: previous.counts.successes,
          failures: previous.counts.failures
        },
        firstSeenAt: previous.firstSeenAt,
        lastSeenAt: options.generatedAt
      })
    );
  };

  const graphLinks = options.frontBackGraph?.links ?? [];
  const frontendScreens = new Map(
    (options.frontBackGraph?.frontend?.screens ?? [])
      .filter((item) => item.screenCode)
      .map((item) => [item.screenCode!, item])
  );
  const frontendRoutes = new Map(
    (options.frontBackGraph?.frontend?.routes ?? [])
      .filter((item) => item.screenCode)
      .map((item) => [item.screenCode!, item])
  );
  const graphGroups = new Map<string, LearnedKnowledgeFrontBackLinkLike[]>();
  for (const link of graphLinks) {
    const cluster = deriveApiCluster(link.api.normalizedUrl);
    if (!cluster) {
      continue;
    }
    const key = `graph:${slugify(cluster)}`;
    const group = graphGroups.get(key) ?? [];
    group.push(link);
    graphGroups.set(key, group);
  }

  for (const [candidateId, links] of graphGroups) {
    if (links.length < 3) {
      continue;
    }
    const apiCluster = deriveApiCluster(links[0]?.api.normalizedUrl ?? "");
    const screenPrefixes = takeTop(
      links.map((link) => extractScreenPrefix(link.frontend.screenCode)).filter((item): item is string => Boolean(item)),
      6
    );
    const controllerHints = takeTop(links.map((link) => extractControllerClass(link.backend.controllerMethod)), 6);
    const serviceHints = takeTop(
      links.flatMap((link) => link.backend.serviceHints.map((item) => extractServiceClass(item))),
      6
    );
    const screenLabels = takeTop(
      links.flatMap((link) => {
        const screen = link.frontend.screenCode ? frontendScreens.get(link.frontend.screenCode) : undefined;
        const route = link.frontend.screenCode ? frontendRoutes.get(link.frontend.screenCode) : undefined;
        return [
          ...(screen?.labels ?? []),
          ...(screen?.capabilityTags ?? []),
          ...(route?.notes ?? []),
          ...(route?.capabilityTags ?? [])
        ];
      }),
      8
    );
    const pathHints = takeTop(links.map((link) => link.backend.filePath.split("/")[0] ?? link.backend.filePath), 4);
    const kind = inferCandidateKind({
      apiCluster,
      pathHints,
      screenPrefixes,
      controllerHints
    });
    const label = apiCluster ? humanizeIdentifier(apiCluster) : humanizeIdentifier(candidateId.replace(/^graph:/, ""));
    const uniqueScreens = new Set(links.map((link) => link.frontend.screenCode).filter(Boolean));
    const uniqueBackends = new Set(links.map((link) => link.backend.path).filter(Boolean));
    upsert(
      createCandidate({
        id: candidateId,
        kind,
        label,
        description: `${label} cluster learned from front-back graph`,
        tags: apiCluster ? apiCluster.split("/").map((item) => slugify(item)).filter(Boolean) : [],
        aliases: [
          label,
          ...(screenPrefixes ?? []),
          ...screenLabels,
          ...controllerHints.map(humanizeIdentifier),
          ...serviceHints.map(humanizeIdentifier)
        ],
        apiPrefixes: apiCluster ? [apiCluster] : [],
        screenPrefixes,
        controllerHints,
        serviceHints,
        pathHints,
        searchTerms: [
          ...(apiCluster ? [apiCluster] : []),
          ...screenPrefixes,
          ...screenLabels,
          ...controllerHints,
          ...serviceHints
        ],
        evidence: takeTop(
          links.map(
            (link) =>
              `${link.frontend.screenCode ?? link.frontend.routePath ?? "(unknown)"} -> ${link.api.rawUrl} -> ${link.backend.controllerMethod}`
          ),
          5
        ),
        counts: {
          links: links.length,
          screens: uniqueScreens.size,
          backend: uniqueBackends.size,
          eai: 0,
          uses: 0,
          successes: 0,
          failures: 0
        },
        firstSeenAt: options.generatedAt,
        lastSeenAt: options.generatedAt
      })
    );
  }

  const structureEntries = Object.values(options.structure?.entries ?? {});
  const moduleCounts = new Map<string, number>();
  const processSignals = new Map<string, Array<string>>();
  for (const entry of structureEntries) {
    const normalizedPath = toForwardSlash(entry.path);
    const topLevel = normalizedPath.split("/")[0] ?? "";
    if (topLevel.startsWith("dcp-")) {
      moduleCounts.set(topLevel, (moduleCounts.get(topLevel) ?? 0) + 1);
    }
    const signalText = [
      normalizedPath,
      entry.packageName,
      entry.summary,
      ...entry.classes.map((item) => item.name),
      ...entry.methods.map((item) => item.name),
      ...entry.functions.map((item) => item.name)
    ]
      .filter(Boolean)
      .join(" ");
    if (/batch|job|scheduler|tasklet|step/i.test(signalText)) {
      const processKey = topLevel.startsWith("dcp-") ? topLevel : "batch-process";
      const items = processSignals.get(processKey) ?? [];
      items.push(signalText);
      processSignals.set(processKey, items);
    }
  }

  for (const [moduleName, count] of moduleCounts) {
    if (count < 20) {
      continue;
    }
    let kind: LearnedKnowledgeKind = "module-role";
    let label = moduleName;
    if (/batch/i.test(moduleName)) {
      kind = "process";
      label = "batch process";
    } else if (/gateway/i.test(moduleName)) {
      label = "gateway routing";
    } else if (/core/i.test(moduleName)) {
      label = "shared platform core";
    } else if (/async/i.test(moduleName)) {
      label = "async support";
    } else if (/display/i.test(moduleName)) {
      label = "display content";
    } else if (/upload/i.test(moduleName)) {
      label = "upload support";
    }
    upsert(
      createCandidate({
        id: `module:${slugify(moduleName)}`,
        kind,
        label,
        description: `${moduleName} module role learned from structure index`,
        tags: [slugify(moduleName), slugify(label)],
        aliases: [moduleName, label],
        apiPrefixes: [],
        screenPrefixes: [],
        controllerHints: [],
        serviceHints: [],
        pathHints: [moduleName],
        searchTerms: [moduleName, label],
        evidence: [`${moduleName} files=${count}`],
        counts: {
          links: 0,
          screens: 0,
          backend: count,
          eai: 0,
          uses: 0,
          successes: 0,
          failures: 0
        },
        firstSeenAt: options.generatedAt,
        lastSeenAt: options.generatedAt
      })
    );
  }

  for (const [processKey, signals] of processSignals) {
    if (signals.length < 5) {
      continue;
    }
    upsert(
      createCandidate({
        id: `process:${slugify(processKey)}`,
        kind: "process",
        label: humanizeIdentifier(processKey),
        description: `${processKey} process learned from batch/scheduler patterns`,
        tags: [slugify(processKey), "batch", "process"],
        aliases: [humanizeIdentifier(processKey), processKey],
        apiPrefixes: [],
        screenPrefixes: [],
        controllerHints: [],
        serviceHints: [],
        pathHints: [processKey],
        searchTerms: [processKey, "batch", "job", "scheduler", "tasklet"],
        evidence: takeTop(signals.map((signal) => signal.slice(0, 180)), 5),
        counts: {
          links: 0,
          screens: 0,
          backend: signals.length,
          eai: 0,
          uses: 0,
          successes: 0,
          failures: 0
        },
        firstSeenAt: options.generatedAt,
        lastSeenAt: options.generatedAt
      })
    );
  }

  const channelGroups = new Map<string, LearnedKnowledgeFrontBackLinkLike[]>();
  for (const link of graphLinks) {
    const channels = inferChannelCandidates([
      { value: link.frontend.routePath, source: "frontend" },
      { value: link.frontend.screenPath, source: "frontend" },
      { value: link.frontend.screenCode, source: "frontend" },
      { value: link.api.normalizedUrl, source: "api" },
      { value: link.api.rawUrl, source: "api" },
      { value: link.gateway.path, source: "backend" },
      { value: link.backend.path, source: "backend" },
      { value: link.backend.controllerMethod, source: "backend" }
    ]);
    for (const channel of channels) {
      const items = channelGroups.get(channel) ?? [];
      items.push(link);
      channelGroups.set(channel, items);
    }
  }

  for (const [channel, links] of channelGroups) {
    if (links.length < 2) {
      continue;
    }
    const apiPrefixes = takeTop(
      links.map((link) => deriveApiCluster(link.api.normalizedUrl)).filter((item): item is string => Boolean(item)),
      4
    );
    const screenPrefixes = takeTop(
      links.map((link) => extractScreenPrefix(link.frontend.screenCode)).filter((item): item is string => Boolean(item)),
      6
    );
    const controllerHints = takeTop(links.map((link) => extractControllerClass(link.backend.controllerMethod)), 6);
    const serviceHints = takeTop(links.flatMap((link) => link.backend.serviceHints.map(extractServiceClass)), 6);
    const uniqueScreens = new Set(links.map((link) => link.frontend.screenCode).filter(Boolean));
    const uniqueBackends = new Set(links.map((link) => link.backend.path).filter(Boolean));
    upsert(
      createCandidate({
        id: `channel:${slugify(channel)}`,
        kind: "channel",
        label: `${humanizeIdentifier(channel)} channel`,
        description: `${channel} related channel learned from frontend routes and backend APIs`,
        tags: [channel, "channel"],
        aliases: [humanizeIdentifier(channel), channel],
        apiPrefixes,
        screenPrefixes,
        controllerHints,
        serviceHints,
        pathHints: takeTop(links.map((link) => link.backend.filePath.split("/")[0] ?? link.backend.filePath), 4),
        searchTerms: takeTop(
          [
            channel,
            ...apiPrefixes,
            ...screenPrefixes,
            ...controllerHints,
            ...serviceHints,
            ...links.map((link) => link.api.normalizedUrl)
          ],
          12
        ),
        evidence: takeTop(
          links.map((link) => `${link.frontend.screenCode ?? link.frontend.routePath ?? "(unknown)"} -> ${link.api.rawUrl}`),
          5
        ),
        counts: {
          links: links.length,
          screens: uniqueScreens.size,
          backend: uniqueBackends.size,
          eai: 0,
          uses: 0,
          successes: 0,
          failures: 0
        },
        firstSeenAt: options.generatedAt,
        lastSeenAt: options.generatedAt
      })
    );
  }

  const result = Array.from(candidates.values())
    .map(normalizeCandidate)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id.localeCompare(b.id)));

  return {
    version: 1,
    generatedAt: options.generatedAt,
    candidates: result,
    summary: summarize(result)
  };
}

function scoreCandidateMatch(question: string, candidate: LearnedKnowledgeCandidate): { score: number; reasons: string[] } {
  const tokens = tokenize(question);
  const haystacks = [
    candidate.label,
    ...candidate.aliases,
    ...candidate.tags,
    ...candidate.apiPrefixes,
    ...candidate.screenPrefixes,
    ...candidate.controllerHints,
    ...candidate.serviceHints,
    ...candidate.pathHints
  ].map((item) => item.toLowerCase());

  let score = candidate.status === "validated" ? 16 : candidate.status === "candidate" ? 4 : -6;
  const reasons: string[] = [];
  for (const haystack of haystacks) {
    for (const token of tokens) {
      if (token.length < 2) {
        continue;
      }
      if (haystack.includes(token)) {
        score += token.length >= 5 ? 18 : 8;
        reasons.push(`token:${token}`);
      }
    }
  }
  for (const alias of candidate.aliases) {
    if (alias && question.toLowerCase().includes(alias.toLowerCase())) {
      score += 24;
      reasons.push(`alias:${alias}`);
    }
  }
  return {
    score,
    reasons: takeTop(reasons, 8)
  };
}

function collectCandidateOntologySignals(candidate: LearnedKnowledgeCandidate): string[] {
  return extractOntologyTextSignalsFromTexts([
    candidate.id,
    candidate.label,
    candidate.description,
    ...candidate.aliases,
    ...candidate.tags,
    ...candidate.apiPrefixes,
    ...candidate.screenPrefixes,
    ...candidate.controllerHints,
    ...candidate.serviceHints,
    ...candidate.pathHints,
    ...candidate.searchTerms,
    ...candidate.evidence
  ]);
}

export function matchLearnedKnowledge(
  question: string,
  snapshot?: LearnedKnowledgeSnapshot,
  limit = 6,
  questionSignals?: string[]
): LearnedKnowledgeMatch[] {
  if (!snapshot) {
    return [];
  }
  const normalizedQuestionSignals = questionSignals ?? extractOntologyTextSignalsFromTexts([question]);
  const specificQuestionSignals = extractSpecificOntologySignals(normalizedQuestionSignals);
  return snapshot.candidates
    .map((candidate) => {
      const matched = scoreCandidateMatch(question, candidate);
      const candidateSignals = collectCandidateOntologySignals(candidate);
      const alignment = scoreOntologySignalAlignment(normalizedQuestionSignals, candidateSignals, {
        question,
        pathText: candidate.pathHints.join(" "),
        apiText: candidate.apiPrefixes.join(" "),
        methodText: [...candidate.controllerHints, ...candidate.serviceHints].join(" ")
      });
      let score = matched.score + Math.round(candidate.score / 8) + alignment.score;
      const reasons = [...matched.reasons, ...alignment.reasons];
      const hasDirectLexicalMatch = matched.reasons.some((reason) => reason.startsWith("token:") || reason.startsWith("alias:"));
      if (
        specificQuestionSignals.length > 0 &&
        !hasDirectLexicalMatch &&
        !specificQuestionSignals.some((signal) => candidateSignals.includes(signal))
      ) {
        score -= 40;
        reasons.push("specific-signal-mismatch");
      }
      return {
        id: candidate.id,
        kind: candidate.kind,
        status: candidate.status,
        label: candidate.label,
        score,
        reasons: takeTop(reasons, 8),
        searchTerms: takeTop(
          [
            ...candidate.apiPrefixes,
            ...candidate.screenPrefixes,
            ...candidate.controllerHints,
            ...candidate.serviceHints,
            ...candidate.aliases,
            ...candidate.pathHints
          ],
          10
        )
      } satisfies LearnedKnowledgeMatch;
    })
    .filter((item) => item.score >= 24)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id.localeCompare(b.id)))
    .slice(0, limit);
}

export function extractLearnedKnowledgeTagsFromTexts(
  values: Array<string | undefined>,
  snapshot?: LearnedKnowledgeSnapshot
): string[] {
  if (!snapshot) {
    return [];
  }
  const joined = values.filter(Boolean).join("\n");
  if (!joined) {
    return [];
  }
  const normalized = joined.toLowerCase();
  const direct = snapshot.candidates
    .filter((candidate) => candidate.status !== "stale")
    .filter((candidate) =>
      [
        candidate.id,
        candidate.label,
        ...candidate.aliases,
        ...candidate.tags,
        ...candidate.apiPrefixes,
        ...candidate.screenPrefixes,
        ...candidate.controllerHints,
        ...candidate.serviceHints,
        ...candidate.pathHints
      ].some((term) => term && normalized.includes(term.toLowerCase()))
    )
    .map((candidate) => candidate.id);
  return unique([
    ...direct,
    ...matchLearnedKnowledge(joined, snapshot, 8, extractOntologyTextSignalsFromTexts([joined]))
      .filter((item) => item.status !== "stale")
      .map((item) => item.id)
  ]);
}

export function applyLearnedKnowledgeObservation(options: {
  snapshot: LearnedKnowledgeSnapshot;
  matchedCandidateIds: string[];
  successful: boolean;
  question?: string;
}): LearnedKnowledgeSnapshot {
  const now = new Date().toISOString();
  const matched = new Set(options.matchedCandidateIds);
  const nextCandidates = options.snapshot.candidates.map((candidate) => {
    if (!matched.has(candidate.id)) {
      return candidate;
    }
    const questionTerms = options.question ? tokenize(options.question).filter((token) => token.length >= 3) : [];
    return normalizeCandidate({
      ...candidate,
      aliases: [...candidate.aliases, ...questionTerms],
      searchTerms: [...candidate.searchTerms, ...questionTerms],
      counts: {
        ...candidate.counts,
        uses: candidate.counts.uses + 1,
        successes: candidate.counts.successes + (options.successful ? 1 : 0),
        failures: candidate.counts.failures + (options.successful ? 0 : 1)
      },
      lastSeenAt: now
    });
  });
  return {
    version: 1,
    generatedAt: now,
    candidates: nextCandidates.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id.localeCompare(b.id))),
    summary: summarize(nextCandidates)
  };
}

export function applyLearnedKnowledgePromotionActions(options: {
  snapshot: LearnedKnowledgeSnapshot;
  generatedAt: string;
  actions: LearnedKnowledgePromotionAction[];
}): LearnedKnowledgeSnapshot {
  const actionMap = new Map(options.actions.map((action) => [action.candidateId, action]));
  const nextCandidates = options.snapshot.candidates.map((candidate) => {
    const action = actionMap.get(candidate.id);
    if (!action) {
      return candidate;
    }

    const targetBoost =
      action.targetStatus === "validated"
        ? { uses: 2, successes: 2, failures: 0 }
        : action.targetStatus === "stale"
          ? { uses: 3, successes: 0, failures: 5 }
          : { uses: 1, successes: 0, failures: 0 };

    return normalizeCandidate({
      ...candidate,
      aliases: [...candidate.aliases, ...action.reasons],
      searchTerms: [...candidate.searchTerms, ...action.reasons],
      evidence: [...candidate.evidence, ...action.reasons.map((reason) => `promotion:${reason}`)],
      counts: {
        ...candidate.counts,
        uses: candidate.counts.uses + targetBoost.uses,
        successes: candidate.counts.successes + targetBoost.successes,
        failures: candidate.counts.failures + targetBoost.failures
      },
      lastSeenAt: options.generatedAt
    });
  });

  return {
    version: 1,
    generatedAt: options.generatedAt,
    candidates: nextCandidates.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id.localeCompare(b.id))),
    summary: summarize(nextCandidates)
  };
}

export function buildLearnedKnowledgeMarkdown(snapshot: LearnedKnowledgeSnapshot): string {
  const lines: string[] = [];
  lines.push("# Learned Knowledge");
  lines.push("");
  lines.push(`- generatedAt: ${snapshot.generatedAt}`);
  lines.push(`- candidateCount: ${snapshot.summary.candidateCount}`);
  lines.push(`- validatedCount: ${snapshot.summary.validatedCount}`);
  lines.push(`- staleCount: ${snapshot.summary.staleCount}`);
  lines.push(`- kinds: domain=${snapshot.summary.domainCount}, module-role=${snapshot.summary.moduleRoleCount}, process=${snapshot.summary.processCount}, channel=${snapshot.summary.channelCount}`);
  lines.push("");
  lines.push("## Top Candidates");
  for (const candidate of snapshot.candidates.slice(0, 20)) {
    lines.push(
      `- ${candidate.label} (${candidate.id}) | kind=${candidate.kind} | status=${candidate.status} | score=${candidate.score} | links=${candidate.counts.links} | uses=${candidate.counts.uses} | searchTerms=${candidate.searchTerms.slice(0, 6).join(", ") || "-"}`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
