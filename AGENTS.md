# AGENTS.md

## 프로젝트 큰그림

`ohmyqwen`은 **폐쇄망/제한망 환경에서 실행되는 로컬 에이전틱 코딩 런타임 + 프로젝트 분석 서버**다.  
핵심은 두 축이다.

1. 상태머신 기반 실행 루프  
   - `ANALYZE -> PLAN -> IMPLEMENT -> VERIFY -> (FINISH | PATCH | FAIL)`
2. 프로젝트 지식화 / 질의응답 루프  
   - 색인 -> 구조분석 -> 사전/그래프/후보지식 축적 -> 질문응답 -> 품질게이트 -> 재시도/승격

LLM은 제안과 해석을 담당하고, **최종 실행/검증/상태 전이와 품질 판단은 런타임이 강제**한다.

---

## 현재 시스템의 핵심 구조

### 1. 실행 런타임
- `src/loop`, `src/core`, `src/gates`
- objective-contract / build/test/lint 기반 품질게이트
- 실행 아티팩트: `.ohmyqwen/runs/<runId>/`

### 2. 프로젝트 분석 서버
- `src/server`
- 프로젝트 등록 / 색인 / 구조분석 / 검색 / 질문 / 디버그 API 제공
- 프론트(`console-next`)와 백엔드(`serve`) 분리 배포 가능

### 3. 내장 QMD 검색 런타임
- `vendor/qmd`
- `src/retrieval/qmd-runtime.ts`
- `src/retrieval/qmd-internal.ts`
- app-owned runtime 경로:
  - `.ohmyqwen/runtime/qmd/config`
  - `.ohmyqwen/runtime/qmd/cache`
  - `.ohmyqwen/runtime/qmd/indexes`
  - `.ohmyqwen/runtime/qmd/models`
- 기본 방향은 **internal-runtime + offline strict + Windows x64 폐쇄망 배포**

### 4. 프로젝트 지식화 계층
- structure index
- front-back graph
- EAI dictionary
- learned knowledge
- ontology graph / ontology projections
- ontology viewer / fullscreen graph route
- retrieval units
- ontology draft / review / replay / feedback lifecycle
- legacy domain/module-role/process/channel packs (호환 계층, 제거 대상)
- 목적: 프로젝트별 정합도를 반복 사용으로 점진 향상

---

## 현재 프로젝트 목적 (최신화)

1. 입력 요구사항을 고정 템플릿이 아닌 **동적 목적 해석**으로 처리한다.
2. 품질게이트(`build/test/lint`)와 objective-contract를 통해 **완료/실패 근거를 명확히 남긴다**.
3. QMD를 외부 CLI가 아니라 **프로젝트 내부 런타임**으로 사용하고, 폐쇄망 Windows x64 환경에서 실행 가능하게 유지한다.
4. 프로젝트 분석 품질은 **하드코딩된 도메인 분기**보다, 사전/그래프/후보지식/회귀테스트 축적을 통해 올린다.
5. 외부 지원 없이도 폐쇄망 내부 Qwen3 기반으로 점진 강화될 수 있도록, **candidate -> validated knowledge 승격 구조**를 우선한다.
6. 본격적인 RAG 구축은 **코드/구조/그래프/사전/운영기록을 하나의 knowledge schema 아래 통합**하는 방향으로 진행한다.
7. 최종 질의응답의 중심은 **ontology graph + path grounding + question-type evidence contract**여야 하며, domain pack/preset은 중심 로직에서 제거한다.
8. 코드베이스에서 먼저 **최소 ontology graph**를 만들고, 사용자 힌트/피드백/CSV/문서/이력으로 semantic layer를 승격한다.
9. `QMD = retrieval engine`, `ontology = semantic control plane`, `agentic workflow = orchestration / verification loop` 역할 분리를 유지한다.
10. 코드베이스 기반 ontology 강화는 **extractor / derivation / projection / evaluation harness** 중심으로 통제하고, 질문 맞춤형 특수분기는 금지한다.
11. **AST를 주 추출기, LSP를 보조 해석기**로 보는 방향을 유지한다. 프론트 HTTP 호출, gateway route, backend controller/service 연결은 AST + config parser + symbol resolution 조합으로 강화한다.
12. 외부 참고 시스템은 UX/거버넌스 참고용으로만 본다. **MiroFish류의 LLM-주도 ontology 설계나 외부 graph memory 의존 구조를 본체로 삼지 않는다.**

