# NEXT STEP: Ontology Harness, Governance, and Execution Readiness

Updated: 2026-03-19  
Baseline commit at write time: `d7967b4`

## Why this is the next step

The current system has already pushed the **code-only ontology seed** far enough that additional gains from blindly adding more extraction/scoring code are diminishing.

What is now missing is not just more nodes and edges, but a tighter loop around:

- what counts as a good answer,
- how regressions are detected,
- how ontology edits are evaluated,
- how draft/review/replay/self-eval connect,
- how answer generation is forced to stay aligned with canonical workflow/path evidence,
- how offline execution is validated before bundle/import.

In short:

- **Ontology seed extraction is no longer the main bottleneck.**
- **Evaluation harness / governance / semantic-layer promotion is the bottleneck.**

---

## Current state

### Already in place

- internal QMD runtime for offline use
- ontology graph / projections / viewer / fullscreen graph route
- structure index / front-back graph / EAI dictionary / learned knowledge
- retrieval units
- ontology draft / evaluation / revert
- canonical flow selection
- workflow-family grouping
- request/response contract propagation
- async / persistence / query transitions
- exact endpoint / ordered workflow question handling
- quality gate / replay / deterministic fallback
- structural component focus / code-structure densification
- exact-trace deterministic path for explicit endpoint/workflow questions

### What is still weak

The system can often gather **related APIs and related evidence**, but it still struggles with:

1. **single coherent representative workflow synthesis**
2. **stable acceptance criteria per question type**
3. **rich user-level answer formatting**
4. **regression visibility when ontology/planner changes**
5. **semantic distinctions that code alone does not settle**
6. **execution-readiness visibility for offline import/deployment**

Example failure shape:

- related APIs are gathered correctly,
- but the answer mixes adjacent workflow families,
- or explains the wrong representative anchor,
- or omits the exact sequence the user asked for,
- or passes locally but is missing an offline prerequisite.

This is now more of a **harness / governance / execution checklist problem** than a pure extractor problem.

---

## Practical assessment

### Code-only ontology seed

Current assessment:

- extractor / derivation completeness: **high**
- retrieval/path grounding baseline: **usable**
- answer quality stability: **not yet governed tightly enough**
- offline packaging path: **usable, but checklist-sensitive**

Interpretation:

- More code-only extraction can still help at the margin.
- But without stronger evaluation discipline, more rules will increasingly look like heuristic sprawl.
- The next phase must optimize for:
  - **control**
  - **repeatability**
  - **comparability**
  - **explicit quality contracts**
  - **offline preflight readiness**

---

## Today’s conclusions that must be preserved

### 1. MiroFish is a reference for UX, not architecture

The local reference clone under `references/MiroFish` is useful for:

- staged ontology generation/review UX
- graph interaction and detail panel ideas
- making ontology steps explicit to the user

It is **not** the architectural baseline for `ohmyqwen`.

Reasons:

- MiroFish uses **LLM-designed minimal ontology**
- MiroFish depends on **external Zep graph memory**
- MiroFish is optimized for **simulation/world modeling**, not offline code-grounded QA

Policy:

- borrow **UX / review flow ideas**
- do **not** replace code-grounded seed ontology with LLM-authored schema
- do **not** introduce external graph-memory dependency into the core runtime

### 2. AST/LSP direction is valid, but must stay controlled

For future extractor upgrades:

- **AST = primary extractor**
- **LSP = symbol-resolution / definition / reference aid**
- **config/resource parsers = gateway/proxy route stitching layer**

This is especially relevant for:

- frontend handler -> HTTP call extraction
- endpoint constant/wrapper resolution
- gateway route stitching
- controller/service exact method graph resolution

Policy:

- AST/LSP upgrades must feed the ontology as **hard evidence** first
- derived/semantic relations must stay layered on top
- avoid adding AST/LSP only to patch one question; use it only where it improves the general extractor base

### 3. Rich answers require workflow synthesis, not just retrieval

The current gap is not just finding files. It is:

- reconstructing **workflow sequence**
- selecting one **representative scenario**
- explaining API/action differences in user terms
- preserving exact target and ordered sequence contracts

This means the next quality gains come from:

- better answer contracts
- better canonical workflow artifacts
- stronger answer-shape standardization

not from adding more loosely-coupled retrieval heuristics.

---

## Primary goal

Build a **repeatable ontology QA + execution readiness harness** that makes it easy to:

1. run representative question suites,
2. compare before/after results,
3. score exact-target / workflow-sequence / cross-layer quality,
4. inspect why an answer passed or failed,
5. accept/reject ontology draft changes with rollback support,
6. verify offline execution prerequisites before bundle/import.

---

## Work items

## 1. Question-set harness

Create and formalize a reusable regression suite for ontology-driven QA.

### Requirements

- store representative questions as structured fixtures
- support:
  - broad overview
  - module role
  - process/batch trace
  - channel integration
  - state-store schema
  - exact endpoint trace
  - workflow sequence trace
- include expected:
  - question type
  - required target terms
  - forbidden unrelated terms
  - required evidence classes
  - confidence ceiling/floor rules

### Desired outcome

The system should be able to say:

- this answer improved
- this answer regressed
- this answer changed only in phrasing
- this answer violated an exact-target contract

---

## 2. Acceptance contract per question type

Current quality gates exist, but the contracts are still spread across code and are not easy to inspect or tune as a unit.

### Requirements

Define explicit acceptance contracts for each question type:

