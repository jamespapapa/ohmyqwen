# Ontology System Design

## 목적

`ohmyqwen`의 다음 핵심 단계는 **코드베이스에서 최소 온톨로지를 만들고**,  
운영 중에 들어오는 사용자 맥락, CSV/문서, feedback, replay, 로그를 통해  
이를 **candidate -> validated -> contested -> stale -> deprecated** lifecycle 아래 점진적으로 강화하는 것이다.

이 문서는 지금까지 논의된 설계를 하나로 정리한 **구현 전 기준 문서**다.

---

## 1. 큰 방향

### 핵심 방향

1. **코드베이스에서 1차 ontology graph를 결정론적으로 생성한다.**
2. 그 graph를 사용자에게 **시각화된 projection**으로 보여준다.
3. 사용자는 자유 메모, 구조화 입력, CSV, 문서, 이후에는 git history / 운영 로그 등을 통해  
   **맥락과 노하우를 얹는다.**
4. 시스템은 유사 객체/관계를 추천하고 pattern을 일반화해 **candidate knowledge**를 확장한다.
5. replay / feedback / regression을 통해 이를 검증하고 **validated knowledge**로 승격한다.

### 하지 않는 것

- 처음부터 거대한 enterprise ontology를 완성하려고 하지 않는다.
- 도메인 팩 중심으로만 시스템을 설계하지 않는다.
- 사용자 메모를 즉시 truth로 승격하지 않는다.
- 외부에서 타겟 코드베이스를 항상 볼 수 있다고 가정하지 않는다.

---

## 2. 지금까지 구현된 것의 위치

현재 구현은 버리지 않는다. 아래는 ontology graph의 기반으로 재사용한다.

- `knowledge schema`
- `retrieval units`
- `question taxonomy`
- `typed ask gates`
- `evaluation artifacts`
- `evaluation replay`
- `evaluation trends`
- `feedback / promotion / stale lifecycle`
- `front-back graph`
- `EAI dictionary`
- `learned knowledge`

즉 필요한 것은 rewrite가 아니라:

> **현재 산출물을 ontology node / edge / projection / lifecycle layer로 재배치하는 것**

이다.

---

## 3. 최소 온톨로지: 코드베이스에서 먼저 만든다

## 3.1 1차 node

### 코드 구조 node
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
- `queue`
- `event-processor`
- `eai-interface`

### 운영/지식 node
- `knowledge-cluster`
- `feedback-record`
- `evaluation-artifact`
- `replay-candidate`
- `document`
- `config`
- `environment-variable`

### 의미 node
- `domain`
- `subdomain`
- `action`
- `channel`
- `partner`
- `module-role`
- `process-role`

---

## 3.2 1차 edge

### hard relation
코드/사전에서 직접 추출 가능

- `contains`
- `declares`
- `calls`
- `routes-to`
- `maps-to`
- `delegates-to`
- `uses-eai`
- `processed-by`
- `publishes-event`
- `consumes-event`

### derived structural relation
기존 추출물과 규칙을 결합해 생성

- `front-back-flow`
- `service-downstream-flow`
- `batch-flow`
- `integration-flow`
- `depends-on`

### semantic relation
후보/승격 대상

- `belongs-to-domain`
- `belongs-to-subdomain`
- `belongs-to-channel`
- `has-action`
- `has-module-role`
- `has-process-role`
- `adjacent-to`
- `conflicts-with`
- `supports-question-type`
- `validated-by-feedback`
- `promoted-from`
- `degraded-to-stale`
- `suggests-preset`

---

## 3.3 신뢰도 계층

relation은 같은 수준으로 취급하지 않는다.

### Level 1: hard
- 코드로 직접 증명 가능

### Level 2: derived
- 여러 hard relation을 조합해 생성

### Level 3: semantic
- 사용자 힌트, replay, feedback로 검증되는 관계

graph 설계에서 이 구분은 반드시 유지한다.

---

## 4. domain pack / preset의 재정의

## 4.1 domain pack은 필수 본체가 아니다

domain pack은 ontology graph의 중심이 아니라:

- semantic alias bundle
- weak prior
- UI filter
- user lock option

이다.

즉 최종 구조는 **typed knowledge graph 중심**이고,  
domain pack은 보조 계층으로 남는다.

## 4.2 preset의 역할

preset은 단순 UI 템플릿이 아니라:

