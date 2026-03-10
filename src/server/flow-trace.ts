import { promises as fs } from "node:fs";
import path from "node:path";

interface StructureSymbolLike {
  name: string;
  className?: string;
}

interface StructureEntryLike {
  path: string;
  classes: Array<{ name: string }>;
  methods: StructureSymbolLike[];
  functions: StructureSymbolLike[];
}

interface StructureSnapshotLike {
  entries: Record<string, StructureEntryLike>;
}

interface LinkedFlowLike {
  apiUrl: string;
  backendControllerMethod: string;
  serviceHints: string[];
  capabilityTags?: string[];
}

export interface DownstreamFlowTrace {
  phase: "check" | "claim-insert" | "doc-insert" | "inquiry" | "other";
  apiUrl: string;
  backendControllerMethod: string;
  serviceMethod: string;
  filePath: string;
  steps: string[];
  evidence: string[];
  eaiInterfaces: string[];
}

const CALL_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "new",
  "throw",
  "super",
  "this",
  "try",
  "do",
  "else",
  "case",
  "synchronized"
]);

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function findMethodBlock(content: string, methodName: string): { startLine: number; endLine: number; snippet: string } | undefined {
  const methodPattern = new RegExp(`\\b${methodName}\\s*\\([^;{}]*\\)\\s*(?:throws [^{]+)?\\{`, "m");
  const match = methodPattern.exec(content);
  if (!match || typeof match.index !== "number") {
    return undefined;
  }

  const startIndex = match.index;
  const bodyStart = content.indexOf("{", startIndex);
  if (bodyStart < 0) {
    return undefined;
  }

  let depth = 0;
  let endIndex = -1;
  for (let index = bodyStart; index < content.length; index += 1) {
    const char = content[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        endIndex = index;
        break;
      }
    }
  }

  if (endIndex < 0) {
    return undefined;
  }

  const startLine = content.slice(0, startIndex).split("\n").length;
  const endLine = content.slice(0, endIndex).split("\n").length;
  return {
    startLine,
    endLine,
    snippet: content.slice(startIndex, endIndex + 1)
  };
}

function extractOrderedMethodCalls(snippet: string): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const match of snippet.matchAll(/(?<!\.)\b(?:this\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const name = match[1]?.trim();
    if (!name || CALL_KEYWORDS.has(name)) {
      continue;
    }
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    output.push(name);
  }
  return output;
}

