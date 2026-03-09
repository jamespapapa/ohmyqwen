import { buildQmdQueryCandidates } from "./qmd-planner.js";

export type QmdCorpusId = "backend-code" | "frontend-code" | "config-xml" | "docs-memory";

interface QmdPlannerSignals {
  task: string;
  targetFiles?: string[];
  diffSummary?: string[];
  errorLogs?: string[];
  verifyFeedback?: string[];
}

export interface QmdCorpusDefinition {
  id: QmdCorpusId;
  mask: string;
  collectionSuffix: string;
  baseWeight: number;
}

export interface PlannedQmdCorpus {
  id: QmdCorpusId;
  mask: string;
  collectionSuffix: string;
  weight: number;
}

const CORPUS_DEFINITIONS: QmdCorpusDefinition[] = [
  {
    id: "backend-code",
    mask: "**/*.{java,kt,kts,py,go,rs,sql,sh,js,jsx,ts,tsx,mjs,cjs}",
    collectionSuffix: "backend-code",
    baseWeight: 0.72
  },
  {
    id: "frontend-code",
    mask: "**/*.{js,jsx,ts,tsx,mjs,cjs,vue,jsp,html,css,scss,sass}",
    collectionSuffix: "frontend-code",
    baseWeight: 0.56
  },
  {
    id: "config-xml",
    mask: "**/*.{xml,yml,yaml,properties,sql}",
    collectionSuffix: "config-xml",
    baseWeight: 0.42
  },
  {
    id: "docs-memory",
    mask: "**/*.{md,json,txt}",
    collectionSuffix: "docs-memory",
    baseWeight: 0.08
  }
];

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function tokenize(value: string): string[] {
  return unique(value.match(/[A-Za-z0-9가-힣._/-]+/g) ?? []);
}

function detectSignals(task: string, targetFiles: string[] = []): Record<string, boolean> {
  const combined = `${task} ${targetFiles.join(" ")}`;
  return {
    frontend: /(프론트|frontend|ui|화면|버튼|클릭|컴포넌트|component|vue|react|browser|jsp|page|form|submit|validation|fetch)/i.test(combined),
    backend: /(백엔드|backend|controller|service|mapper|dao|repository|api|endpoint|spring|mybatis|redis|oracle|java|트랜잭션)/i.test(combined),
    config: /(xml|yml|yaml|properties|config|설정|eai|인터페이스|requestsystemid|systemid|mapper)/i.test(combined),
    docs: /(문서|docs|readme|memory|analysis|summary|요약)/i.test(combined),
    logic: /(로직|흐름|실행|호출|검증|처리|오케스트레이션|call|flow|logic|validation)/i.test(combined),
    symbol: /[A-Z][A-Za-z0-9]+(Service|Controller|Mapper|Repository|Client)|\b[A-Z][0-9A-Z]{8}\b/.test(combined)
  };
}

function adjustWeight(id: QmdCorpusId, signals: Record<string, boolean>): number {
  let weight = CORPUS_DEFINITIONS.find((entry) => entry.id === id)?.baseWeight ?? 0;

  if (signals.frontend && id === "frontend-code") {
    weight += 0.48;
  }
  if (signals.frontend && signals.logic && id === "backend-code") {
    weight += 0.12;
  }
  if (signals.backend && id === "backend-code") {
    weight += 0.38;
  }
  if (signals.backend && signals.frontend && id === "frontend-code") {
    weight += 0.12;
  }
  if (signals.config && id === "config-xml") {
    weight += 0.56;
  }
  if (signals.config && id === "backend-code") {
    weight += 0.06;
  }
  if (signals.docs && id === "docs-memory") {
    weight += 0.28;
  }
  if (signals.logic && id === "backend-code") {
    weight += 0.08;
  }
  if (signals.logic && signals.frontend && id === "frontend-code") {
    weight += 0.16;
  }
  if (signals.symbol && id === "backend-code") {
    weight += 0.18;
  }
  if ((signals.logic || signals.symbol || signals.backend || signals.frontend) && id === "docs-memory") {
    weight = Math.min(weight, 0.1);
  }

  return Math.max(0.01, Math.min(1.4, Number(weight.toFixed(3))));
}

export function planQmdCorpusSearch(signals: QmdPlannerSignals): {
  corpora: PlannedQmdCorpus[];
  activeCorpora: PlannedQmdCorpus[];
} {
  const detected = detectSignals(signals.task, signals.targetFiles ?? []);
  const corpora = CORPUS_DEFINITIONS.map((definition) => ({
    id: definition.id,
    mask: definition.mask,
    collectionSuffix: definition.collectionSuffix,
    weight: adjustWeight(definition.id, detected)
  })).sort((a, b) => (b.weight !== a.weight ? b.weight - a.weight : a.id.localeCompare(b.id)));

  const activeCorpora = corpora.filter((entry, index) => entry.weight >= 0.12 || index === 0).slice(0, 3);
  return { corpora, activeCorpora };
}

export function buildQmdCorpusQueryCandidates(corpusId: QmdCorpusId, signals: QmdPlannerSignals): string[] {
  const base = buildQmdQueryCandidates(signals);
  const tokens = tokenize(signals.task).slice(0, 10).join(" ");

  const hintsByCorpus: Record<QmdCorpusId, string[]> = {
    "backend-code": ["controller service", "api endpoint", "mapper dao"],
    "frontend-code": ["component page", "button form", "api fetch"],
    "config-xml": ["xml eai", "mapper xml", "requestSystemId config"],
    "docs-memory": ["summary analysis", "readme notes"]
  };

  const shaped = hintsByCorpus[corpusId].map((hint) => `${tokens} ${hint}`.trim());
  const prioritized = corpusId === "backend-code" ? [...base, ...shaped] : [...shaped, ...base];
  const mentionsBackendTerms = /(controller|service|mapper|dao|repository|backend|spring)/i.test(signals.task);
  const candidates = unique(prioritized)
    .filter(Boolean)
    .filter((query) => {
      if (corpusId === "frontend-code" && !mentionsBackendTerms) {
        return !/controller service|mapper dao/i.test(query);
      }
      if (corpusId === "config-xml" && !mentionsBackendTerms) {
        return !/controller service/i.test(query);
      }
      return true;
    });

  return candidates.slice(0, 8);
}

export function getQmdCorpusDefinitions(): QmdCorpusDefinition[] {
  return [...CORPUS_DEFINITIONS];
}