- 어떤 domain pack을 켤지
- 어떤 workspace/project에 자동 매칭할지
- EAI catalog를 어떻게 볼지
- key facts를 어떻게 주입할지

를 정하는 **project policy/profile**이다.

자동 생성은 가능하지만, 자동 적용보다 **추천/초안 생성**이 적절하다.

---

## 5. 사용자가 제공하는 추상적 노하우를 어떻게 받는가

핵심 원칙:

> **추상적 정의를 직접 받지 말고, 사례 / 비예시 / 경계 / 판단기준 / 단계 흐름 형태로 받는다.**

### 좋은 입력 유형

#### A. 대표 사례
- 이 capability를 대표하는 화면/API/서비스 3개

#### B. 비예시
- 자주 헷갈리지만 이 capability가 아닌 것 2개

#### C. 경계
- 무엇을 포함하는가
- 무엇을 제외하는가

#### D. 판단 기준
- 어떤 신호가 있으면 이 role/capability로 보는가

#### E. 단계 흐름
- 시작점
- 중간 단계
- 후속 처리 / callback

#### F. 혼동 대상
- adjacent flow
- 같은 domain 안의 다른 subdomain

이 입력은 자유 메모보다 ontology에 훨씬 잘 들어간다.

---

## 6. 입력 채널

사용자 입력 채널은 하나가 아니라 ingestion pipeline이어야 한다.

### 6.1 자유 텍스트 메모
- 빠르고 쓰기 쉬움
- candidate relation / note로 파싱

### 6.2 구조화 폼
- examples / exclusions / boundary / role / process
- ontology 승격에 가장 유리

### 6.3 CSV 업로드
- capability dictionary
- 화면 ↔ API ↔ 서비스 맵핑
- EAI 사전
- 업무 코드표

### 6.4 문서 업로드
- 업무 정의서
- API 문서
- 운영 가이드
- 화면 목록

### 6.5 git history
- co-change relation
- historical capability labels
- implementation cluster

### 6.6 runtime logs / grafana / traces
- 실제 호출 경로
- runtime edge
- hotspot
- async/sync 경계

이 모든 입력은 ontology에 직접 진실로 들어가는 것이 아니라,  
**candidate evidence source**로 들어간다.

---

## 7. pattern 확장 전략

사용자가 seed를 주면 시스템은 비슷한 것들을 추천해야 한다.

### 예시
사용자가:
- `MonimoAsyncController`
- `/monimo/registe`
- `MDP-MYCER999999M`
를 같은 맥락으로 지정

시스템은 다음으로 유사 후보를 찾는다.

- path similarity
- route/API prefix similarity
- graph neighborhood similarity
- controller/service naming similarity
- 같은 EAI 사용
- 같은 replay/question cluster 동시 출현

그 결과를:
- `candidate capability`
- `candidate channel relation`
- `candidate module-role relation`
로 만든다.

즉 운영 중에 pattern을 계속 찾아 강해질 수 있다.

---

## 8. feedback 설계

feedback은 answer-level만 있으면 부족하다.

## 8.1 feedback scope

- `answer`
- `evidence`
- `node`
- `edge`
- `path`
- `boundary`

## 8.2 feedback verdict

- `correct`
- `partial`
- `incorrect`
- `unsafe`

## 8.3 feedback payload 최소 스키마

- `kind` (`ask` / `search` / `graph-review` / `ontology-review`)
- `scope`
- `targetType`
- `targetId`
- `questionType`
- `verdict`
- `strength` (`weak` / `normal` / `strong`)
- `rationale`
- `author`
- `timestamp`
- `matchedKnowledgeIds`
- `matchedRetrievalUnitIds`

즉 feedback은 UI 버튼 하나가 아니라  
**ontology node/edge/path를 검증하는 구조화 artifact**여야 한다.

---

## 9. 평가 기준

## 9.1 answer 평가

- `relevance`
- `structural correctness`
- `boundary correctness`
- `evidence adequacy`
- `completeness`
- `risk`

## 9.2 ontology 평가

### node
- 존재가 맞는가
- label이 맞는가
- role/domain/channel/action 분류가 맞는가

### edge
- 관계 종류가 맞는가
- 방향이 맞는가
- direct relation인가 derived relation인가

### path
- 질문을 실제로 설명하는 경로인가
- unrelated hop이 섞였는가

---

## 10. 승격 / 강등 상태머신