---

## 운영 원칙

1. **타겟 코드베이스 직접 접근을 전제로 설계하지 않는다.**  
   폐쇄망 운영 이후에는 추출된 사전/그래프/질의기록/사용자 힌트만으로도 품질을 올릴 수 있어야 한다.

2. **질문별 if/else보다 일반화된 지식 승격 구조를 우선한다.**  
   `channel / domain / subdomain / action / module-role / process-role`를 분리해서 다룬다.

3. **confidence는 구조 완성도만으로 올리지 않는다.**  
   질문 의미 정합성, specificity, adjacent flow confusion을 반드시 반영한다.

4. **재시도는 새 증거가 생길 때만 한다.**  
   evidence 변화가 없으면 반복 호출을 멈춘다.

5. **Windows x64 오프라인 번들 실행성을 항상 의식한다.**  
   네이티브 의존성, bundle root 경로, local model path, wrapper 스크립트 동작을 깨지 않게 유지한다.

6. **현재 구현을 버리는 rewrite보다 ontology migration을 우선한다.**  
   `knowledge schema`, `retrieval units`, `replay`, `feedback`은 ontology graph의 seed layer로 재사용한다.

7. **사용자 노하우는 정의가 아니라 사례/경계/비교/판단기준/단계 흐름으로 받는다.**  
   자유 메모도 허용하지만, 가능하면 구조화된 입력과 provenance를 남긴다.

8. **domain pack / preset 치트키에 의존하지 않는다.**
   남아 있는 domain pack / preset 로직은 호환성 계층이며, 질문 해석/랭킹/게이팅의 중심에서 단계적으로 제거한다.

9. **특정 업무/채널 보정 금지.**
   `모니모`, `보험금청구`, `햇살론` 같은 개별 케이스를 맞추기 위한 특수분기 대신, action/path/state-store/data-persistence/adjacent-flow 일반 규칙으로 고도화한다.

10. **code-only ontology는 extractor completeness를 우선한다.**
   새로운 품질 요구가 생겨도 먼저
   - 구조 추출기
   - ontology derivation
   - workflow/state transition
   - evaluation harness
   관점에서 해결하고, 특정 질문을 맞추기 위한 scoring 꼼수는 지양한다.

11. **현재 code-only 강화는 실질적 실링에 근접했다.**
   다음 단계의 중심은
   - evaluation/regression harness 강화
   - ontology governance 정리
   - draft/review/self-eval 활용
   - 사용자/문서/CSV/운영 기록의 semantic layer 승격
   이다.

---

## Phase 기록

### Phase 1 (완료)

**목표:** 런타임 안정화 + 요구사항 해석/검증 신뢰도 개선 + 라이브러리 allowlist 기반 튜닝 도입

**완료 항목 요약**

- AnalyzeInput 확장
  - `availableLibraries`
  - `availableLibrariesFile`
  - `availableLibrariesUrl`
- ANALYZE 단계 튜닝
  - 라이브러리 소스 자동 해석(입력/파일/URL)
  - allowlist 활성 시 제약 플래그 자동 부여
  - 튜닝 결과 아티팩트 기록: `outputs/analyze.tuning.json`
- Objective-contract 강화
  - Node/Spring 의존성 allowlist 위반 검출
  - 실패 원인 메시지 명확화
- 서버/API 입력 경로 반영
  - `POST /api/runs`에서 allowlist 관련 필드 수용

### Phase 2 (진행 중)

**목표:** 프로젝트 분석/질의응답을 폐쇄망에서 스스로 강화되는 구조로 전환

**현재까지 반영된 축**

- internal QMD runtime 통합
- project analysis / ask / debug API
- structure index / front-back graph / EAI dictionary / learned knowledge
- domain packs / maturity scoring / cross-layer tracing
- Windows x64 오프라인 backend/frontend 번들링

**남은 중점**

1. broad domain -> subdomain -> action 정합도 향상
2. module-role / process-role 질문 품질 강화
3. candidate knowledge 자동 승격 / stale knowledge 약화
4. replay / regression 기반 품질 향상 루프 강화
5. 폐쇄망 운영 기록 기반 엔진 일반화

### Phase 3 (진행 중)

