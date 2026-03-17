# Ontology Graph Migration Plan

## 목적

`ohmyqwen`의 다음 단계는 단순 검색/RAG를 넘어서,  
**코드베이스 + 사전 + 문서 + 운영이력 + 사용자 피드백을 하나의 ontology graph로 통합**하는 것이다.

핵심 목표는 다음이다.

1. 질문을 키워드 매칭이 아니라 **객체/관계 탐색 문제**로 푼다.
2. 도메인 팩 의존도를 낮추고, **typed knowledge 중심 구조**로 옮긴다.
3. 시각화 가능한 graph/projection을 많이 만들어 **구조 설명력**을 높인다.
4. 현재 구현을 버리지 않고, **기존 knowledge schema / retrieval units / replay / feedback**을 재사용한다.

---

## 결론 먼저

### 완전 폐기해야 하는가?

**아니다. 완전 폐기는 잘못이다.**

현재 이미 구현된 아래 요소는 ontology graph의 좋은 기반이다.

- `knowledge schema`
- `retrieval units`
- `question taxonomy`
- `typed ask gates`
- `evaluation artifacts`
- `evaluation replay`
- `feedback / promotion / stale lifecycle`

즉 지금 필요한 것은 rewrite가 아니라:

> **현재의 구조화 산출물을 ontology graph의 node / edge / projection으로 승격하는 일**

이다.

---

## 왜 ontology graph가 필요한가

현재까지 드러난 한계:

1. 도메인 팩은 오탐 방지에는 유효하지만, 장기적으로는 중복과 격리 문제를 만든다.
2. 질문은 실제로 domain만으로 풀리지 않는다.
   - `module-role`
   - `channel integration`
   - `process/batch`
   - `cross-layer flow`
   - `config/resource`
3. 공통 action (`check`, `callback`, `register`, `apply`)이 여러 도메인에 걸친다.
4. 실서비스 코드는 domain / channel / module-role / process-role이 교차한다.

즉 **지식을 tag 묶음이 아니라 관계망으로 다뤄야 한다.**

---

## 설계 원칙

### 1. Domain-first가 아니라 Typed Knowledge-first

축을 분리한다.

- domain
- subdomain
- action
- channel
- module-role
- process-role

도메인은 여러 의미 축 중 하나일 뿐이다.

### 2. 모든 지식은 provenance를 가진다

각 node/edge는 반드시 근거를 가진다.

- sourceType
- sourcePath
- evidencePaths
- generatedBy
- validatedStatus
- updatedAt

### 3. Graph 본체와 Projection을 분리한다

하나의 거대한 그래프를 그대로 보여주지 않는다.

- code graph
- flow graph
- integration graph
- module-role graph
- evaluation graph

같은 **projection**으로 나눠서 시각화/검색에 쓴다.

### 4. Candidate → Validated → Stale lifecycle을 node/edge 수준으로 관리한다

지식은 한 번 생성됐다고 영구 신뢰하지 않는다.

### 5. 기존 구현을 최대한 재사용한다

새 ontology graph는 아래를 기반으로 build한다.

- structure index
- front-back graph
- EAI dictionary
- learned knowledge
- retrieval units
- evaluation replay/trends/feedback

---

## Ontology Core

## Node Types

### 코드 계층
- `project`
- `module`
- `file`
- `symbol`
- `class`
- `method`
- `route`
- `api-endpoint`
- `controller`
- `service`
- `dao-mapper`
- `batch-job`
- `batch-step`
- `event-processor`
- `queue`

### 외부/운영 계층
- `eai-interface`
- `document`
- `config`
- `environment-variable`
- `feedback-record`
- `evaluation-artifact`
- `replay-candidate`

### 의미 계층
- `domain`
- `subdomain`
- `action`
- `channel`
- `partner`
- `module-role`
- `process-role`
- `knowledge-cluster`

---

## Edge Types

