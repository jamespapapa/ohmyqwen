import { createHash } from "node:crypto";
import { z } from "zod";

export const OntologyInputKindSchema = z.enum(["note", "structured", "csv"]);
export const OntologyInputScopeSchema = z.enum([
  "general",
  "domain",
  "subdomain",
  "channel",
  "action",
  "module-role",
  "process-role",
  "boundary",
  "path"
]);

const OntologyCsvRowSchema = z.record(z.string(), z.string());

export const OntologyInputArtifactSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  generatedAt: z.string().min(1),
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  kind: OntologyInputKindSchema,
  scope: OntologyInputScopeSchema,
  title: z.string().min(1),
  message: z.string().default(""),
  tags: z.array(z.string().min(1)).default([]),
  positiveExamples: z.array(z.string().min(1)).default([]),
  negativeExamples: z.array(z.string().min(1)).default([]),
  boundaryNotes: z.array(z.string().min(1)).default([]),
  relatedNodeIds: z.array(z.string().min(1)).default([]),
  relatedEdgeIds: z.array(z.string().min(1)).default([]),
  relatedPathIds: z.array(z.string().min(1)).default([]),
  relatedKnowledgeIds: z.array(z.string().min(1)).default([]),
  csvHeaders: z.array(z.string().min(1)).default([]),
  csvRows: z.array(OntologyCsvRowSchema).default([]),
  normalizedTerms: z.array(z.string().min(1)).default([]),
  notes: z.string().default("")
});

const OntologyInputSummarySchema = z.object({
  totalInputs: z.number().int().min(0),
  noteCount: z.number().int().min(0),
  structuredCount: z.number().int().min(0),
  csvCount: z.number().int().min(0),
  csvRowCount: z.number().int().min(0),
  scopeCounts: z.record(z.string(), z.number().int().min(0)),
  relatedNodeCount: z.number().int().min(0),
  relatedEdgeCount: z.number().int().min(0),
  relatedPathCount: z.number().int().min(0),
  relatedKnowledgeCount: z.number().int().min(0),
  topScopes: z.array(z.object({ scope: z.string().min(1), count: z.number().int().min(0) })),
  topTags: z.array(z.object({ tag: z.string().min(1), count: z.number().int().min(0) }))
});

export const OntologyInputSummarySnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  summary: OntologyInputSummarySchema,
  recentInputs: z.array(OntologyInputArtifactSchema).default([])
});

