import { promises as fs } from "node:fs";
import path from "node:path";

const MAX_FILE_SIZE_BYTES = 512 * 1024;
const DEFAULT_MAX_ENTRIES = 5_000;
const DEFAULT_MAX_SEARCHABLE_FILES = 8_000;
const CODE_EXTENSIONS = new Set([".java", ".kt", ".kts"]);
const MODULE_PATH_PATTERN = /^dcp-[^/]+\//i;
const CONTROL_FLOW_NAMES = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "throw",
  "new",
  "case",
  "do",
  "else",
  "try",
  "super",
  "this"
]);

export interface EaiJavaCallSite {
  path: string;
  className?: string;
  methodName?: string;
  direct: boolean;
}

export interface EaiDictionaryEntry {
  interfaceId: string;
  interfaceName: string;
  purpose: string;
  sourcePath: string;
  envPaths: string[];
  usagePaths: string[];
  moduleUsagePaths: string[];
  reqSystemIds: string[];
  respSystemId?: string;
  targetType?: string;
  parameterName?: string;
  serviceId?: string;
  javaCallSites: EaiJavaCallSite[];
}

export interface EaiDictionaryProgress {
  phase: "searchable-content" | "entry-build";
  processed: number;
  total: number;
  currentFile?: string;
}

export interface BuildEaiDictionaryEntriesOptions {
  workspaceDir: string;
  files: string[];
  servicePathIncludes?: string[];
  maxEntries?: number;
  maxSearchableFiles?: number;
  onProgress?: (progress: EaiDictionaryProgress) => Promise<void> | void;
}

interface ParsedServiceDefinition {
  interfaceId: string;
  interfaceName: string;
  purpose: string;
  sourcePath: string;
  envPaths: string[];
  reqSystemIds: string[];
  respSystemId?: string;
  targetType?: string;
  parameterName?: string;
  serviceId?: string;
}

interface SearchableSource {
  path: string;
  content: string;
}

interface JavaMethodBlock {
  className?: string;
  methodName: string;
  startLine: number;
  endLine: number;
  snippet: string;
  directIds: string[];
  callNames: string[];
}

