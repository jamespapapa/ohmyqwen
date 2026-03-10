const CLAIM_CAPABILITY_FAMILY = [
  "benefit-claim",
  "accident-benefit-claim",
  "agent-benefit-claim",
  "diff-benefit-claim"
] as const;

const ADJACENT_NON_CLAIM_CAPABILITIES = ["division-expiry", "application-retraction"] as const;

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
    tag: "claim-doc",
    patterns: [/claim\/doc/i, /doc\/insert/i, /spotsave/i, /서류/i, /문서/i, /첨부/i, /upload/i, /file/i]
  },
  {
    tag: "claim-submit",
    patterns: [/claim\/insert/i, /보험금\s*청구서\s*등록/i, /접수/i, /제출/i, /submit/i, /regClaimInfo/i]
  },
  {
    tag: "claim-inquiry",
    patterns: [/claim\/inqury/i, /claim\/check/i, /spotload/i, /조회/i, /checkApply/i, /targetInfoReis/i]
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

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function joinTexts(values: Array<string | undefined>): string {
  return values.filter((value): value is string => Boolean(value && value.trim())).join("\n");
}

export function isCrossLayerFlowQuestion(question: string): boolean {
  return /(프론트|frontend|화면|버튼|vue|screen|ui|api|gateway)/i.test(question) && /(백엔드|backend|service|controller|route|흐름|trace|추적|거쳐)/i.test(question);
}

export function extractFlowCapabilityTagsFromTexts(values: Array<string | undefined>): string[] {
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
  return unique(tags);
}

export function extractQuestionCapabilityTags(question: string): string[] {
  const tags = extractFlowCapabilityTagsFromTexts([question]);
  return tags;
}

export function expandCapabilitySearchTerms(questionTags: string[]): string[] {
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

  return unique(terms);
}

function hasAny(tags: Set<string>, values: readonly string[]): boolean {
  return values.some((value) => tags.has(value));
}

export function scoreFlowCapabilityAlignment(questionTags: string[], linkTags: string[]): {
  score: number;
  reasons: string[];
} {
  const questionSet = new Set(questionTags);
  const linkSet = new Set(linkTags);
  const reasons: string[] = [];
  let score = 0;

  for (const tag of questionSet) {
    if (linkSet.has(tag)) {
      score += 55;
      reasons.push(`capability:${tag}`);
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
    if (linkSet.has("claim-doc")) {
      score += 18;
      reasons.push("capability:claim-doc");
    }
    if (linkSet.has("claim-submit")) {
      score += 14;
      reasons.push("capability:claim-submit");
    }
    if (linkSet.has("claim-inquiry")) {
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

  return {
    score,
    reasons: unique(reasons)
  };
}

export function hasStrongFlowCapabilityAlignment(questionTags: string[], linkTags: string[]): boolean {
  const alignment = scoreFlowCapabilityAlignment(questionTags, linkTags);
  if (alignment.score >= 40) {
    return true;
  }

  const questionSet = new Set(questionTags);
  const linkSet = new Set(linkTags);
  if (questionSet.has("benefit-claim") && hasAny(linkSet, CLAIM_CAPABILITY_FAMILY)) {
    return true;
  }
  return questionTags.some((tag) => linkSet.has(tag));
}
