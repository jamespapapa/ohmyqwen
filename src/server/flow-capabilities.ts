import type { DomainPack, DomainPackCapability } from "./domain-packs.js";

const CLAIM_CAPABILITY_FAMILY = [
  "benefit-claim",
  "accident-benefit-claim",
  "agent-benefit-claim",
  "diff-benefit-claim"
] as const;

const ADJACENT_NON_CLAIM_CAPABILITIES = ["division-expiry", "application-retraction"] as const;

const ACTION_CAPABILITY_TAGS = [
  "action-doc",
  "action-submit",
  "action-check",
  "action-inquiry",
  "action-agreement",
  "action-account-register"
] as const;

const CAPABILITY_PATTERNS: Array<{ tag: string; patterns: RegExp[] }> = [
  {
    tag: "benefit-claim",
    patterns: [/보험금\s*청구/i, /benefit\s*claim/i, /\/benefit\/claim\b/i, /\bBenefitClaim\b/i]
  },
  {
    tag: "accident-benefit-claim",
    patterns: [/사고보험금/i, /accbenefit\/claim/i, /\bAccBenefitClaim\b/i]
  },
  {
    tag: "agent-benefit-claim",
    patterns: [/보험금\s*대리\s*청구/i, /대리보험금/i, /agentbenefit\/claim/i, /\bAgentBenefitClaim\b/i]
  },
  {
    tag: "diff-benefit-claim",
    patterns: [/사망보험금/i, /수익자\s*보험금\s*청구/i, /diffbenefit\/claim/i, /\bDiffBenefitClaim\b/i]
  },
  {
    tag: "loan",
    patterns: [/\/loan\//i, /\bLoanController\b/i, /\bLoanService\b/i]
  },
  {
    tag: "sunshine-loan",
    patterns: [/햇살론/i, /모바일햇살론/i, /sunshine\s*loan/i, /MYLOT0213/i]
  },
  {
    tag: "credit-low-worker-loan",
    patterns: [/credit\/low\/worker/i, /\bCreditLowWorkerLoanReauest\b/i, /MYLOT0213/i]
  },
  {
    tag: "action-doc",
    patterns: [/claim\/doc/i, /doc\/insert/i, /spotsave/i, /upload/i, /첨부/i, /agreement/i, /pdf/i, /document/i]
  },
  {
    tag: "action-submit",
    patterns: [/claim\/insert/i, /\/apply\b/i, /\/insert\b/i, /submit/i, /saveinput/i, /loanadmit/i, /requestloanmember/i]
  },
  {
    tag: "action-check",
    patterns: [/claim\/check/i, /checkapply/i, /checktime/i, /customer\/check/i, /\bvalidate/i]
  },
  {
    tag: "action-inquiry",
    patterns: [/claim\/inqury/i, /spotload/i, /select/i, /inqury/i, /inquiry/i, /getinput/i]
  },
  {
    tag: "action-agreement",
    patterns: [/owner\/agreement/i, /agreement/i, /약관동의/i, /동의서/i]
  },
  {
    tag: "action-account-register",
    patterns: [/insertaccntno/i, /getaccntno/i, /accnt/i, /계좌등록/i, /계좌조회/i]
  },
  {
    tag: "division-expiry",
    patterns: [/division\/appexpiry/i, /division\/expiry/i, /분할\/?만기/i, /만기보험금/i, /appexpiry/i]
  },
  {
    tag: "application-retraction",
    patterns: [/retraction/i, /청약철회/i]
  },
  {
    tag: "insurance-internet",
    patterns: [/insurance\/internet/i, /mysamsunglife\/insurance\/internet/i, /보험금청구\s*-/i]
  },
  {
    tag: "gateway-api",
    patterns: [/\/gw\/api\//i, /RouteController\.route/i, /gateway/i]
  }
];

function isActionCapabilityDefinition(capability: DomainPackCapability): boolean {
  return capability.kind === "action";
}

export function isActionCapabilityTag(tag: string): boolean {
  return (ACTION_CAPABILITY_TAGS as readonly string[]).includes(tag);
}

export interface FlowCapabilityOptions {
  domainPacks?: DomainPack[];
}

export interface FlowCapabilityScoreOptions extends FlowCapabilityOptions {
  question?: string;
  pathText?: string;
  apiText?: string;
  methodText?: string;
}

export interface DetectedDomainPackMatch {
  id: string;
  name: string;
  score: number;
  matchedTags: string[];
  reasons: string[];
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function joinTexts(values: Array<string | undefined>): string {
  return values.filter((value): value is string => Boolean(value && value.trim())).join("\n");
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

function extractDomainPackTagsFromText(text: string, domainPacks?: DomainPack[]): string[] {
  if (!text || !domainPacks || domainPacks.length === 0) {
    return [];
  }

  const tags: string[] = [];
  for (const domainPack of domainPacks) {
    for (const capability of domainPack.capabilityTags) {
      const rawPatterns = [
        capability.tag,
        ...(capability.aliases ?? []),
        ...(capability.questionPatterns ?? []),
        ...(capability.textPatterns ?? []),
        ...(capability.searchTerms ?? []),
        ...(capability.pathHints ?? []),
        ...(capability.symbolHints ?? []),
        ...(capability.apiHints ?? [])
      ];
      const patterns = rawPatterns.map(compilePattern).filter((value): value is RegExp => Boolean(value));
      if (patterns.some((pattern) => pattern.test(text))) {
        tags.push(capability.tag);
        if (!isActionCapabilityDefinition(capability)) {
          for (const parent of capability.parents ?? []) {
            tags.push(parent);
          }
        }
      }
    }
  }
  return unique(tags);
}

function expandDomainPackSearchTerms(questionTags: string[], domainPacks?: DomainPack[]): string[] {
  if (!domainPacks || domainPacks.length === 0) {
    return [];
  }

  const tagSet = new Set(questionTags);
  const terms: string[] = [];
  for (const domainPack of domainPacks) {
    for (const capability of domainPack.capabilityTags) {
      if (!tagSet.has(capability.tag) && !(capability.parents ?? []).some((parent) => tagSet.has(parent))) {
        continue;
      }
      terms.push(
        ...(capability.searchTerms ?? []),
        ...(capability.aliases ?? []),
        ...(capability.symbolHints ?? []),
        ...(capability.apiHints ?? [])
      );
    }
  }
  return unique(terms);
}

export function seedCapabilityTagsFromDomainPacks(domainPacks?: DomainPack[]): string[] {
  if (!domainPacks || domainPacks.length === 0) {
    return [];
  }

  const tags: string[] = [];
  for (const domainPack of domainPacks) {
    tags.push(domainPack.id);
    for (const capability of domainPack.capabilityTags) {
      if (capability.tag === domainPack.id || capability.kind === "domain") {
        tags.push(capability.tag);
      }
    }
  }
  return unique(tags);
}

export function resolveQuestionCapabilityTags(options: {
  question: string;
  domainPacks?: DomainPack[];
  pinnedDomainPacks?: DomainPack[];
}): string[] {
  return unique([
    ...extractQuestionCapabilityTags(options.question, {
      domainPacks: options.domainPacks
    }),
    ...seedCapabilityTagsFromDomainPacks(options.pinnedDomainPacks)
  ]);
}

function scoreDomainPackPriors(
  questionTags: string[],
  linkTags: string[],
  options?: FlowCapabilityScoreOptions
): { score: number; reasons: string[] } {
  if (!options?.domainPacks || options.domainPacks.length === 0) {
    return { score: 0, reasons: [] };
  }

  const questionSet = new Set(questionTags);
  const linkSet = new Set(linkTags);
  const pathText = options.pathText?.toLowerCase() ?? "";
  const apiText = options.apiText?.toLowerCase() ?? "";
  const methodText = options.methodText?.toLowerCase() ?? "";
  const scoreReasons: string[] = [];
  let score = 0;

  for (const domainPack of options.domainPacks) {
    for (const prior of domainPack.rankingPriors) {
      const whenQuestionHas = prior.whenQuestionHas ?? [];
      const whenLinkHas = prior.whenLinkHas ?? [];
      const whenPathMatches = prior.whenPathMatches ?? [];
      const whenApiMatches = prior.whenApiMatches ?? [];
      const whenMethodMatches = prior.whenMethodMatches ?? [];
      const questionMatched = whenQuestionHas.length === 0 || whenQuestionHas.some((tag) => questionSet.has(tag));
      const linkMatched = whenLinkHas.length === 0 || whenLinkHas.some((tag) => linkSet.has(tag));
      const pathMatched =
        whenPathMatches.length === 0 || whenPathMatches.some((pattern) => pathText.includes(pattern.toLowerCase()));
      const apiMatched =
        whenApiMatches.length === 0 || whenApiMatches.some((pattern) => apiText.includes(pattern.toLowerCase()));
      const methodMatched =
        whenMethodMatches.length === 0 ||
        whenMethodMatches.some((pattern) => methodText.includes(pattern.toLowerCase()));

      if (questionMatched && linkMatched && pathMatched && apiMatched && methodMatched) {
        score += prior.weight;
        scoreReasons.push(prior.reason);
      }
    }
  }

  return {
    score,
    reasons: unique(scoreReasons)
  };
}

export function isCrossLayerFlowQuestion(question: string): boolean {
  return /(프론트|frontend|화면|버튼|vue|screen|ui|api|gateway)/i.test(question) && /(백엔드|backend|service|controller|route|흐름|trace|추적|거쳐)/i.test(question);
}

export function extractFlowCapabilityTagsFromTexts(
  values: Array<string | undefined>,
  options?: FlowCapabilityOptions
): string[] {
  const text = joinTexts(values);
  if (!text) {
    return [];
  }

  const tags: string[] = [];
  for (const entry of CAPABILITY_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      tags.push(entry.tag);
    }
  }
  tags.push(...extractDomainPackTagsFromText(text, options?.domainPacks));
  return unique(tags);
}

export function extractQuestionCapabilityTags(question: string, options?: FlowCapabilityOptions): string[] {
  return extractFlowCapabilityTagsFromTexts([question], options);
}

export function expandCapabilitySearchTerms(questionTags: string[], options?: FlowCapabilityOptions): string[] {
  const terms: string[] = [];
  const tagSet = new Set(questionTags);

  if (tagSet.has("benefit-claim")) {
    terms.push(
      "BenefitClaim",
      "BenefitClaimController",
      "BenefitClaimService",
      "AccBenefitClaim",
      "AccBenefitClaimController",
      "AccBenefitClaimService",
      "보험금 청구"
    );
  }
  if (tagSet.has("accident-benefit-claim")) {
    terms.push("AccBenefitClaim", "사고보험금 청구", "/insurance/accBenefit/claim");
  }
  if (tagSet.has("agent-benefit-claim")) {
    terms.push("AgentBenefitClaim", "보험금 대리 청구", "/insurance/agentBenefit/claim");
  }
  if (tagSet.has("diff-benefit-claim")) {
    terms.push("DiffBenefitClaim", "수익자 보험금 청구", "/insurance/diffBenefit/claim");
  }
  if (tagSet.has("claim-doc")) {
    terms.push("saveBenefitClaimDoc", "claim doc insert", "서류 접수");
  }
  if (tagSet.has("claim-submit")) {
    terms.push("saveBenefitClaim", "claim insert", "보험금 청구 제출");
  }
  if (tagSet.has("claim-inquiry")) {
    terms.push("benefitClaimInqr", "checkApply", "claim inqury");
  }
  if (tagSet.has("division-expiry")) {
    terms.push("DivisionExp", "appexpiry", "분할 만기 보험금");
  }
  if (tagSet.has("application-retraction")) {
    terms.push("ApplicationRetraction", "retraction", "청약철회");
  }
  if (tagSet.has("loan")) {
    terms.push("Loan", "LoanController", "LoanService", "/loan/");
  }
  if (tagSet.has("sunshine-loan")) {
    terms.push(
      "햇살론",
      "모바일햇살론",
      "MYLOT0213",
      "CreditLowWorkerLoanReauestController",
      "CreditLowWorkerLoanReauestService",
      "/loan/credit/low/worker/request/"
    );
  }
  if (tagSet.has("credit-low-worker-loan")) {
    terms.push(
      "CreditLowWorkerLoanReauestController",
      "CreditLowWorkerLoanReauestService",
      "checktime",
      "selectCustInfo",
      "limitAmount",
      "requestLoanMember",
      "insertAccntNo",
      "loanAdmit",
      "make owner agreement",
      "apply"
    );
  }

  terms.push(...expandDomainPackSearchTerms(questionTags, options?.domainPacks));
  return unique(terms);
}

function hasAny(tags: Set<string>, values: readonly string[]): boolean {
  return values.some((value) => tags.has(value));
}

export function scoreFlowCapabilityAlignment(
  questionTags: string[],
  linkTags: string[],
  options?: FlowCapabilityScoreOptions
): {
  score: number;
  reasons: string[];
} {
  const questionSet = new Set(questionTags);
  const linkSet = new Set(linkTags);
  const reasons: string[] = [];
  let score = 0;

  for (const tag of questionSet) {
    if (linkSet.has(tag)) {
      if (isActionCapabilityTag(tag)) {
        score += 12;
        reasons.push(`action:${tag}`);
      } else {
        score += 55;
        reasons.push(`capability:${tag}`);
      }
    }
  }

  if (questionSet.has("benefit-claim")) {
    if (linkSet.has("accident-benefit-claim")) {
      score += 44;
      reasons.push("capability:benefit-claim-family");
    }
    if (linkSet.has("agent-benefit-claim")) {
      score += 24;
      reasons.push("capability:benefit-claim-family");
    }
    if (linkSet.has("diff-benefit-claim")) {
      score += 18;
      reasons.push("capability:benefit-claim-family");
    }
    if (linkSet.has("claim-doc") || linkSet.has("action-doc")) {
      score += 18;
      reasons.push("capability:claim-doc");
    }
    if (linkSet.has("claim-submit") || linkSet.has("action-submit")) {
      score += 14;
      reasons.push("capability:claim-submit");
    }
    if (linkSet.has("claim-inquiry") || linkSet.has("action-check") || linkSet.has("action-inquiry")) {
      score += 12;
      reasons.push("capability:claim-inquiry");
    }
    if (linkSet.has("insurance-internet")) {
      score += 12;
      reasons.push("capability:insurance-internet");
    }
    if (!questionSet.has("agent-benefit-claim") && linkSet.has("agent-benefit-claim")) {
      score -= 10;
      reasons.push("capability-penalty:agent-benefit-claim");
    }
    if (!questionSet.has("diff-benefit-claim") && linkSet.has("diff-benefit-claim")) {
      score -= 12;
      reasons.push("capability-penalty:diff-benefit-claim");
    }
    for (const adjacentTag of ADJACENT_NON_CLAIM_CAPABILITIES) {
      if (linkSet.has(adjacentTag) && !questionSet.has(adjacentTag)) {
        score -= 90;
        reasons.push(`capability-penalty:${adjacentTag}`);
      }
    }
  }

  if (questionSet.has("accident-benefit-claim") && linkSet.has("benefit-claim")) {
    score += 24;
    reasons.push("capability:accident-benefit-parent");
  }
  if (questionSet.has("agent-benefit-claim") && linkSet.has("benefit-claim")) {
    score += 22;
    reasons.push("capability:agent-benefit-parent");
  }
  if (questionSet.has("diff-benefit-claim") && linkSet.has("benefit-claim")) {
    score += 20;
    reasons.push("capability:diff-benefit-parent");
  }

  if (questionSet.has("division-expiry") && linkSet.has("benefit-claim") && !linkSet.has("division-expiry")) {
    score -= 48;
    reasons.push("capability-penalty:benefit-claim");
  }
  if (
    questionSet.has("application-retraction") &&
    hasAny(linkSet, CLAIM_CAPABILITY_FAMILY) &&
    !linkSet.has("application-retraction")
  ) {
    score -= 48;
    reasons.push("capability-penalty:benefit-claim");
  }

  if (questionSet.has("loan") && linkSet.has("benefit-claim") && !hasAny(linkSet, ["loan", "sunshine-loan", "credit-low-worker-loan"])) {
    score -= 72;
    reasons.push("capability-penalty:benefit-claim-on-loan");
  }
  if (questionSet.has("sunshine-loan")) {
    if (linkSet.has("sunshine-loan")) {
      score += 34;
      reasons.push("capability:sunshine-loan");
    }
    if (linkSet.has("credit-low-worker-loan")) {
      score += 42;
      reasons.push("capability:credit-low-worker-loan");
    }
    if (linkSet.has("loan")) {
      score += 18;
      reasons.push("capability:loan-parent");
    }
    if (linkSet.has("benefit-claim")) {
      score -= 80;
      reasons.push("capability-penalty:benefit-claim");
    }
  }

  const domainPackAlignment = scoreDomainPackPriors(questionTags, linkTags, options);
  score += domainPackAlignment.score;
  reasons.push(...domainPackAlignment.reasons);

  return {
    score,
    reasons: unique(reasons)
  };
}

export function hasStrongFlowCapabilityAlignment(
  questionTags: string[],
  linkTags: string[],
  options?: FlowCapabilityScoreOptions
): boolean {
  const alignment = scoreFlowCapabilityAlignment(questionTags, linkTags, options);
  if (alignment.score >= 40) {
    return true;
  }

  const questionSet = new Set(questionTags);
  const linkSet = new Set(linkTags);
  const nonActionQuestionTags = questionTags.filter((tag) => !isActionCapabilityTag(tag));
  if (nonActionQuestionTags.some((tag) => linkSet.has(tag))) {
    return true;
  }
  if (questionSet.has("benefit-claim") && hasAny(linkSet, CLAIM_CAPABILITY_FAMILY)) {
    return true;
  }
  if (questionSet.has("sunshine-loan") && (linkSet.has("sunshine-loan") || linkSet.has("credit-low-worker-loan"))) {
    return true;
  }
  return false;
}
