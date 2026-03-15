# User Flow with QMD (ASCII)

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                     User Flow: "LLM 구조분석" / "질문하기" End-to-End with Embedded QMD                                 │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘


   [사용자]
      │
      │ 1) 웹 UI에서 프로젝트 선택
      │
      ▼
┌──────────────────────────────┐
│ Next.js Console UI           │
│ console-next                 │
│ - 프로젝트 목록/선택         │
│ - LLM 구조분석 버튼          │
│ - 질문 입력/실행             │
│ - 디버그/진행상태 표시       │
└───────────────┬──────────────┘
                │
                │ REST 호출
                ▼
┌──────────────────────────────┐
│ ohmyqwen Backend Server      │
│ src/server/app.ts            │
│ src/server/routes.ts         │
└───────────────┬──────────────┘
                │
                ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                        src/server/projects.ts                                                            │
│  - 프로젝트 로드                                                                                                         │
│  - preset/domain pack 로드                                                                                               │
│  - memory/project home 결정                                                                                              │
│  - analyze / search / ask orchestration                                                                                  │
│  - debug events 기록                                                                                                     │
└───────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                │
                │
        ┌───────┴──────────────────────────────────────────────────────────────────────────────────────────────────┐
        │                                                                                                          │
        │                                                                                                          │
        ▼                                                                                                          ▼
┌──────────────────────────────┐                                                                  ┌──────────────────────────────┐
│ A. "LLM 구조분석"            │                                                                  │ B. "질문하기"                │
│ POST /api/projects/:id/analyze│                                                                 │ POST /api/projects/:id/ask   │
└───────────────┬──────────────┘                                                                  └───────────────┬──────────────┘
                │                                                                                                  │
                │                                                                                                  │
                ▼                                                                                                  ▼
┌──────────────────────────────┐                                                                  ┌──────────────────────────────┐
│ warmupServerProjectIndex()   │                                                                  │ 전략 분류                    │
│ - 파일 수집                  │                                                                  │ decideAskStrategy()          │
│ - retrieval inspect          │                                                                  │ - method_trace              │
│ - provider 상태 기록         │                                                                  │ - module_flow_topdown       │
└───────────────┬──────────────┘                                                                  │ - cross_layer_flow          │
                │                                                                                  │ - architecture_overview     │
                │                                                                                  └───────────────┬──────────────┘
                ▼                                                                                                  │
┌──────────────────────────────┐                                                                                  │
│ Structure Index Build        │                                                                                  │
│ buildProjectStructureIndex() │                                                                                  │
│ - 파일 파싱                  │                                                                                  │
│ - package/class/method 추출  │                                                                                  │
│ - structure snapshot 생성    │                                                                                  │
└───────────────┬──────────────┘                                                                                  │
                │                                                                                                  │
                ├──────────────────────────────────────────────────────────────────────────────┐                   │
                │                                                                              │                   │
                ▼                                                                              ▼                   ▼
┌──────────────────────────────┐                                         ┌──────────────────────────────┐ ┌──────────────────────────────┐
│ Front-Back Graph Build       │                                         │ EAI Dictionary Build         │ │ 분석 스냅샷/메모리 로드      │
│ buildFrontBackGraph()        │                                         │ buildEaiDictionaryEntries()  │ │ - structure snapshot         │
│ - Vue route                  │                                         │ - interface XML              │ │ - project-analysis/latest    │
│ - 화면 코드/route            │                                         │ - usage path                 │ │ - learned knowledge          │
│ - API URL (/gw/api/...)      │                                         │ - java call sites            │ │ - front-back graph           │
│ - backend route/controller   │                                         └───────────────┬──────────────┘ │ - EAI dictionary             │
│ - flow links                 │                                                         │                └───────────────┬──────────────┘
└───────────────┬──────────────┘                                                         │                                │
                │                                                                        │                                │
                ▼                                                                        ▼                                │