function toForwardSlash(value: string): string {
  return value.replace(/\\/g, "/");
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function parseXmlTag(content: string, tagName: string): string | undefined {
  const matched = content.match(new RegExp(`<${tagName}>\\s*([^<]+?)\\s*<\\/${tagName}>`, "i"));
  return matched?.[1]?.trim();
}

function parseXmlTags(content: string, tagName: string): string[] {
  const regex = new RegExp(`<${tagName}>\\s*([^<]+?)\\s*<\\/${tagName}>`, "gi");
  const values: string[] = [];
  for (const match of content.matchAll(regex)) {
    const value = match[1]?.trim();
    if (value) {
      values.push(value);
    }
  }
  return unique(values);
}

function inferEaiPurpose(content: string): string {
  const candidates = [
    parseXmlTag(content, "serviceDescription"),
    parseXmlTag(content, "description"),
    parseXmlTag(content, "serviceDesc"),
    parseXmlTag(content, "serviceName"),
    parseXmlTag(content, "interfaceDesc")
  ].filter(Boolean) as string[];

  return candidates[0] ?? "purpose-not-found";
}

function isBaseServicePath(relativePath: string): boolean {
  return /(^|\/)resources\/eai\/io\//i.test(relativePath);
}

function isEnvServicePath(relativePath: string): boolean {
  return /(^|\/)resources\/eai\/env\//i.test(relativePath);
}

function isCodePath(relativePath: string): boolean {
  return CODE_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

function isModuleCodePath(relativePath: string): boolean {
  return MODULE_PATH_PATTERN.test(relativePath) && isCodePath(relativePath);
}

function searchableSourcePriority(relativePath: string): number {
  if (isModuleCodePath(relativePath)) {
    return 0;
  }
  if (isCodePath(relativePath)) {
    return 1;
  }
  if (isBaseServicePath(relativePath) || isEnvServicePath(relativePath)) {
    return 3;
  }
  return 2;
}

function selectSearchableSourceFiles(files: string[], maxSearchableFiles: number): string[] {
  return [...files]
    .map((file) => toForwardSlash(file))
    .sort((a, b) => {
      const priorityDiff = searchableSourcePriority(a) - searchableSourcePriority(b);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return a.localeCompare(b);
    })
    .slice(0, Math.max(1, maxSearchableFiles));
}

async function readTextFileSafe(filePath: string): Promise<string | undefined> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return undefined;
  }

  if (!stat.isFile() || stat.size > MAX_FILE_SIZE_BYTES) {
    return undefined;
  }

  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function countBraceDelta(input: string): number {
  let delta = 0;
  for (const char of input) {
    if (char === "{") {
      delta += 1;
    } else if (char === "}") {
      delta -= 1;
    }
  }
  return delta;
}

function shouldStartMethodSignature(trimmedLine: string): boolean {
  if (!trimmedLine || trimmedLine.startsWith("@") || trimmedLine.startsWith("//") || trimmedLine.startsWith("*")) {
    return false;
  }
  if (!trimmedLine.includes("(") || trimmedLine.includes("=>")) {
    return false;
  }
  const openParenIndex = trimmedLine.indexOf("(");
  const prefix = trimmedLine.slice(0, openParenIndex).trim();
  if (!prefix || prefix.includes("=")) {
    return false;
  }
  const lastToken = prefix.split(/\s+/).pop()?.trim();
  if (!lastToken || CONTROL_FLOW_NAMES.has(lastToken)) {
    return false;
  }
  return true;
}

function parseMethodName(signature: string): string | undefined {
  const normalized = signature.replace(/\s+/g, " ").trim();
  const openParenIndex = normalized.indexOf("(");
  if (openParenIndex < 0) {
    return undefined;
  }
  const prefix = normalized.slice(0, openParenIndex).trim();
  if (!prefix || prefix.includes("=")) {
    return undefined;
  }
  const name = prefix.split(/\s+/).pop()?.trim();
  if (!name || CONTROL_FLOW_NAMES.has(name)) {
    return undefined;
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return undefined;
  }
  return name;
}

function extractPotentialInterfaceIds(text: string, knownInterfaceIds: Set<string>): string[] {
  const matches = new Set<string>();
  for (const match of text.matchAll(/\b([A-Z][0-9A-Z]{8})\b/g)) {
    const interfaceId = match[1];
    if (interfaceId && knownInterfaceIds.has(interfaceId)) {
      matches.add(interfaceId);
    }
  }
  for (const match of text.matchAll(/\bcall([A-Z][0-9A-Z]{8})(?:[A-Z0-9_]*)\s*\(/g)) {
    const interfaceId = match[1];
    if (interfaceId && knownInterfaceIds.has(interfaceId)) {
      matches.add(interfaceId);
    }
  }
  return Array.from(matches);
}

function extractMethodCalls(snippet: string, methodName: string): string[] {
  const calls = new Set<string>();
  for (const match of snippet.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const name = match[1];
    if (!name || CONTROL_FLOW_NAMES.has(name) || name === methodName) {
      continue;
    }
    calls.add(name);
  }
  return Array.from(calls);
}

function extractJavaMethodBlocks(content: string, knownInterfaceIds: Set<string>): JavaMethodBlock[] {
  const lines = content.split(/\r?\n/);
  const methods: JavaMethodBlock[] = [];
  let className: string | undefined;
  let pendingSignatureLines: string[] = [];
  let pendingStartLine = 0;
  let activeMethod:
    | {
        methodName: string;
        className?: string;
        startLine: number;
        lines: string[];
        braceDepth: number;
      }
    | undefined;

  const finalizeActiveMethod = () => {
    if (!activeMethod) {
      return;
    }
    const snippet = activeMethod.lines.join("\n");
    methods.push({
      className: activeMethod.className,
      methodName: activeMethod.methodName,
      startLine: activeMethod.startLine,
      endLine: activeMethod.startLine + activeMethod.lines.length - 1,
      snippet,
      directIds: extractPotentialInterfaceIds(snippet, knownInterfaceIds),
      callNames: extractMethodCalls(snippet, activeMethod.methodName)
    });
    activeMethod = undefined;
  };

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    const classMatch = line.match(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (classMatch?.[1]) {
      className = classMatch[1];
    }

    if (activeMethod) {
      activeMethod.lines.push(line);
      activeMethod.braceDepth += countBraceDelta(line);
      if (activeMethod.braceDepth <= 0) {
        finalizeActiveMethod();
      }
      continue;
    }

    if (pendingSignatureLines.length > 0) {
      pendingSignatureLines.push(line);
      if (line.includes("{")) {
        const signature = pendingSignatureLines.join("\n");
        const methodName = parseMethodName(signature);
        if (methodName) {
          activeMethod = {
            methodName,
            className,
            startLine: pendingStartLine,
            lines: [...pendingSignatureLines],
            braceDepth: countBraceDelta(signature)
          };
          pendingSignatureLines = [];
          if (activeMethod.braceDepth <= 0) {
            finalizeActiveMethod();
          }
        } else {
          pendingSignatureLines = [];
        }
      } else if (trimmed.endsWith(";")) {
        pendingSignatureLines = [];
      }
      continue;
    }

    if (!shouldStartMethodSignature(trimmed)) {
      continue;
    }

    pendingSignatureLines = [line];
    pendingStartLine = index + 1;
    if (line.includes("{")) {
      const signature = pendingSignatureLines.join("\n");
      const methodName = parseMethodName(signature);
      if (methodName) {
        activeMethod = {
          methodName,
          className,
          startLine: pendingStartLine,
          lines: [...pendingSignatureLines],
          braceDepth: countBraceDelta(signature)
        };
      }
      pendingSignatureLines = [];
      if (activeMethod && activeMethod.braceDepth <= 0) {
        finalizeActiveMethod();
      }
    }
  }

  finalizeActiveMethod();
  return methods;
}

function enrichMethodBlocksWithIndirectIds(blocks: JavaMethodBlock[]): JavaMethodBlock[] {
  const idsByMethod = new Map<string, Set<string>>();
  const callsByMethod = new Map<string, string[]>();

  for (const block of blocks) {
    idsByMethod.set(block.methodName, new Set(block.directIds));
    callsByMethod.set(block.methodName, block.callNames);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const block of blocks) {
      const target = idsByMethod.get(block.methodName);
      if (!target) {
        continue;
      }
      for (const callName of callsByMethod.get(block.methodName) ?? []) {
        const source = idsByMethod.get(callName);
        if (!source) {
          continue;
        }
        for (const interfaceId of source) {
          if (!target.has(interfaceId)) {
            target.add(interfaceId);
            changed = true;
          }
        }
      }
    }
  }

  return blocks.map((block) => ({
    ...block,
    directIds: Array.from(idsByMethod.get(block.methodName) ?? [])
  }));
}

function rankSummaryScore(entry: EaiDictionaryEntry): number {
  let score = entry.moduleUsagePaths.length * 24;
  score += entry.javaCallSites.length * 18;
  score += entry.usagePaths.length * 3;
  if (entry.sourcePath.includes("resources/eai/io/")) {
    score += 8;
  }
  return score;
}

export function rankEaiDictionaryEntriesForSummary(
  entries: EaiDictionaryEntry[],
  limit = 20
): EaiDictionaryEntry[] {
  return [...entries]
    .sort((a, b) => {
      const scoreDiff = rankSummaryScore(b) - rankSummaryScore(a);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return a.interfaceId.localeCompare(b.interfaceId);
    })
    .slice(0, limit);
}

export async function buildEaiDictionaryEntries(
  options: BuildEaiDictionaryEntriesOptions
): Promise<EaiDictionaryEntry[]> {
  const includes = (options.servicePathIncludes ?? ["resources/eai/"]).map((entry) =>
    toForwardSlash(entry).toLowerCase()
  );
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const serviceFiles = options.files
    .map((file) => toForwardSlash(file))
    .filter((file) => {
      const lower = file.toLowerCase();
      if (!/(^|\/).+_service\.xml$/i.test(file)) {
        return false;
      }
      return includes.length === 0 ? true : includes.some((entry) => lower.includes(entry));
    });

  if (serviceFiles.length === 0) {
    return [];
  }

  const serviceMap = new Map<string, ParsedServiceDefinition>();
  for (let index = 0; index < serviceFiles.length; index += 1) {
    const relativePath = serviceFiles[index] as string;
    const absolutePath = path.resolve(options.workspaceDir, relativePath);
    const content = await readTextFileSafe(absolutePath);
    if (!content) {
      if (options.onProgress && (index + 1) % 100 === 0) {
        await options.onProgress({
          phase: "entry-build",
          processed: index + 1,
          total: serviceFiles.length,
          currentFile: relativePath
        });
      }
      continue;
    }

    const interfaceId = parseXmlTag(content, "layoutId") ?? path.basename(relativePath).replace(/_service\.xml$/i, "");
    const parsed: ParsedServiceDefinition = {
      interfaceId,
      interfaceName: parseXmlTag(content, "serviceName") ?? interfaceId,
      purpose: inferEaiPurpose(content),
      sourcePath: relativePath,
      envPaths: [],
      reqSystemIds: parseXmlTags(content, "reqSystemId"),
      respSystemId: parseXmlTag(content, "respSystemId"),
      targetType: parseXmlTag(content, "targetType"),
      parameterName: parseXmlTag(content, "parameterName"),
      serviceId: parseXmlTag(content, "serviceId")
    };

    const existing = serviceMap.get(interfaceId);
    if (!existing) {
      if (isEnvServicePath(relativePath)) {
        parsed.envPaths = [relativePath];
      }
      serviceMap.set(interfaceId, parsed);
    } else {
      existing.reqSystemIds = unique([...existing.reqSystemIds, ...parsed.reqSystemIds]);
      existing.respSystemId = existing.respSystemId ?? parsed.respSystemId;
      existing.targetType = existing.targetType ?? parsed.targetType;
      existing.parameterName = existing.parameterName ?? parsed.parameterName;
      existing.serviceId = existing.serviceId ?? parsed.serviceId;
      if (isBaseServicePath(relativePath) && !isBaseServicePath(existing.sourcePath)) {
        if (existing.sourcePath !== relativePath) {
          existing.envPaths = unique([...existing.envPaths, existing.sourcePath]);
        }
        existing.sourcePath = relativePath;
        existing.interfaceName = parsed.interfaceName || existing.interfaceName;
        existing.purpose = parsed.purpose || existing.purpose;
      } else if (isEnvServicePath(relativePath) || relativePath !== existing.sourcePath) {
        existing.envPaths = unique([...existing.envPaths, relativePath]);
      }
    }

    if (options.onProgress && (index + 1) % 100 === 0) {
      await options.onProgress({
        phase: "entry-build",
        processed: index + 1,
        total: serviceFiles.length,
        currentFile: relativePath
      });
    }
  }
  await options.onProgress?.({
    phase: "entry-build",
    processed: serviceFiles.length,
    total: serviceFiles.length,
    currentFile: "service-definition-scan-finished"
  });

  const entries = Array.from(serviceMap.values())
    .sort((a, b) => a.interfaceId.localeCompare(b.interfaceId))
    .slice(0, maxEntries)
    .map<EaiDictionaryEntry>((entry) => ({
      interfaceId: entry.interfaceId,
      interfaceName: entry.interfaceName,
      purpose: entry.purpose,
      sourcePath: entry.sourcePath,
      envPaths: unique(entry.envPaths),
      usagePaths: [],
      moduleUsagePaths: [],
      reqSystemIds: unique(entry.reqSystemIds),
      respSystemId: entry.respSystemId,
      targetType: entry.targetType,
      parameterName: entry.parameterName,
      serviceId: entry.serviceId,
      javaCallSites: []
    }));

  const entryById = new Map(entries.map((entry) => [entry.interfaceId, entry]));
  const knownInterfaceIds = new Set(entries.map((entry) => entry.interfaceId));
  const searchableSourceFiles = selectSearchableSourceFiles(
    options.files,
    options.maxSearchableFiles ?? DEFAULT_MAX_SEARCHABLE_FILES
  );
  const searchableContents: SearchableSource[] = [];

  for (let index = 0; index < searchableSourceFiles.length; index += 1) {
    const relativePath = toForwardSlash(searchableSourceFiles[index] as string);
    const absolutePath = path.resolve(options.workspaceDir, relativePath);
    const content = await readTextFileSafe(absolutePath);
    if (content) {
      searchableContents.push({
        path: relativePath,
        content
      });
    }
    if (options.onProgress && (index + 1) % 100 === 0) {
      await options.onProgress({
        phase: "searchable-content",
        processed: index + 1,
        total: searchableSourceFiles.length,
        currentFile: relativePath
      });
    }
  }
  await options.onProgress?.({
    phase: "searchable-content",
    processed: searchableSourceFiles.length,
    total: searchableSourceFiles.length,
    currentFile: "searchable-content-finished"
  });

  for (const source of searchableContents) {
    const ext = path.extname(source.path).toLowerCase();
    const matchedIds = extractPotentialInterfaceIds(source.content, knownInterfaceIds);
    if (matchedIds.length === 0) {
      continue;
    }

    for (const interfaceId of matchedIds) {
      const entry = entryById.get(interfaceId);
      if (!entry || source.path === entry.sourcePath || entry.envPaths.includes(source.path)) {
        continue;
      }
      entry.usagePaths = unique([...entry.usagePaths, source.path]).slice(0, 24);
      if (isModuleCodePath(source.path)) {
        entry.moduleUsagePaths = unique([...entry.moduleUsagePaths, source.path]).slice(0, 24);
      }
    }

    if (!CODE_EXTENSIONS.has(ext)) {
      continue;
    }

    const methodBlocks = enrichMethodBlocksWithIndirectIds(extractJavaMethodBlocks(source.content, knownInterfaceIds));
    for (const block of methodBlocks) {
      for (const interfaceId of block.directIds) {
        const entry = entryById.get(interfaceId);
        if (!entry) {
          continue;
        }
        entry.javaCallSites = [
          ...entry.javaCallSites,
          {
            path: source.path,
            className: block.className,
            methodName: block.methodName,
            direct:
              block.snippet.includes(interfaceId) || new RegExp(`\\bcall${interfaceId}(?:[A-Z0-9_]*)\\s*\\(`).test(block.snippet)
          }
        ]
          .filter(
            (site, index, all) =>
              all.findIndex(
                (candidate) =>
                  candidate.path === site.path &&
                  candidate.className === site.className &&
                  candidate.methodName === site.methodName
              ) === index
          )
          .slice(0, 24);
      }
    }
  }

  return entries;
}
