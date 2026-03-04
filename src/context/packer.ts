import { ContextTier, ContextTierSchema } from "../core/types.js";

export interface PackContextInput {
  objective: string;
  constraints: string[];
  symbols: string[];
  errorLogs: string[];
  diffSummary: string[];
  tier: ContextTier;
  tokenBudget?: number;
}

export interface PackedContext {
  tier: ContextTier;
  hardCapTokens: number;
  usedTokens: number;
  truncated: boolean;
  payload: {
    objective: string;
    constraints: string[];
    symbols: string[];
    recentErrors: string[];
    diffSummary: string[];
  };
}

const DEFAULT_BUDGET: Record<ContextTier, number> = {
  small: 700,
  mid: 1400,
  big: 2600
};

const HARD_CAP_MAX = 3000;

function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }

  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function trimByTokens(text: string, tokenBudget: number): { value: string; used: number; truncated: boolean } {
  const normalized = normalizeText(text);
  if (tokenBudget <= 0 || !normalized) {
    return { value: "", used: 0, truncated: Boolean(normalized) };
  }

  if (estimateTokens(normalized) <= tokenBudget) {
    return { value: normalized, used: estimateTokens(normalized), truncated: false };
  }

  let low = 0;
  let high = normalized.length;
  let best = "";

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${normalized.slice(0, mid).trim()}...`;
    const tokens = estimateTokens(candidate);

    if (tokens <= tokenBudget) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return {
    value: best,
    used: estimateTokens(best),
    truncated: true
  };
}

function packList(
  items: string[],
  tokenBudget: number,
  maxItems: number
): { values: string[]; used: number; truncated: boolean } {
  if (tokenBudget <= 0 || maxItems <= 0) {
    return { values: [], used: 0, truncated: items.length > 0 };
  }

  const selected: string[] = [];
  let used = 0;
  let truncated = false;

  for (const raw of items) {
    if (selected.length >= maxItems) {
      truncated = true;
      break;
    }

    const normalized = normalizeText(raw);
    if (!normalized) {
      continue;
    }

    const rest = tokenBudget - used;
    if (rest <= 0) {
      truncated = true;
      break;
    }

    const trimmed = trimByTokens(normalized, rest);
    if (!trimmed.value) {
      truncated = true;
      break;
    }

    selected.push(trimmed.value);
    used += trimmed.used;

    if (trimmed.truncated) {
      truncated = true;
      break;
    }
  }

  if (items.length > selected.length) {
    truncated = true;
  }

  return { values: selected, used, truncated };
}

export function packContext(input: PackContextInput): PackedContext {
  const tier = ContextTierSchema.parse(input.tier);
  const requestedBudget = input.tokenBudget ?? DEFAULT_BUDGET[tier];
  const hardCapTokens = Math.max(200, Math.min(requestedBudget, HARD_CAP_MAX));

  let usedTokens = 0;
  let truncated = false;

  const objectiveBudget = Math.max(40, Math.floor(hardCapTokens * 0.2));
  const constraintsBudget = Math.max(20, Math.floor(hardCapTokens * 0.1));
  const symbolsBudget = Math.max(40, Math.floor(hardCapTokens * 0.3));
  const errorsBudget = Math.max(40, Math.floor(hardCapTokens * 0.2));
  const diffBudget = Math.max(40, hardCapTokens - (objectiveBudget + constraintsBudget + symbolsBudget + errorsBudget));

  const objective = trimByTokens(input.objective, objectiveBudget);
  usedTokens += objective.used;
  truncated ||= objective.truncated;

  const constraints = packList(input.constraints, constraintsBudget, tier === "small" ? 4 : tier === "mid" ? 8 : 12);
  usedTokens += constraints.used;
  truncated ||= constraints.truncated;

  const symbols = packList(input.symbols, symbolsBudget, tier === "small" ? 20 : tier === "mid" ? 50 : 100);
  usedTokens += symbols.used;
  truncated ||= symbols.truncated;

  const recentErrors = packList(
    input.errorLogs,
    errorsBudget,
    tier === "small" ? 4 : tier === "mid" ? 8 : 16
  );
  usedTokens += recentErrors.used;
  truncated ||= recentErrors.truncated;

  const diffSummary = packList(
    input.diffSummary,
    diffBudget,
    tier === "small" ? 8 : tier === "mid" ? 16 : 30
  );
  usedTokens += diffSummary.used;
  truncated ||= diffSummary.truncated;

  return {
    tier,
    hardCapTokens,
    usedTokens: Math.min(usedTokens, hardCapTokens),
    truncated,
    payload: {
      objective: objective.value,
      constraints: constraints.values,
      symbols: symbols.values,
      recentErrors: recentErrors.values,
      diffSummary: diffSummary.values
    }
  };
}

export function renderPackedContext(context: PackedContext): string {
  return [
    `tier=${context.tier}`,
    `tokenCap=${context.hardCapTokens}`,
    `used=${context.usedTokens}`,
    `truncated=${context.truncated}`,
    `objective=${context.payload.objective}`,
    `constraints=${context.payload.constraints.join(" | ")}`,
    `symbols=${context.payload.symbols.join(", ")}`,
    `recentErrors=${context.payload.recentErrors.join(" | ")}`,
    `diffSummary=${context.payload.diffSummary.join(" | ")}`
  ].join("\n");
}