**목표:** `ohmyqwen`을 ontology-first 프로젝트 특화 RAG 플랫폼으로 승격

**핵심 방향**

- retrieval unit을 파일 중심에서 **entity / block / flow 중심**으로 전환
- code / route / API / controller / service / EAI / batch / module-role을 **통합 knowledge schema**로 정리
- candidate -> validated -> stale lifecycle을 정식 도입
- 질문 유형별 retrieval contract와 quality gate를 분리
- 운영 기록과 사용자 피드백을 replay / regression / pack 승격으로 연결
- ontology graph / projection / visualization 중심 구조로 점진 이행
- feedback을 answer-level이 아니라 **node / edge / path 검증 시스템**으로 확장
- legacy domain packs / presets를 **ontology concept / path 기반 구조로 대체**
- 프론트 -> API -> gateway -> controller -> service -> store/EAI/async 까지 **action-aware path graph**로 표현
- `QMD + vector/FTS + rerank`를 ontology-guided retrieval로 묶고, agentic workflow가 검증/재시도/중단을 담당
- ontology viewer / fullscreen graph route / representative path focus / structural component focus 추가
- exact endpoint / ordered workflow sequence / canonical path / workflow-family / contract propagation / async transition / persistence transition까지 code-only ontology seed 확장
- code structure densification(method call / depends-on / structural component focus) 및 viewer 개선
- exact endpoint / workflow-sequence 질문에 대한 deterministic exact-trace 경로 정비

**현재 판단**

- code-only ontology 확장은 **고레버리지 구간은 대부분 반영**되었다.
- 남은 품질 향상은 주로
  - 평가 하네스 강화
  - ontology governance 정리
  - human/runtime semantic layer 추가
  - AST/LSP/config 기반 structure extractor 고도화 여부 판단
  쪽이 크다.
- MiroFish 비교 결과, 외부 ontology 제품처럼 **단계형 UX/graph interaction**은 참고하되, ontology core는 계속 code-grounded / offline-first로 유지한다.

**설계 문서 우선 참조**

- `docs/OFFLINE_SELF_IMPROVEMENT_PROTOCOL.md`
- `docs/RAG_MAIN_CONSTRUCTION_PLAN.md`
- `docs/ONTOLOGY_GRAPH_MIGRATION_PLAN.md`
- `docs/ONTOLOGY_SYSTEM_DESIGN.md`
- `docs/ONTOLOGY_GRAPH_ASCII.md`
- `docs/NEXT_STEP_ONTOLOGY_HARNESS.md`
- `docs/EXECUTION_FINAL_READINESS.md`

---

## 다음 세션 시작점

우선순위는 아래 순서로 본다.

1. **Ontology evaluation harness 정비**
   - 대표 질문셋 / regression 질문셋 정리
   - 질문 유형별 acceptance criteria 명문화
   - ask/search/self-eval/replay를 동일한 품질 지표로 연결

2. **Ontology governance 정리**
   - extractor / derivation / ranking / gate rule 경계를 문서화
   - core ontology node/edge/action/state 개념을 freeze
   - heuristic pile 방지용 rule registry/정책 분리 방향 정리

3. **Agentic workflow 고도화**
   - exact target trace
   - workflow sequence reconstruction
   - representative scenario synthesis
   - answer self-critique / abstain / retry contract 강화

4. **AST/LSP/config 기반 추출기 판단 및 정비**
   - AST를 주 추출기, LSP를 보조 해석기로 사용하는 방향 재검토
   - 프론트 HTTP 호출 -> gateway -> controller -> service 연결에 필요한 config parser 범위 명확화
   - hard/derived/semantic confidence 계층을 extractor 단계부터 유지

5. **사용자 상호작용 기반 semantic layer 승격**
   - 자유 메모 / 구조화 폼 / CSV / 문서 입력 채널 정교화
   - draft / review / rollback / self-eval을 실제 품질 향상 루프와 연결
   - node / edge / path 검증을 시각화 위에서 수행 가능하게 만들기

6. **오프라인 배포 안정화 / 실행 최종준비**
   - Windows x64 bundle runtime 검증
   - qmd models / wrapper / frontend-backend startup 안정화
   - filesystem artifact 기반 ontology/QMD runtime 반입 절차 점검
   - `docs/EXECUTION_FINAL_READINESS.md` 체크리스트 기준으로 반입 전 확인