- `domain_capability_overview`
- `module_role_explanation`
- `process_or_batch_trace`
- `channel_or_partner_integration`
- `state_store_schema`
- `cross_layer_flow`
- `symbol_deep_trace`

### Each contract should define

- minimum direct evidence
- required answer structure
- required target preservation
- contamination tolerance
- confidence cap rules
- abstain/fail conditions

### Desired outcome

When a question fails, it should fail for a **clear contract reason**, not just because an implicit heuristic happened to trigger.

---

## 3. Canonical workflow synthesis harness

Current canonical path logic is useful but still hard to inspect as a standalone artifact.

### Requirements

Add inspection artifacts for:

- representative workflow anchor
- workflow-family candidates
- dropped incoherent flows
- exact-target alignment
- sequence coverage
- missing steps

### Desired outcome

Before answer generation, the system should already expose:

- which workflow it thinks is primary
- which steps it believes belong to the sequence
- which adjacent flows were intentionally excluded

This is essential for debugging user-visible failures.

---

## 4. Draft/review/self-eval integration

Draft ontology edits already exist, but the next step is to connect them directly to the question harness.

### Requirements

- evaluate draft changes against the representative question suite
- compute:
  - improved answers
  - regressed answers
  - newly contaminated answers
  - newly fixed exact-target traces
- keep revert friction low

### Desired outcome

An ontology edit should be answerable with:

- what changed in the graph,
- which questions got better,
- which got worse,
- whether the draft is safe to keep.

---

## 5. Ontology governance cleanup

This is the guardrail against heuristic sprawl.

### Requirements

Document and progressively separate:

- extractor rules
- derivation rules
- ranking rules
- gate rules
- output-selection rules

Also freeze the current ontology core:

- node types
- edge types
- action/state concepts
- workflow-family semantics

### Desired outcome

The system should evolve by changing:

- ontology semantics,
- evaluation criteria,
- and explicit policy,

not by accumulating opaque scoring branches.

---

## 6. AST/LSP/config upgrade decision record

This is not a mandate to rewrite the extractor immediately. It is a controlled decision point.

### Requirements

- identify the highest-value extractor gaps where regex/lightweight parsing is no longer enough
- define a narrow AST/LSP target list:
  - frontend HTTP wrapper resolution
  - Vue/TS handler-to-call graph
  - gateway config stitcher
  - backend exact method resolution where current parsing is weak
- maintain confidence layering:
  - hard
  - derived
  - semantic

### Desired outcome

AST/LSP adoption, if done, should be:

- targeted,
- measurable,
- extractor-first,
- and justified by harness failures.

---

## 7. User-facing answer shape

Current answers are often still evidence-heavy and user-light.

### Requirements

For workflow questions, answer shape should be standardized:

1. representative E2E summary
2. step-by-step sequence
3. role of each API/action
4. store/EAI/async impact
5. uncertainty / missing ground

For exact endpoint questions:

1. exact target confirmation
2. controller/service chain
3. ordered sequence relation to surrounding workflow
4. data/store/external side effects
5. known gaps

### Desired outcome

Answers should match user mental models, not just expose internal traces.

---

## 8. Offline execution readiness harness

The repo is now close enough to bundle/import usage that execution readiness needs a first-class checklist.

### Requirements

Validate and document:

- backend/frontend bundle artifacts
- bundled Node runtime 여부
- QMD model inclusion rules
- separate LLM server/model requirement
- `.env` requirements for backend/frontend
- whether indexes/cache are bundled or rebuilt
- local validation commands before import

### Desired outcome

A Windows x64 offline import should be gated by a reproducible checklist, not by memory or assumption.

---

## Non-goals for the next step

These should **not** be the main response to quality gaps:

- adding more one-off business/domain branches
- adding special-case boosts for specific channels
- trying to encode business truth that is not actually recoverable from code
- copying MiroFish-style LLM-authored ontology as the core source of truth

If a gap is semantic/operational rather than structural, capture that explicitly and route it toward:

- user input,
- documents,
- CSV,
- runtime logs,
- draft review,

instead of hiding it in retrieval heuristics.

---

## Recommended execution order

1. **Question-set harness**
2. **Question-type acceptance contracts**
3. **Canonical workflow synthesis artifact/debug layer**
4. **Draft/review/self-eval linkage to question harness**
5. **Ontology governance cleanup**
6. **AST/LSP/config upgrade decision record**
7. **User-facing answer shape standardization**
8. **Offline execution readiness checklist completion**

---

## Completion criteria

This next step is done when:

1. representative ontology QA questions are stored as reusable fixtures
2. each question type has an explicit acceptance contract
3. ontology draft evaluation can show answer-level improvement/regression
4. canonical workflow synthesis is inspectable without reading code
5. answer failures are explainable via contract reasons
6. AST/LSP adoption decisions are documented as extractor policy, not ad-hoc code
7. offline bundle/import prerequisites are documented and reproducible
8. new quality work can be evaluated without relying on ad-hoc manual checking

---

## Policy reminder

The next step must **not** regress into domain-specific tuning.

Allowed:

- general workflow semantics
- exact-target preservation
- sequence coverage
- ontology coherence
- acceptance contracts
- harness-driven regression pressure
- AST/LSP as extractor infrastructure
- offline readiness contracts

Not allowed:

- special casing `모니모`, `보험금청구`, `햇살론`, or any other specific business line
- hidden business-family boosts that are not explainable as general ontology rules
- ontology core replacement with LLM-authored schema from external reference systems