- `contains`
- `declares`
- `calls`
- `routes-to`
- `maps-to`
- `delegates-to`
- `uses-eai`
- `uses-config`
- `reads-env`
- `publishes-event`
- `consumes-event`
- `processed-by`
- `belongs-to-domain`
- `belongs-to-subdomain`
- `belongs-to-channel`
- `has-action`
- `has-module-role`
- `has-process-role`
- `validated-by-feedback`
- `promoted-from`
- `degraded-to-stale`
- `suggests-preset`
- `supports-question-type`

---

## Graph Metadata Model

모든 node/edge 공통 메타데이터:

- `confidence`
- `validatedStatus` (`candidate | validated | derived | stale`)
- `sourceType`
- `sourceIds`
- `evidencePaths`
- `domains[]`
- `subdomains[]`
- `channels[]`
- `actions[]`
- `moduleRoles[]`
- `processRoles[]`
- `updatedAt`
- `usageCount`
- `successCount`
- `failureCount`

---

## Graph Layers / Projections

시각화와 질의는 projection 단위로 나눈다.

### 1. Code Structure Projection
- module
- file
- symbol
- controller/service/dao

질문 예:
- `dcp-async 프로젝트는 어떤 역할인가?`
- `IrpJoinService는 어디서 쓰이나?`

### 2. Front→Back Flow Projection
- screen/route
- api-endpoint
- gateway
- controller
- service
- downstream

질문 예:
- `보험금 청구 흐름`
- `모니모 회원인증 프론트→백엔드`

### 3. Integration Projection
- partner/channel
- callback
- eai-interface
- bridge
- external response flow

질문 예:
- `모니모 연계`
- `외부 인증 콜백`

### 4. Process / Batch Projection
- batch-job
- batch-step
- event queue
- processor
- scheduler

질문 예:
- `배치 프로세스`
- `dcp-async 역할`

### 5. Evaluation / Lifecycle Projection
- learned knowledge
- replay candidate
- feedback record
- promotion/stale actions

질문 예:
- `최근 품질이 어디서 깨졌나?`

---

## QMD와의 관계

QMD는 ontology graph의 대체제가 아니다.  
QMD는 여전히 **검색 엔진**이다.

역할 분리:

- **QMD**
  - BM25 / vector / rerank / query expansion
  - raw evidence retrieval

- **Ontology Graph**
  - typed entities / relations
  - graph projection
  - query planning
  - explanation path
  - validation lifecycle

즉 방향은:

> QMD가 문서/코드 조각을 가져오고, ontology graph가 그 조각을 의미 구조 안에 위치시키는 구조

이다.

---

## 현재 구현과 매핑

## 이미 있는 것 → Graph로 재사용

### `knowledge schema`
현재 가장 가까운 기반이다.  
이걸 ontology core의 초기 node/edge snapshot으로 승격한다.

### `retrieval units`
이건 graph projection의 초기 view로 재사용한다.

### `learned knowledge`
이건 `knowledge-cluster` node로 승격한다.

### `front-back graph`
이건 `Front→Back Flow Projection`의 핵심 edge source다.

### `EAI dictionary`
이건 `eai-interface` node + `uses-eai` edge source다.

### `evaluation replay / trends / feedback`
이건 `Evaluation / Lifecycle Projection`의 핵심이다.

---

## 새로 추가해야 할 것

### 1. Ontology Graph Snapshot Builder

산출물:
- `memory/ontology-graph/latest.json`
- `memory/ontology-graph/latest.md`

역할:
- 기존 knowledge schema + learned knowledge + evaluation records를 합쳐
- typed graph snapshot 생성

### 2. Ontology Projections

산출물 예:
- `memory/ontology-projections/code-structure.json`
- `memory/ontology-projections/front-back-flow.json`
- `memory/ontology-projections/integration.json`
- `memory/ontology-projections/process-batch.json`
- `memory/ontology-projections/evaluation-lifecycle.json`

### 3. Graph Query Planner

질문 타입별로:
- 어떤 projection을 먼저 볼지
- 어떤 node type을 anchor로 삼을지
- 어떤 edge depth까지 볼지
를 정한다.

### 4. Explanation Path Builder