function extractOwnedCalls(snippet: string): Array<{ owner: string; method: string }> {
  const output: Array<{ owner: string; method: string }> = [];
  const seen = new Set<string>();
  for (const match of snippet.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const owner = match[1]?.trim();
    const method = match[2]?.trim();
    if (!owner || !method || CALL_KEYWORDS.has(method)) {
      continue;
    }
    const key = `${owner}.${method}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push({ owner, method });
  }
  return output;
}

function findStructureEntryByClassName(structure: StructureSnapshotLike | undefined, className: string): StructureEntryLike | undefined {
  if (!structure) {
    return undefined;
  }
  const normalizedClass = className.toLowerCase();
  return Object.values(structure.entries).find((entry) =>
    entry.classes.some((klass) => klass.name.toLowerCase() === normalizedClass)
  );
}

function extractConstantStringMap(content: string): Map<string, string> {
  const constants = new Map<string, string>();
  for (const match of content.matchAll(/\b(?:private|protected|public)?\s*static\s+final\s+String\s+([A-Z0-9_]+)\s*=\s*"([^"]+)"/g)) {
    const name = match[1]?.trim();
    const value = match[2]?.trim();
    if (name && value) {
      constants.set(name, value);
    }
  }
  return constants;
}

function extractEaiInterfaceIds(snippet: string, constants: Map<string, string>): string[] {
  const interfaceIds: string[] = [];
  for (const match of snippet.matchAll(/\bcall(F[0-9A-Z]{6,})\b/g)) {
    interfaceIds.push(match[1] ?? "");
  }
  for (const match of snippet.matchAll(/\bString\s+layoutId\s*=\s*([A-Z0-9_"]+)\s*;/g)) {
    const raw = match[1]?.trim() ?? "";
    if (!raw) {
      continue;
    }
    if (raw.startsWith("\"") && raw.endsWith("\"")) {
      interfaceIds.push(raw.slice(1, -1));
      continue;
    }
    const constantValue = constants.get(raw);
    if (constantValue) {
      interfaceIds.push(constantValue);
    }
  }
  return unique(interfaceIds.filter((item) => /^F[0-9A-Z]{6,}$/i.test(item)));
}

function detectFlowPhase(apiUrl: string): DownstreamFlowTrace["phase"] {
  const normalized = apiUrl.toLowerCase();
  if (/\/doc\/insert/.test(normalized)) {
    return "doc-insert";
  }
  if (/\/claim\/check/.test(normalized)) {
    return "check";
  }
  if (/\/claim\/insert/.test(normalized)) {
    return "claim-insert";
  }
  if (/inqury|inquiry|check|load/.test(normalized)) {
    return "inquiry";
  }
  return "other";
}

function describeOwnedCall(owner: string, method: string): string | undefined {
  const lowerOwner = owner.toLowerCase();
  if (/redis/.test(lowerOwner)) {
    return `${owner}.${method}: Redis 상태 조회/정리`;
  }
  if (/dao|mapper|repository/.test(lowerOwner)) {
    return `${owner}.${method}: DB 이력/첨부파일 처리`;
  }
  if (/eai/.test(lowerOwner)) {
    return `${owner}.${method}: EAI 실행 계층 호출`;
  }
  if (/upload|file|pdf|image|convert/.test(lowerOwner)) {
    return `${owner}.${method}: 파일/문서 변환 처리`;
  }
  if (/service|support|helper|manager|client/.test(lowerOwner)) {
    return `${owner}.${method}: 하위 서비스 호출`;
  }
  return undefined;
}

function describeLocalCall(methodName: string, nestedSnippet: string | undefined, constants: Map<string, string>): string | undefined {
  if (/^callF[0-9A-Z]{6,}$/i.test(methodName)) {
    return `${methodName}: 청구 관련 EAI 전문 호출`;
  }
  if (methodName === "callMODC0008") {
    const ids = extractEaiInterfaceIds(nestedSnippet ?? "", constants);
    return `callMODC0008${ids.length > 0 ? ` -> ${ids.join(", ")}` : ""}: 동의서/청구서 문서변환 호출`;
  }
  if (methodName === "callMODC0010") {
    const ids = extractEaiInterfaceIds(nestedSnippet ?? "", constants);
    return `callMODC0010${ids.length > 0 ? ` -> ${ids.join(", ")}` : ""}: 업로드 이미지/PDF 변환 호출`;
  }
  if (methodName === "getRedisInfo") {
    return "getRedisInfo: Redis 세션/청구 진행상태 조회";
  }
  if (methodName === "selectClamDocument") {
    return "selectClamDocument: 기존 청구문서/최근 제출 이력 조회";
  }
  if (methodName === "saveClamDocument") {
    return "saveClamDocument: 청구 기본정보 DB insert/update";
  }
  if (methodName === "saveClamDocumentFile") {
    return "saveClamDocumentFile: 첨부파일 이력 DB 저장";
  }
  if (methodName === "updateSubmitdate") {
    return "updateSubmitdate: 제출일자/제출상태 갱신";
  }
  if (methodName === "moveConvertUploadFile") {
    return "moveConvertUploadFile: 업로드 파일 변환/NAS 이동";
  }
  if (methodName === "chkAccnNo") {
    return "chkAccnNo: 입금계좌 유효성 검증";
  }
  if (/^(check|select|save|insert|update|delete|send|make|move|get)[A-Z]/.test(methodName)) {
    return `${methodName}: 하위 업무 처리 단계`;
  }
  return undefined;
}

function shouldKeepLocalCall(methodName: string): boolean {
  return /^(callF[0-9A-Z]+|callMODC\d+|getRedisInfo|select|save|insert|update|delete|move|check|make|send)/.test(methodName);
}

function shouldKeepOwnedCall(owner: string, method: string): boolean {
  return /(redis|dao|mapper|repository|eai|upload|file|pdf|image|convert|service|support|helper|manager|client)/i.test(
    `${owner}.${method}`
  );
}

function selectRepresentativeFlows(flows: LinkedFlowLike[]): LinkedFlowLike[] {
  const chosen: LinkedFlowLike[] = [];
  const seenKeys = new Set<string>();
  const phases = ["check", "claim-insert", "doc-insert", "inquiry", "other"] as const;

  for (const phase of phases) {
    const match = flows.find((flow) => detectFlowPhase(flow.apiUrl) === phase);
    if (!match) {
      continue;
    }
    const key = `${match.apiUrl}|${match.backendControllerMethod}`;
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    chosen.push(match);
  }

  for (const flow of flows) {
    const key = `${flow.apiUrl}|${flow.backendControllerMethod}`;
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    chosen.push(flow);
    if (chosen.length >= 4) {
      break;
    }
  }

  return chosen.slice(0, 4);
}

function scoreServiceHintForPhase(serviceHint: string, phase: DownstreamFlowTrace["phase"]): number {
  const [className = "", methodName = ""] = serviceHint.split(".");
  const lowerClass = className.toLowerCase();
  const lowerMethod = methodName.toLowerCase();
  let score = 0;

  if (/claimservice|benefitclaimservice|accbenefitclaimservice/.test(lowerClass)) {
    score += 40;
  } else if (/service|manager|support|helper|client/.test(lowerClass)) {
    score += 15;
  }

  if (/redisdatasupport|redissessionsupport|rediscryptsessionsupport|eaiexecuteservice|eaicommonheaderservice/.test(lowerClass)) {
    score -= 30;
  }

  if (/save|insert|submit|proc|check|inqury|inquiry|doc/.test(lowerMethod)) {
    score += 24;
  }
  if (/sendlms|delete|get$|load|spot/.test(lowerMethod)) {
    score -= 12;
  }

  if (phase === "doc-insert" && /savebenefitclaimdoc|callf|callmodc/.test(lowerMethod)) {
    score += 30;
  }
  if (phase === "claim-insert" && /savebenefitclaim|chkaccnno/.test(lowerMethod)) {
    score += 24;
  }
  if (phase === "check" && /checkapply|chk|check/.test(lowerMethod)) {
    score += 24;
  }

  return score;
}

export async function traceLinkedFlowDownstream(options: {
  workspaceDir: string;
  linkedFlowEvidence: LinkedFlowLike[];
  structure?: StructureSnapshotLike;
}): Promise<DownstreamFlowTrace[]> {
  const representativeFlows = selectRepresentativeFlows(options.linkedFlowEvidence);
  const traces: DownstreamFlowTrace[] = [];
  const seenServiceMethods = new Set<string>();

  for (const flow of representativeFlows) {
    const phase = detectFlowPhase(flow.apiUrl);
    const rankedHints = [...flow.serviceHints].sort(
      (a, b) => scoreServiceHintForPhase(b, phase) - scoreServiceHintForPhase(a, phase)
    );
    for (const serviceHint of rankedHints) {
      if (seenServiceMethods.has(serviceHint)) {
        continue;
      }
      seenServiceMethods.add(serviceHint);

      const [className, methodName] = serviceHint.split(".");
      if (!className || !methodName) {
        continue;
      }

      const entry = findStructureEntryByClassName(options.structure, className);
      if (!entry) {
        continue;
      }

      const absolutePath = path.resolve(options.workspaceDir, entry.path);
      let content: string;
      try {
        content = await fs.readFile(absolutePath, "utf8");
      } catch {
        continue;
      }

      const block = findMethodBlock(content, methodName);
      if (!block) {
        continue;
      }

      const constants = extractConstantStringMap(content);
      const primarySteps: string[] = [];
      const secondarySteps: string[] = [];
      const evidence: string[] = [];
      const eaiInterfaces = new Set<string>();

      for (const eaiId of extractEaiInterfaceIds(block.snippet, constants)) {
        eaiInterfaces.add(eaiId);
      }

      const orderedCalls = extractOrderedMethodCalls(block.snippet).filter(
        (callName) => callName !== methodName && shouldKeepLocalCall(callName)
      );
      for (const callName of orderedCalls.slice(0, 12)) {
        const nested = findMethodBlock(content, callName);
        const description = describeLocalCall(callName, nested?.snippet, constants);
        if (description) {
          primarySteps.push(description);
        }
        if (nested) {
          evidence.push(`${entry.path}:${nested.startLine}-${nested.endLine} - ${callName}`);
          for (const eaiId of extractEaiInterfaceIds(nested.snippet, constants)) {
            eaiInterfaces.add(eaiId);
          }
          for (const owned of extractOwnedCalls(nested.snippet).filter((item) => shouldKeepOwnedCall(item.owner, item.method)).slice(0, 4)) {
            const ownedDescription = describeOwnedCall(owned.owner, owned.method);
            if (ownedDescription) {
              secondarySteps.push(`${callName} -> ${ownedDescription}`);
            }
          }
        }
      }

      for (const owned of extractOwnedCalls(block.snippet).filter((item) => shouldKeepOwnedCall(item.owner, item.method)).slice(0, 6)) {
        const ownedDescription = describeOwnedCall(owned.owner, owned.method);
        if (ownedDescription) {
          secondarySteps.push(ownedDescription);
        }
      }

      evidence.unshift(`${entry.path}:${block.startLine}-${block.endLine} - ${className}.${methodName}`);
      traces.push({
        phase,
        apiUrl: flow.apiUrl,
        backendControllerMethod: flow.backendControllerMethod,
        serviceMethod: `${className}.${methodName}`,
        filePath: entry.path,
        steps: unique([...primarySteps, ...secondarySteps]).slice(0, 8),
        evidence: unique(evidence).slice(0, 10),
        eaiInterfaces: Array.from(eaiInterfaces).slice(0, 6)
      });
    }
  }

  return traces;
}