┌──────────────────────────────┐                                         ┌──────────────────────────────┐               │
│ Learned Knowledge Build      │                                         │ Project QMD Context Payload  │               │
│ computeLearnedKnowledgeSnapshot()                                      │ buildProjectQmdContextPayload│               │
│ - domain/module/process 후보 │                                         │ - summary                    │               │
│ - candidate/validated 상태   │                                         │ - domains                    │               │
└───────────────┬──────────────┘                                         │ - graph/eai/knowledge        │               │
                │                                                        └───────────────┬──────────────┘               │
                │                                                                        │                              │
                │                                                                        ▼                              │
                │                                                        ┌──────────────────────────────────────────┐   │
                │                                                        │ Embedded QMD Context Sync                │   │
                │                                                        │ syncInternalQmdContexts()                │   │
                │                                                        │ - corpus별 collection context 반영       │   │
                │                                                        └──────────────────────────────────────────┘   │
                │                                                                                                       │
                └──────────────────────────────────────────────────────────────────────────────┐                        │
                                                                                               │                        │
                                                                                               ▼                        ▼
                                                                                ┌────────────────────────────────────────────────────┐
                                                                                │                 Embedded QMD Runtime              │
                                                                                │                 src/retrieval/* + vendor/qmd      │
                                                                                └────────────────────────────────────────────────────┘
                                                                                               │
                                                                                               │ runtime path resolution
                                                                                               ▼
                                                                                ┌──────────────────────────────┐
                                                                                │ qmd-runtime.ts              │
                                                                                │ - runtimeRoot               │
                                                                                │ - vendorRoot                │
                                                                                │ - modelsDir                 │
                                                                                │ - cache/config/index paths  │
                                                                                └───────────────┬──────────────┘
                                                                                                │
                                                                                                ▼
                                                                                ┌──────────────────────────────┐
                                                                                │ qmd-internal.ts             │
                                                                                │ - ensureInternalQmdIndexed  │
                                                                                │ - queryInternalQmd          │
                                                                                │ - syncInternalQmdContexts   │
                                                                                └───────────────┬──────────────┘
                                                                                                │
                ┌───────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────┐
                │                                                                               │                                                       │
                ▼                                                                               ▼                                                       ▼
┌──────────────────────────────┐                                         ┌──────────────────────────────┐                           ┌──────────────────────────────┐
│ vendor/qmd/dist/runtime.js   │                                         │ .ohmyqwen/runtime/qmd       │                           │ Target Project Workspace     │
│ - vendored internal runtime  │                                         │ - models                    │                           │ - external repo             │
│ - no external qmd command    │                                         │ - indexes                   │                           │ - backend/frontend code     │
└──────────────────────────────┘                                         │ - cache                     │                           │ - indexed/search 대상만     │
                                                                          │ - config                    │                           └──────────────────────────────┘
                                                                          └──────────────────────────────┘


========================================================================================================================================================
ANALYZE BRANCH CONTINUES
========================================================================================================================================================

                ┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
                │ Seed Retrieval for Analysis                                                                                                 │
                │ searchServerProject()/runQmdMultiCorpusSearch()                                                                            │
                │ - corpus planning                                                                                                           │
                │ - ensure indexed                                                                                                            │
                │ - query/search                                                                                                              │
                │ - hit postprocess                                                                                                           │
                └───────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                ┌──────────────────────────────┐
                │ LLM 구조분석 생성            │
                │ OpenAICompatibleLlmClient    │
                │ generateStructured()         │
                │ - summary                    │
                │ - architecture               │
                │ - keyModules                 │
                │ - risks                      │
                │ - confidence                 │
                └───────────────┬──────────────┘
                                │
                                ▼
                ┌──────────────────────────────┐
                │ 분석 결과 저장               │
                │ memory/project-analysis      │
                │ memory/front-back-graph      │
                │ memory/eai-dictionary        │
                │ memory/learned-knowledge     │
                │ memory/domain-maturity       │
                └───────────────┬──────────────┘
                                │
                                ▼
                ┌──────────────────────────────┐
                │ UI로 분석 결과 반환          │
                │ - summary                    │
                │ - key modules                │
                │ - EAI                        │
                │ - graph                      │
                │ - maturity                   │
                └──────────────────────────────┘


========================================================================================================================================================
ASK BRANCH CONTINUES
========================================================================================================================================================

                ┌──────────────────────────────┐
                │ 질문 capability/domain 해석  │
                │ - domain packs               │
                │ - learned knowledge match    │
                │ - lock/auto mode             │
                └───────────────┬──────────────┘
                                │
                                ▼
                ┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
                │ QMD Multi-Corpus Search                                                                                                     │
                │ runQmdMultiCorpusSearch()                                                                                                   │
                │                                                                                                                             │
                │  1) corpus planning                                                                                                         │
                │     - backend-code                                                                                                          │
                │     - frontend-code                                                                                                         │
                │     - config-xml                                                                                                            │
                │     - docs-memory                                                                                                           │
                │                                                                                                                             │
                │  2) query planning                                                                                                          │
                │     - original question                                                                                                     │
                │     - capability/domain terms                                                                                               │
                │     - learned knowledge priors                                                                                              │
                │                                                                                                                             │
                │  3) internal qmd query/search                                                                                               │
                │                                                                                                                             │
                │  4) hit postprocess / rerank                                                                                                │
                │     - corpus weight                                                                                                         │
                │     - module/path bias                                                                                                      │
                │     - domain/subdomain alignment                                                                                            │
                └───────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                ┌──────────────────────────────┐
                │ Evidence Hydration           │
                │ - top hit code blocks        │
                │ - method bodies              │
                │ - controller->service        │
                │ - front-back linked flows    │
                │ - linked EAI evidence        │
                │ - downstream traces          │
                └───────────────┬──────────────┘
                                │
                                ▼
                ┌──────────────────────────────┐
                │ Deterministic answer attempt │
                │ - method trace               │
                │ - cross-layer flow           │
                │ - domain/capability gate     │
                └───────────────┬──────────────┘
                                │
                ├──────────────────────────────┐
                                │              │
                                │ pass         │ fail / low confidence
                                ▼              ▼
                ┌──────────────────────┐   ┌──────────────────────────────┐
                │ 즉시 응답 반환       │   │ LLM answer generation        │
                │ deterministic answer │   │ generateStructured()         │
                └───────────┬──────────┘   │ - answer                     │
                            │              │ - confidence                 │
                            │              │ - evidence                   │
                            │              │ - caveats                    │
                            │              └───────────────┬──────────────┘
                            │                              │
                            │                              ▼
                            │              ┌──────────────────────────────┐
                            │              │ Quality Gate / Retry Loop    │
                            │              │ - evidence delta 비교        │
                            │              │ - confidence gain 확인       │
                            │              │ - maxAttempts <= 5           │
                            │              └───────────────┬──────────────┘
                            │                              │
                            └──────────────┬───────────────┘
                                           ▼
                             ┌──────────────────────────────┐
                             │ 최종 Ask 응답 반환               │
                             │ - answer                     │
                             │ - confidence                │
                             │ - qualityGatePassed         │
                             │ - llmCalls                  │
                             │ - strategy                  │
                             │ - matchedDomains            │
                             │ - linked flow/EAI counts    │
                             └──────────────────────────────┘
```

---

## QMD 내부 검색 파이프라인 상세

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              Embedded QMD Search / Query / Re-rank Internals                                   │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

                                        Ask / Analyze Search Request
                                                      │
                                                      ▼
                                      ┌──────────────────────────────┐
                                      │ runQmdMultiCorpusSearch()    │
                                      │ src/retrieval/qmd-search.ts  │
                                      └───────────────┬──────────────┘
                                                      │
                                                      ▼
                                      ┌──────────────────────────────┐
                                      │ Corpus Planning              │
                                      │ qmd-corpora.ts               │
                                      │ - backend-code               │
                                      │ - frontend-code              │
                                      │ - config-xml                 │
                                      │ - docs-memory                │
                                      └───────────────┬──────────────┘
                                                      │
                                                      ▼
                                      ┌──────────────────────────────┐
                                      │ Query Planning               │
                                      │ qmd-planner.ts               │
                                      │ - original question          │
                                      │ - domain/subdomain terms     │
                                      │ - learned knowledge priors   │
                                      │ - module/symbol terms        │
                                      │ - expanded query candidates  │
                                      └───────────────┬──────────────┘
                                                      │
                                                      ▼
                                      ┌──────────────────────────────┐
                                      │ ensureInternalQmdIndexed()   │
                                      │ qmd-internal.ts              │
                                      └───────────────┬──────────────┘
                                                      │
     ┌────────────────────────────────────────────────┼─────────────────────────────────────────────────┐
     │                                                │                                                 │
     ▼                                                ▼                                                 ▼
┌───────────┐                             ┌──────────────────────┐                           ┌──────────────────────┐
│ BM25/FTS  │                             │ Vector / Embedding   │                           │ Context Sync         │
│ SQLite FTS│                             │ sqlite-vec + embed   │                           │ global + path ctx    │
│ lexical   │                             │ dense retrieval      │                           │ project knowledge    │
└─────┬─────┘                             └──────────┬───────────┘                           └──────────┬───────────┘
      │                                              │                                                  │
      │                                              │                                                  │
      │          ┌───────────────────────────────────┴────────────────────────────┐                     │
      │          ▼                                                                ▼                     │
      │  ┌──────────────────────┐                                      ┌──────────────────────┐         │
      │  │ Embed Model          │                                      │ Query Expansion Model│         │
      │  │ embeddinggemma-300M  │                                      │ qmd-query-expansion  │         │
      │  │ Q8_0 GGUF            │                                      │ 1.7B q4_k_m GGUF     │         │
      │  └──────────────────────┘                                      └──────────────────────┘         │
      │                                                                                                 │
      └──────────────────────────────────────────────┬──────────────────────────────────────────────────┘
                                                     ▼
                                      ┌────────────────────────────────┐
                                      │ RRF Fusion + Bonus             │
                                      │ vendor/qmd hybridQuery()       │
                                      │ - BM25 + vector result lists   │
                                      │ - original query lists x2      │
                                      │ - expanded query lists merge   │
                                      │ - top-rank bonus               │
                                      │ - top candidate slice          │
                                      └───────────────┬────────────────┘
                                                      │
                                                      ▼
                                      ┌────────────────────────────────┐
                                      │ Re-ranker                      │
                                      │ qwen3-reranker-0.6b            │
                                      │ Q8_0 GGUF                      │
                                      │ - candidate re-score           │
                                      │ - final ordering               │
                                      └───────────────┬────────────────┘
                                                      │
                                                      ▼
                                      ┌────────────────────────────────┐
                                      │ Position-Aware Blend           │
                                      │ vendor/qmd hybridQuery()       │
                                      │ - top 1~3:  retrieval 보호      │
                                      │ - top 4~10: balanced mix       │
                                      │ - top 11+: reranker 비중 증가    │
                                      └───────────────┬────────────────┘
                                                      │
                                                      ▼
                                      ┌────────────────────────────────┐
                                      │ queryRuntime() output          │
                                      │ - path                         │
                                      │ - score                        │
                                      │ - title/context/snippet        │
                                      └───────────────┬────────────────┘
                                                      │
                                                      ▼
                                      ┌────────────────────────────────┐
                                      │ postprocessQmdHits()           │
                                      │ scoreQmdHit()                  │
                                      │ app-level rerank/bias          │
                                      └───────────────┬────────────────┘
                                                      ▼
                                           Final Retrieval Hits
```

### 현재 내부 모델 파일

```text
.ohmyqwen/runtime/qmd/models/
├─ embeddinggemma-300M-Q8_0.gguf
├─ qwen3-reranker-0.6b-q8_0.gguf
└─ qmd-query-expansion-1.7B-q4_k_m.gguf
```

### 역할 분리

```text
BM25 / FTS
  - exact token / symbol / path 검색
  - 빠른 lexical retrieval

Vector / Embed
  - 질문과 코드/문서의 semantic 유사도 검색
  - dense retrieval

Query Expansion
  - 원 질문을 qmd 친화 query로 확장
  - domain/subdomain 용어 보강

Re-ranker
  - lexical/vector 후보를 다시 정렬
  - 최종 상위 hit 품질 향상

Fusion / Blend
  - BM25 + vector + expanded query 결과를 RRF로 결합
  - original query 결과를 더 강하게 보존
  - reranker 점수와 retrieval 순위를 위치 기반으로 혼합
```
