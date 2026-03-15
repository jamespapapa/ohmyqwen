# Big Picture Architecture Diagrams

이 문서는 `ohmyqwen`의 큰 그림을 빠르게 파악하기 위한 다이어그램 모음이다.

---

## 1. System Context

```mermaid
flowchart TB
  User[User / Operator]
  Frontend[Console UI<br/>console-next]
  Backend[ohmyqwen Backend<br/>src/server]
  Runtime[Agent Runtime<br/>src/core + src/loop]
  Retrieval[Retrieval Layer<br/>src/retrieval]
  QMD[Embedded QMD Runtime<br/>vendor/qmd]
  LLM[LLM Endpoint<br/>OpenAI-compatible]
  Project[Target Projects<br/>backend / frontend repos]
  Memory[Artifacts / Memory / Cache<br/>.ohmyqwen + project memory]

  User --> Frontend
  User --> Backend
  Frontend -->|REST| Backend
  Backend --> Runtime
  Backend --> Retrieval
  Retrieval --> QMD
  QMD --> Project
  Backend --> LLM
  Runtime --> LLM
  Backend --> Memory
  Runtime --> Memory
```

---

## 2. Runtime Control Loop

```mermaid
flowchart LR
  ANALYZE --> PLAN --> IMPLEMENT --> VERIFY
  VERIFY -->|pass| FINISH
  VERIFY -->|fixable| PATCH
  PATCH --> PLAN
  VERIFY -->|unrecoverable| FAIL
```

핵심 특징:

- LLM은 제안 생성 담당
- 최종 상태 전이와 품질 판정은 런타임이 강제

---

## 3. Project Analysis / Ask Flow

```mermaid
flowchart TB
  Request[Analyze / Search / Ask Request]
  ProjectSvc[Project Service<br/>src/server/projects.ts]
  Structure[Structure Index]
  Graph[Front-Back Graph]
  EAI[EAI Dictionary]
  Knowledge[Learned Knowledge]
  Search[QMD + Lexical Retrieval]
  Hydrate[Evidence Hydration]
  Answer[Analysis / Answer]

  Request --> ProjectSvc
  ProjectSvc --> Structure
  ProjectSvc --> Graph
  ProjectSvc --> EAI
  ProjectSvc --> Knowledge
  ProjectSvc --> Search
  Search --> Hydrate
  Structure --> Hydrate
  Graph --> Hydrate
  EAI --> Hydrate
  Knowledge --> Hydrate
  Hydrate --> Answer
```

---

## 4. Embedded QMD Internal Architecture

```mermaid
flowchart TB
  RetrievalConfig[Retrieval Config]
  RuntimeResolver[qmd-runtime.ts<br/>path resolution]
  InternalAdapter[qmd-internal.ts<br/>internal adapter]
  VendorRuntime[vendor/qmd/dist/runtime.js]
  Models[Local GGUF Models]
  IndexState[App-local indexes / cache / config]
  Workspace[Target Workspace]
  ContextSync[QMD Context Sync]

  RetrievalConfig --> RuntimeResolver
  RuntimeResolver --> InternalAdapter
  InternalAdapter --> VendorRuntime
  InternalAdapter --> Models
  InternalAdapter --> IndexState
  InternalAdapter --> Workspace
  InternalAdapter --> ContextSync
```

핵심 원칙:

- 외부 `qmd` 명령 의존 제거
- `vendor/qmd`를 내부 런타임으로 사용
- 프로젝트 workspace와 qmd runtime 디렉토리 분리

---

## 5. Cross-Layer Knowledge Graph

```mermaid
flowchart LR
  Screen[Frontend Screen / Route]
  Api[API URL]
  Gateway[Gateway Route]
  Controller[Controller]
  Service[Service]
  Downstream[DAO / Redis / EAI / Async]

  Screen --> Api --> Gateway --> Controller --> Service --> Downstream
```

이 그래프를 바탕으로:

- front → back 흐름 추적
- EAI 연결
- capability/domain 추론
- 질문 응답 근거 강화

---

## 6. Storage Layout

```mermaid
flowchart TB
  ServerStore[".ohmyqwen/server"]
  RunStore[".ohmyqwen/runs"]
  QmdStore[".ohmyqwen/runtime/qmd"]
  ProjectHome["project home / memory"]

  ServerStore --> ProjectsJson[projects.json]
  ServerStore --> DebugLogs[project-debug-events.jsonl]

  RunStore --> RunJson[run.json]
  RunStore --> Transitions[state-transitions.jsonl]
  RunStore --> Outputs[outputs/*.json]

  QmdStore --> ModelsDir[models]
  QmdStore --> IndexesDir[indexes]
  QmdStore --> CacheDir[cache]
  QmdStore --> ConfigDir[config]

  ProjectHome --> StructureSnapshot[structure-index]
  ProjectHome --> Analysis[project-analysis]
  ProjectHome --> FrontBack[front-back-graph]
  ProjectHome --> EaiMemory[eai-dictionary]
  ProjectHome --> Learned[learned-knowledge]
```

---

## 7. Offline Windows x64 Deployment

```mermaid
flowchart TB
  ArtifactBackend[Backend Bundle]
  ArtifactFrontend[Frontend Bundle]
  NodeRuntime[Bundled Node Runtime]
  Models[GGUF Models]
  LlmProxy[Internal / Local LLM Endpoint]
  User[Closed Network User]

  User --> ArtifactFrontend
  User --> ArtifactBackend
  ArtifactBackend --> NodeRuntime
  ArtifactFrontend --> NodeRuntime
  ArtifactBackend --> Models
  ArtifactBackend --> LlmProxy
```

실행 기준:

- backend: `serve-ohmyqwen.cmd`
- frontend: `serve-console.cmd`

---

## 8. Separation of Responsibilities

```mermaid
flowchart LR
  LLM[LLM]
  Runtime[Runtime]
  QMD[QMD]
  UI[UI]

  LLM -->|plan / classify / answer| Runtime
  Runtime -->|state transition / quality gate| LLM
  QMD -->|index / retrieve / context sync| Runtime
  UI -->|project management / analyze / ask| Runtime
```

정리:

- **LLM**: 생성
- **Runtime**: 통제/검증
- **QMD**: 검색/색인
- **UI**: 운영 인터페이스