export type OntologyInputArtifact = z.infer<typeof OntologyInputArtifactSchema>;
export type OntologyInputSummarySnapshot = z.infer<typeof OntologyInputSummarySnapshotSchema>;

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function countBy(values: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries(Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}

function topCounts<T extends string>(values: T[], limit = 10, label: "scope" | "tag" = "scope") {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([entry, count]) => (label === "scope" ? { scope: entry, count } : { tag: entry, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : String(a[label]).localeCompare(String(b[label]))))
    .slice(0, limit);
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

export function parseOntologyCsvText(input: string): { headers: string[]; rows: Array<Record<string, string>> } {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  const pushCell = () => {
    currentRow.push(currentCell.trim());
    currentCell = "";
  };
  const pushRow = () => {
    const normalized = currentRow.map((cell) => cell.trim());
    if (normalized.some((cell) => cell.length > 0)) {
      rows.push(normalized);
    }
    currentRow = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    const next = input[index + 1] ?? "";

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentCell += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === ",") {
      pushCell();
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      pushCell();
      pushRow();
      continue;
    }

    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    pushCell();
    pushRow();
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  const [headerRow, ...valueRows] = rows;
  const headers = unique(
    headerRow.map((cell, index) => {
      const normalized = cell.trim();
      return normalized || `column_${index + 1}`;
    })
  );

  const mappedRows = valueRows
    .map((row) => {
      const values: Record<string, string> = {};
      headers.forEach((header, index) => {
        values[header] = (row[index] ?? "").trim();
      });
      return values;
    })
    .filter((row) => Object.values(row).some((value) => value.length > 0));

  return {
    headers,
    rows: mappedRows
  };
}

function deriveArtifactId(input: {
  projectId: string;
  kind: string;
  scope: string;
  title: string;
  generatedAt: string;
}): string {
  const digest = createHash("sha1")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 12);
  return `ontology-input:${input.kind}:${digest}`;
}

function deriveNormalizedTerms(input: {
  title: string;
  message?: string;
  tags?: string[];
  positiveExamples?: string[];
  negativeExamples?: string[];
  boundaryNotes?: string[];
  csvHeaders?: string[];
  csvRows?: Array<Record<string, string>>;
}): string[] {
  const expandedTags = (input.tags ?? []).flatMap((tag) => {
    const colonIndex = tag.indexOf(":");
    if (colonIndex < 0) {
      return [tag];
    }
    return [tag, tag.slice(colonIndex + 1)];
  });
  const values = [
    input.title,
    input.message ?? "",
    ...expandedTags,
    ...(input.positiveExamples ?? []),
    ...(input.negativeExamples ?? []),
    ...(input.boundaryNotes ?? []),
    ...(input.csvHeaders ?? []),
    ...((input.csvRows ?? []).flatMap((row) => Object.values(row)))
  ];
  return unique(values.flatMap((value) => tokenize(value)));
}

export function deriveOntologyInputMetadata(input: Pick<OntologyInputArtifact, "scope" | "tags">): {
  domains: string[];
  subdomains: string[];
  channels: string[];
  actions: string[];
  moduleRoles: string[];
  processRoles: string[];
} {
  const tags = unique(input.tags);
  const prefixed = {
    domains: tags.filter((tag) => tag.startsWith("domain:")).map((tag) => tag.slice("domain:".length)),
    subdomains: tags.filter((tag) => tag.startsWith("subdomain:")).map((tag) => tag.slice("subdomain:".length)),
    channels: tags.filter((tag) => tag.startsWith("channel:")).map((tag) => tag.slice("channel:".length)),
    actions: tags.filter((tag) => tag.startsWith("action:")).map((tag) => tag.slice("action:".length)),
    moduleRoles: tags.filter((tag) => tag.startsWith("module-role:")).map((tag) => tag.slice("module-role:".length)),
    processRoles: tags.filter((tag) => tag.startsWith("process-role:")).map((tag) => tag.slice("process-role:".length))
  };

  if (prefixed.domains.length > 0 || prefixed.subdomains.length > 0 || prefixed.channels.length > 0 || prefixed.actions.length > 0 || prefixed.moduleRoles.length > 0 || prefixed.processRoles.length > 0) {
    return prefixed;
  }

  switch (input.scope) {
    case "domain":
      return { ...prefixed, domains: tags };
    case "subdomain":
      return { ...prefixed, subdomains: tags };
    case "channel":
      return { ...prefixed, channels: tags };
    case "action":
      return { ...prefixed, actions: tags };
    case "module-role":
      return { ...prefixed, moduleRoles: tags };
    case "process-role":
      return { ...prefixed, processRoles: tags };
    default:
      return prefixed;
  }
}

export function buildOntologyInputArtifact(input: {
  generatedAt: string;
  projectId: string;
  projectName: string;
  kind: "note" | "structured" | "csv";
  scope: z.infer<typeof OntologyInputScopeSchema>;
  title: string;
  message?: string;
  tags?: string[];
  positiveExamples?: string[];
  negativeExamples?: string[];
  boundaryNotes?: string[];
  relatedNodeIds?: string[];
  relatedEdgeIds?: string[];
  relatedPathIds?: string[];
  relatedKnowledgeIds?: string[];
  csvText?: string;
  notes?: string;
}): OntologyInputArtifact {
  const parsedCsv = input.kind === "csv" ? parseOntologyCsvText(input.csvText ?? "") : { headers: [], rows: [] };
  const artifact = {
    version: 1 as const,
    id: deriveArtifactId({
      projectId: input.projectId,
      kind: input.kind,
      scope: input.scope,
      title: input.title.trim(),
      generatedAt: input.generatedAt
    }),
    generatedAt: input.generatedAt,
    projectId: input.projectId,
    projectName: input.projectName,
    kind: input.kind,
    scope: input.scope,
    title: input.title.trim(),
    message: String(input.message ?? "").trim(),
    tags: unique(input.tags ?? []),
    positiveExamples: unique(input.positiveExamples ?? []),
    negativeExamples: unique(input.negativeExamples ?? []),
    boundaryNotes: unique(input.boundaryNotes ?? []),
    relatedNodeIds: unique(input.relatedNodeIds ?? []),
    relatedEdgeIds: unique(input.relatedEdgeIds ?? []),
    relatedPathIds: unique(input.relatedPathIds ?? []),
    relatedKnowledgeIds: unique(input.relatedKnowledgeIds ?? []),
    csvHeaders: parsedCsv.headers,
    csvRows: parsedCsv.rows,
    normalizedTerms: deriveNormalizedTerms({
      title: input.title,
      message: input.message,
      tags: input.tags,
      positiveExamples: input.positiveExamples,
      negativeExamples: input.negativeExamples,
      boundaryNotes: input.boundaryNotes,
      csvHeaders: parsedCsv.headers,
      csvRows: parsedCsv.rows
    }),
    notes: String(input.notes ?? "").trim()
  };
  return OntologyInputArtifactSchema.parse(artifact);
}

export function buildOntologyInputMarkdown(artifact: OntologyInputArtifact): string {
  const lines = [
    "# Ontology Input",
    "",
    `- id: ${artifact.id}`,
    `- generatedAt: ${artifact.generatedAt}`,
    `- kind: ${artifact.kind}`,
    `- scope: ${artifact.scope}`,
    `- title: ${artifact.title}`,
    `- tags: ${artifact.tags.join(", ") || "-"}`,
    `- relatedNodeIds: ${artifact.relatedNodeIds.join(", ") || "-"}`,
    `- relatedEdgeIds: ${artifact.relatedEdgeIds.join(", ") || "-"}`,
    `- relatedPathIds: ${artifact.relatedPathIds.join(", ") || "-"}`,
    `- csvRows: ${artifact.csvRows.length}`,
    `- notes: ${artifact.notes || "-"}`,
    "",
    "## Message",
    artifact.message || "-",
    "",
    "## Positive Examples",
    ...(artifact.positiveExamples.length > 0 ? artifact.positiveExamples.map((entry) => `- ${entry}`) : ["- (none)"]),
    "",
    "## Negative Examples",
    ...(artifact.negativeExamples.length > 0 ? artifact.negativeExamples.map((entry) => `- ${entry}`) : ["- (none)"]),
    "",
    "## Boundary Notes",
    ...(artifact.boundaryNotes.length > 0 ? artifact.boundaryNotes.map((entry) => `- ${entry}`) : ["- (none)"]),
    ""
  ];
  return `${lines.join("\n")}\n`;
}

export function buildOntologyInputSummarySnapshot(options: {
  generatedAt: string;
  artifacts: OntologyInputArtifact[];
  limit?: number;
}): OntologyInputSummarySnapshot {
  const artifacts = options.artifacts
    .map((artifact) => OntologyInputArtifactSchema.parse(artifact))
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .slice(0, options.limit ?? 120);

  return OntologyInputSummarySnapshotSchema.parse({
    version: 1,
    generatedAt: options.generatedAt,
    summary: {
      totalInputs: artifacts.length,
      noteCount: artifacts.filter((artifact) => artifact.kind === "note").length,
      structuredCount: artifacts.filter((artifact) => artifact.kind === "structured").length,
      csvCount: artifacts.filter((artifact) => artifact.kind === "csv").length,
      csvRowCount: artifacts.reduce((sum, artifact) => sum + artifact.csvRows.length, 0),
      scopeCounts: countBy(artifacts.map((artifact) => artifact.scope)),
      relatedNodeCount: unique(artifacts.flatMap((artifact) => artifact.relatedNodeIds)).length,
      relatedEdgeCount: unique(artifacts.flatMap((artifact) => artifact.relatedEdgeIds)).length,
      relatedPathCount: unique(artifacts.flatMap((artifact) => artifact.relatedPathIds)).length,
      relatedKnowledgeCount: unique(artifacts.flatMap((artifact) => artifact.relatedKnowledgeIds)).length,
      topScopes: topCounts(artifacts.map((artifact) => artifact.scope), 8, "scope"),
      topTags: topCounts(artifacts.flatMap((artifact) => artifact.tags), 12, "tag")
    },
    recentInputs: artifacts.slice(0, 12)
  });
}

export function buildOntologyInputSummaryMarkdown(snapshot: OntologyInputSummarySnapshot): string {
  const lines = [
    "# Ontology Input Summary",
    "",
    `- totalInputs: ${snapshot.summary.totalInputs}`,
    `- noteCount: ${snapshot.summary.noteCount}`,
    `- structuredCount: ${snapshot.summary.structuredCount}`,
    `- csvCount: ${snapshot.summary.csvCount}`,
    `- csvRowCount: ${snapshot.summary.csvRowCount}`,
    `- relatedNodeCount: ${snapshot.summary.relatedNodeCount}`,
    `- relatedEdgeCount: ${snapshot.summary.relatedEdgeCount}`,
    `- relatedPathCount: ${snapshot.summary.relatedPathCount}`,
    `- relatedKnowledgeCount: ${snapshot.summary.relatedKnowledgeCount}`,
    "",
    "## Top Scopes"
  ];

  if (snapshot.summary.topScopes.length === 0) {
    lines.push("- (none)");
  } else {
    for (const entry of snapshot.summary.topScopes) {
      lines.push(`- ${entry.scope}: ${entry.count}`);
    }
  }

  lines.push("", "## Top Tags");
  if (snapshot.summary.topTags.length === 0) {
    lines.push("- (none)");
  } else {
    for (const entry of snapshot.summary.topTags) {
      lines.push(`- ${entry.tag}: ${entry.count}`);
    }
  }

  lines.push("", "## Recent Inputs");
  if (snapshot.recentInputs.length === 0) {
    lines.push("- (none)");
  } else {
    for (const artifact of snapshot.recentInputs) {
      lines.push(`- [${artifact.kind}/${artifact.scope}] ${artifact.title}`);
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}