답변은 단순 hit 모음이 아니라:

- anchor node
- connecting path
- supporting evidence bundle

형태로 만들어야 한다.

---

## 시각화 전략

사용자가 요청한 핵심은 “시각화 되는 영역이 많아야 한다”는 점이다.  
따라서 ontology graph는 처음부터 visualization-first 관점을 가진다.

## 필수 시각화

### A. Project Overview Graph
- module
- top services
- top channels
- top integrations
- top domains

### B. Front→Back Path Viewer
- 화면/route
- API
- controller
- service
- downstream

### C. Module Role Graph
- 특정 프로젝트/모듈의 역할
- 어떤 queue / processor / callback / service를 포함하는지

### D. Integration Graph
- monimo / partner / callback / member-auth / async

### E. Process / Batch Graph
- job
- step
- processor
- external dependencies

### F. Knowledge Lifecycle Dashboard
- candidate / validated / stale
- replay queue
- feedback
- promotions

### G. Question Trace Viewer
- 사용자가 한 질문
- 선택된 question type
- anchor node
- traversed path
- 채택 근거
- 탈락 근거

---

## 시각화 형식

초기에는 복잡한 그래프 UI보다, 다음 순서가 맞다.

### 1단계
- ASCII / JSON / table / ranked list

### 2단계
- 간단한 force graph / dag view

### 3단계
- node filtering
- projection switching
- path highlighting

즉 처음부터 거대한 graph canvas보다,
**projection별 전용 시각화**가 맞다.

---

## Migration Plan

## Phase A — Reuse Existing Structures

목표:
- 현재 구조를 버리지 않고 ontology 기반으로 재해석

작업:
- `knowledge schema`를 ontology core에 맞게 확장
- `retrieval units`와 node/edge를 연결
- `evaluation*`와 `feedback`을 lifecycle graph로 연결

### 완료 기준
- ontology snapshot 생성 가능
- 기존 analyze artifact와 공존 가능

---

## Phase B — Build Ontology Projections

목표:
- 시각화/검색 단위로 projection 생성

작업:
- code structure projection
- front-back flow projection
- integration projection
- process/batch projection
- evaluation lifecycle projection

### 완료 기준
- projection별 JSON/Markdown 생성
- UI에서 상위 요약 표시 가능

---

## Phase C — Graph-Aware Ask/Search

목표:
- ask/search planning이 graph projection을 anchor로 사용

작업:
- question type별 projection 선택
- anchor node selection
- path search
- evidence bundle generation

### 완료 기준
- ask diagnostics에 graph anchor / projection / path ids 표시
- 잘못된 broad-domain substitution 감소

---

## Phase D — Promotion Loop on Graph

목표:
- candidate / validated / stale lifecycle를 node/edge 수준으로 운영

작업:
- feedback → edge validation
- replay → path confidence update
- stale decay
- validated promotion

### 완료 기준
- graph node/edge 상태가 운영 이력에 따라 변함
- UI에서 lifecycle이 보임

---

## 무엇을 버리고 무엇을 유지할 것인가

## 유지
- QMD runtime
- knowledge schema
- retrieval units
- typed gates
- replay / trend / feedback
- domain packs / presets (단, 보조 역할)

## 약화
- domain pack 중심 사고
- broad tag에 강하게 의존하는 ranking

## 버리지 않음
- 현재 Phase 3 구현 대부분

## 새로 추가
- ontology snapshot
- ontology projections
- graph query planner
- graph explanation builder
- graph lifecycle visualization

---

## 최종 판단

### 지금까지 구현을 완전 폐기하고 새로 해야 하는가?

**아니다.**

현재 구현은 ontology graph의 하위 기반으로 충분히 재사용 가능하다.  
오히려 지금까지 쌓은 구조화 산출물을 버리면 손해다.

올바른 접근은:

> **현재 구현을 ontology graph 아래로 재배치하고, 중심을 domain pack에서 typed knowledge graph로 옮기는 것**

이다.

즉 rewrite가 아니라 **structural migration**이다.
