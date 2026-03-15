# ohmyqwen ASCII Architecture

이 문서는 Mermaid 없이도 볼 수 있도록 만든 **ASCII 아키텍처 설계도**다.

---

## 1. 큰 그림

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ohmyqwen Big Picture                                │
└─────────────────────────────────────────────────────────────────────────────┘

   User
     │
     ├──────────────────────────────┐
     │                              │
     ▼                              ▼
┌───────────────┐            ┌──────────────────────┐
│  Console UI   │            │  Direct API Client   │
│ console-next  │            │   curl / scripts     │
└───────┬───────┘            └──────────┬───────────┘
        │                               │
        └──────────────┬────────────────┘
                       ▼
         ┌─────────────────────────────────────┐
         │       ohmyqwen Backend Server       │
         │        src/server/*                 │
         │  - project registry                 │
         │  - analyze / search / ask           │
         │  - run orchestration API            │
         └──────────────┬──────────────────────┘
                        │
        ┌───────────────┼───────────────────────────────┐
        ▼               ▼                               ▼
┌──────────────┐ ┌──────────────┐              ┌──────────────────┐
│ Agent Runtime│ │ Retrieval    │              │   LLM Client      │
│ src/core/*   │ │ src/retrieval│              │   src/llm/*       │
│ src/loop/*   │ │              │              │                  │
└──────┬───────┘ └──────┬───────┘              └────────┬─────────┘
       │                │                                │
       │                ▼                                ▼
       │      ┌──────────────────────┐         ┌──────────────────┐
       │      │ Embedded QMD Runtime │         │ OpenAI-compatible│
       │      │ vendor/qmd + internal│         │   LLM endpoint   │
       │      └──────────┬───────────┘         └──────────────────┘
       │                 │
       ▼                 ▼
┌──────────────┐  ┌──────────────────────┐
│ Run Artifacts│  │ Project Workspaces   │
│ .ohmyqwen/*  │  │ target codebases     │
│ memory/cache │  │ backend/frontend repos│
└──────────────┘  └──────────────────────┘
```

---

## 2. 런타임 상태머신

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Agent Runtime Loop                               │
└─────────────────────────────────────────────────────────────────────────────┘

   ┌──────────┐     ┌──────┐     ┌────────────┐     ┌─────────┐
   │ ANALYZE  │ ──▶ │ PLAN │ ──▶ │ IMPLEMENT  │ ──▶ │ VERIFY  │
   └──────────┘     └──────┘     └────────────┘     └────┬────┘
                                                          │
                                       ┌──────────────────┼──────────────────┐
                                       │                  │                  │
                                       ▼                  ▼                  ▼
                                  ┌────────┐        ┌────────┐         ┌────────┐
                                  │ FINISH │        │ PATCH  │         │  FAIL  │
                                  └────────┘        └────┬───┘         └────────┘
                                                         │
                                                         └──────▶ PLAN
```

핵심:

- LLM은 제안 생성
- 상태 전이와 종료 판정은 런타임이 강제

---

## 3. 프로젝트 분석 / 질문 응답 흐름

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Project Analyze / Search / Ask Flow                     │
└─────────────────────────────────────────────────────────────────────────────┘

 Request
    │
    ▼
┌──────────────────────┐
│ Project Service      │
│ src/server/projects  │
└──────────┬───────────┘
           │
           ├──────────────────────────────────────────────────────────────┐
           │                                                              │
           ▼                                                              ▼
┌──────────────────────┐                                        ┌──────────────────────┐
│ Structure Index      │                                        │  Warmup / Search     │
│ classes/methods/pkg  │                                        │  Retrieval Pipeline   │
└──────────┬───────────┘                                        └──────────┬───────────┘
           │                                                               │
           ├──────────────┐                             ┌───────────────────┼───────────────────┐
           │              │                             │                   │                   │
           ▼              ▼                             ▼                   ▼                   ▼
┌────────────────┐ ┌────────────────┐           ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Front-Back     │ │ EAI Dictionary │           │ QMD Search   │   │ Lexical Fallback│ │ Context Sync │
│ Graph          │ │ usage/callsite │           │ internal     │   │ if needed      │ │ into qmd     │
└────────┬───────┘ └────────┬───────┘           └──────┬───────┘   └──────────────┘   └──────────────┘
         │                  │                           │
         └──────────┬───────┴──────────────┬────────────┘
                    ▼                      ▼
            ┌──────────────────────────────────────┐
            │ Evidence Hydration / Flow Linking    │
            │ - code blocks                        │
            │ - linked flow evidence               │
            │ - linked EAI evidence                │
            │ - learned knowledge matches          │
            └──────────────────┬───────────────────┘
                               ▼
                    ┌──────────────────────────┐
                    │ LLM Answer / Analysis    │
                    │ + Quality Gate           │
                    └──────────────────────────┘
```

---

## 4. Embedded QMD Internal Runtime

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Embedded QMD Internal Runtime                           │
└─────────────────────────────────────────────────────────────────────────────┘

  Retrieval Config
        │
        ▼
┌──────────────────────┐
│ qmd-runtime.ts       │
│ path resolution      │
│ - runtimeRoot        │
│ - vendorRoot         │
│ - modelsDir          │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ qmd-internal.ts      │
│ internal adapter     │
│ - ensureIndexed      │
│ - query/search       │
│ - embedPending       │
│ - syncContexts       │
└──────────┬───────────┘
           │
     ┌─────┼───────────────────────────────────────┐
     │     │                                       │
     ▼     ▼                                       ▼
┌──────────────┐                         ┌──────────────────────┐
│ vendor/qmd   │                         │ App-local qmd state  │
│ dist/runtime │                         │ .ohmyqwen/runtime/   │
│ dist/qmd.js  │                         │ qmd/{models,indexes, │
└──────┬───────┘                         │ cache,config}        │
       │                                 └──────────┬───────────┘
       │                                            │
       └──────────────────────┬─────────────────────┘
                              ▼
                   ┌──────────────────────────┐
                   │ Target Workspace         │
                   │ external project repos   │
                   │ indexed/searched only    │
                   └──────────────────────────┘
```

핵심:

- 외부 `qmd` 명령어가 없어도 동작
- qmd runtime은 앱 내부에 포함
- 프로젝트 코드는 검색 대상일 뿐, qmd runtime 소유 경로가 아님

---

## 5. Front → Back → Downstream 추적 구조

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Cross-Layer Flow Knowledge Graph                         │
└─────────────────────────────────────────────────────────────────────────────┘

  Front Screen / Route
          │
          ▼
  API URL (/gw/api/...)
          │
          ▼
  Gateway / RouteController
          │
          ▼
  Backend Controller
          │
          ▼
  Service Layer
          │
    ┌─────┼─────────────────────────────────────────────┐
    ▼     ▼                ▼                ▼           ▼
  DAO   MyBatis Mapper   Redis            EAI         Async/File
```

이 그래프는 다음에 쓰인다.

- frontend → backend 질문
- 특정 업무 capability 흐름 추적
- 인접 플로우 오탐 방지

---

## 6. 저장 구조

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Storage Layout                                  │
└─────────────────────────────────────────────────────────────────────────────┘

 .ohmyqwen/
 ├─ runs/
 │   └─ <runId>/
 │      ├─ run.json
 │      ├─ state-transitions.jsonl
 │      └─ outputs/*.json
 │
 ├─ server/
 │   ├─ projects.json
 │   └─ project-debug-events.jsonl
 │
 └─ runtime/
     └─ qmd/
         ├─ models/
         ├─ indexes/
         ├─ cache/
         └─ config/


 projectHome/
 ├─ memory/
 │   ├─ project-analysis/
 │   ├─ front-back-graph/
 │   ├─ eai-dictionary/
 │   ├─ learned-knowledge/
 │   └─ domain-maturity/
 └─ .ohmyqwen/cache/
     ├─ context-index.json
     └─ structure-index.v1.json
```

---

## 7. 폐쇄망 Windows x64 배포 구조

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Offline Windows x64 Deployment                           │
└─────────────────────────────────────────────────────────────────────────────┘

                 ┌──────────────────────┐
                 │  GitHub Actions      │
                 │ windows-latest build │
                 └──────────┬───────────┘
                            │
            ┌───────────────┼────────────────┐
            ▼                                ▼
┌────────────────────────┐       ┌────────────────────────┐
│ Backend Bundle         │       │ Frontend Bundle        │
│ - dist                 │       │ - .next                │
│ - config               │       │ - node_modules         │
│ - vendor/qmd/dist      │       │ - public               │
│ - node_modules         │       │ - serve-console.cmd    │
│ - node-runtime(optional)│      │ - node-runtime(optional)│
│ - qmd models(optional) │       └────────────────────────┘
│ - serve-ohmyqwen.cmd   │
└────────────┬───────────┘
             │
             ▼
  Closed Network Windows x64
     ├─ serve-ohmyqwen.cmd
     └─ serve-console.cmd
```

---

## 8. 책임 분리

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Responsibility Split                                │
└─────────────────────────────────────────────────────────────────────────────┘

  LLM
   - plan/answer/classify
   - text generation

  Runtime
   - state transition
   - quality gate
   - retries / failure handling

  QMD
   - indexing
   - search/query/rerank/context

  Server
   - project registry
   - analyze/search/ask API
   - memory and graph orchestration

  UI
   - project management
   - analyze button / ask UI / debug visibility
```