현재 `candidate / validated / stale`만으로는 부족하다.  
다음 상태를 기준으로 간다.

- `candidate`
- `validated`
- `contested`
- `stale`
- `deprecated`

## 10.1 승격

candidate -> validated

조건 예:
- direct evidence 존재
- replay 반복 성공
- positive feedback 누적
- adjacent confusion 낮음
- freshness 양호
- 여러 질문 타입에서 재사용

## 10.2 contested

feedback이 충돌하거나,
replay와 user verdict가 엇갈리는 경우

- 바로 승격/삭제하지 않는다
- review queue로 올린다

## 10.3 강등

validated -> stale / deprecated

조건 예:
- repeated incorrect feedback
- source path 소멸
- replay 연속 실패
- 더 정확한 competing relation 등장
- freshness timeout

---

## 11. score 모델

상태는 점수 기반으로 관리한다.

- `supportScore`
- `riskScore`
- `freshnessScore`
- `conflictScore`
- `usageScore`

상태 전이는 이 점수 조합으로 결정한다.

예:
- validated = support 높고 conflict 낮음
- contested = support/conflict 동시 높음
- stale = freshness 낮고 recent support 낮음

---

## 12. projection과 시각화

graph는 하나의 거대한 canvas보다 projection 중심으로 본다.

### 필수 projection

1. `code-structure`
2. `front-back-flow`
3. `integration`
4. `process-batch`
5. `evaluation-lifecycle`

### 필수 시각화

#### A. Project Overview Graph
- top modules
- top channels
- top domains
- top integrations

#### B. Front→Back Path Viewer
- route -> api -> gateway -> controller -> service -> downstream

#### C. Module Role Graph
- 예: dcp-async의 queue / processor / callback / service 구조

#### D. Integration Graph
- monimo / partner / callback / member-auth

#### E. Process / Batch Graph
- job / step / processor / event queue

#### F. Knowledge Lifecycle Dashboard
- candidate / validated / contested / stale
- replay queue
- promotions
- top failure codes

#### G. Question Trace Viewer
- question type
- selected anchor
- traversed path
- used evidence
- rejected evidence

초기에는 JSON + ranked list + ASCII로 시작하고,  
이후 projection별 전용 그래프로 간다.

---

## 13. 단계별 구현 전략

## Phase A — 최소 ontology snapshot

목표:
- 기존 `knowledge schema`를 ontology core로 확장

산출물:
- `memory/ontology-graph/latest.json`
- `memory/ontology-graph/latest.md`

## Phase B — projection 생성

산출물:
- `memory/ontology-projections/code-structure.json`
- `memory/ontology-projections/front-back-flow.json`
- `memory/ontology-projections/integration.json`
- `memory/ontology-projections/process-batch.json`
- `memory/ontology-projections/evaluation-lifecycle.json`

## Phase C — graph-aware planner

목표:
- ask/search가 projection과 anchor node를 고르게 함

추가 diagnostics:
- `projectionId`
- `anchorNodeIds`
- `pathIds`

## Phase D — graph lifecycle engine

목표:
- feedback / replay / freshness를 node/edge/path lifecycle에 반영

## Phase E — user ingestion layer

목표:
- free-form
- structured form
- csv/docs
- later: git/logs

를 candidate ontology source로 연결

---

## 14. 핵심 운영 원칙

1. **코드에서 뽑을 수 있는 구조는 결정론적으로 뽑는다.**
2. **추상 지식은 candidate로만 시작한다.**
3. **사용자 노하우는 정의가 아니라 사례/경계/비교로 받는다.**
4. **도메인 팩은 보조 계층으로 내린다.**
5. **feedback은 node/edge/path를 평가하는 구조로 올린다.**
6. **promotion/demotion은 점수와 lifecycle로 관리한다.**
7. **visualization은 projection 중심으로 많이 제공한다.**

---

## 15. 최종 판단

이 설계의 핵심은:

> **코드베이스에서 최소한의 구조 ontology를 먼저 만들고,  
> 사용자와 상호작용하면서 semantic layer를 얹고,  
> replay/feedback로 검증해 validated ontology graph로 키워나가는 것**

이다.

즉:
- 현재 구현을 버리지 않고
- ontology graph 아래로 재배치하고
- user interaction / ingestion / lifecycle을 붙여
- 폐쇄망에서도 시간이 갈수록 강해지는 구조를 만드는 것이 목표다.
