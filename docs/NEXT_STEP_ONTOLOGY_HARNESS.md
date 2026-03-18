# NEXT STEP: Ontology Harness and Evaluation Loop

Updated: 2026-03-18  
Baseline commit at write time: `781fdd7`

## Why this is the next step

The current system has already pushed the **code-only ontology seed** far enough that additional gains from blindly adding more extraction/scoring code are diminishing.

What is now missing is not just more nodes and edges, but a tighter loop around:

- what counts as a good answer,
- how regressions are detected,
- how ontology edits are evaluated,
- how draft/review/replay/self-eval connect,
- how answer generation is forced to stay aligned with canonical workflow/path evidence.

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

### What is still weak

The system can often gather **related APIs and related evidence**, but it still struggles with:

1. **single coherent representative workflow synthesis**
2. **stable acceptance criteria per question type**
3. **rich user-level answer formatting**
4. **regression visibility when ontology/planner changes**
5. **semantic distinctions that code alone does not settle**

Example failure shape:

- related APIs are gathered correctly,
- but the answer mixes adjacent workflow families,
- or explains the wrong representative anchor,
- or omits the exact sequence the user asked for.

This is now more of a **harness problem** than a pure extractor problem.

---

## Practical assessment

### Code-only ontology seed

Current assessment:

- extractor / derivation completeness: **high**
- retrieval/path grounding baseline: **usable**
- answer quality stability: **not yet governed tightly enough**

Interpretation:

- More code-only extraction can still help at the margin.
- But without stronger evaluation discipline, more rules will increasingly look like heuristic sprawl.

So the next phase must optimize for:

- **control**
- **repeatability**
- **comparability**
- **explicit quality contracts**

not just additional extraction.

---

## Primary goal

Build a **repeatable ontology QA harness** that makes it easy to:

1. run representative question suites,
2. compare before/after results,
3. score exact-target / workflow-sequence / cross-layer quality,
4. inspect why an answer passed or failed,
5. accept/reject ontology draft changes with rollback support.

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

## 6. User-facing answer shape

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

## Non-goals for the next step

These should **not** be the main response to quality gaps:

- adding more one-off business/domain branches
- adding special-case boosts for specific channels
- trying to encode business truth that is not actually recoverable from code

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
6. **User-facing answer shape standardization**

---

## Completion criteria

This next step is done when:

1. representative ontology QA questions are stored as reusable fixtures
2. each question type has an explicit acceptance contract
3. ontology draft evaluation can show answer-level improvement/regression
4. canonical workflow synthesis is inspectable without reading code
5. answer failures are explainable via contract reasons
6. new quality work can be evaluated without relying on ad-hoc manual checking

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

Not allowed:

- special casing `모니모`, `보험금청구`, `햇살론`, or any other specific business line
- hidden business-family boosts that are not explainable as general ontology rules

