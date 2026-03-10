# NEXT STEP: Domain Answer Quality

Updated: 2026-03-10

## Current State

- Cross-layer ask retry loop is implemented.
  - Max attempts: 5
  - Early stop on:
    - no new evidence
    - low confidence gain
    - max attempts reached
- Deterministic cross-layer acceptance is now stricter.
  - Specific business capability mismatch lowers confidence.
  - Adjacent flow contamination can fail quality gates.
- `retire-pension` pack was expanded with subdomains:
  - `irp-join`
  - `irp-cancel`
  - `irp-participation-present-state`
  - `pension-change`
  - `retire-pension-content`
- Business-specific cross-layer gating was tightened so that:
  - broad domain match alone is not enough
  - specific subdomain evidence is required when the question is specific

## What Is Still Weak

Wide domain questions such as:

- `퇴직연금 관련 로직이 어떻게 구현되어 있는지 면밀히 분석해줘`

still tend to produce:

- architecture-heavy summaries
- mixed capability evidence
- display/content/certificate noise
- confidence that is still somewhat optimistic for partial coverage

This is not the same problem as the previous `IRP가입` false positive.

- `IRP가입` was mainly a **specific subdomain selection** failure.
- `퇴직연금 관련 로직` is now mainly a **domain overview decomposition** failure.

## Root Gaps

### 1. Domain decomposition is incomplete

The system can detect `retire-pension`, but it still does not reliably decompose the domain into:

- join
- cancel
- pension change
- contract/info
- payment/account
- certificate
- display/content

for overview-style answers.

### 2. Core business vs support/display roles are not separated enough

The current pipeline can still rank:

- display/content
- certificate
- shared/common utility

too close to:

- core business services

when the user asks for a wide domain overview.

### 3. Overview questions need a different answer shape

`architecture_overview` is too generic for broad business-domain questions.

What is missing is a dedicated strategy for:

- domain capability overview
- capability cluster summary
- core/shared/support separation

### 4. Confidence is not yet coverage-aware enough for broad domain answers

Confidence should account for:

- how many distinct sub-capabilities are covered
- whether core services are represented
- how much adjacent noise is present
- whether evidence is concentrated in display/content only

## Required Work

### Priority 1: Domain overview strategy

Add a dedicated strategy for broad business-domain questions, e.g.:

- `domain_capability_overview`

This strategy should:

- identify major capability clusters inside a domain
- select representative services/controllers/EAI per cluster
- build a structured overview instead of a single mixed narrative

### Priority 2: Evidence role classification

Introduce explicit evidence roles such as:

- `core-business`
- `shared-common`
- `display-content`
- `certificate`
- `gateway`
- `integration-eai`

Then use those roles in:

- ranking
- answer formatting
- quality gates
- confidence scoring

### Priority 3: Cluster-based quality gate

For broad domain questions, pass only if the answer covers enough distinct clusters.

Example expectations:

- at least 3 distinct business capability clusters
- at least 2 core-business services
- display/content only as supporting evidence
- adjacent noise ratio below threshold

### Priority 4: Coverage/noise-based confidence

Replace optimistic broad-answer confidence with a score that reflects:

- cluster coverage
- core-business density
- support/display dominance penalty
- unresolved downstream gaps

### Priority 5: Learned knowledge promotion quality

Strengthen candidate-to-validated promotion using:

- repeated successful use
- low adjacent-confuser overlap
- cluster consistency
- regression coverage

## Recommended Next Execution Order

1. Add `domain_capability_overview` strategy
2. Add evidence role classification
3. Add cluster-based answer builder for wide domain questions
4. Add cluster-based quality gate
5. Recalibrate confidence for overview answers
6. Add regression set for:
   - retire-pension overview
   - loan overview
   - member-auth overview
   - fund overview

## Current Policy

This work is intentionally deferred as `NEXT_STEP`.

Do not patch this by adding more question-specific `if/else` branches.
The next iteration must improve:

- capability decomposition
- evidence role modeling
- generic scoring/gating

not more one-off domain branching.
