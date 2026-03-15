# QMD Full Internal Migration - Windows x64 Offline

## 목적

`ohmyqwen`의 qmd 의존을 외부 CLI 설치에서 내부 런타임 포함 방식으로 전환한다.

최종 목표:

- 외부 `qmd` 설치 불필요
- Windows x64 폐쇄망 환경에서 실행
- Node.js 런타임 포함 번들로 반입
- qmd의 FTS / vector / query expansion / rerank / context 기능을 내부에서 직접 사용
- 네트워크 없이 로컬 GGUF 모델만 사용

## 현재 상태

- 현재 기본 통합은 **internal-runtime** 이다.
- 외부 CLI는 호환/회귀 테스트용으로만 남아 있으며, 기본 경로는 `src/retrieval/qmd-internal.ts` + `vendor/qmd/dist/runtime.js`를 사용한다.
- 런타임 경로는 app-owned `.ohmyqwen/runtime/qmd/*` 아래로 고정한다.
- qmd 원본은 `vendor/qmd/`로 프로젝트 내부에 포함했다.
  - upstream source: `40610c3aa65d9d399ebb188a7e4930f6628ae51c`

## 왜 full migration이 필요한가

현재 구조는 다음 한계를 가진다.

1. ask/analyze 전 경로에서 incremental embed / context sync / rerank 활용을 더 일반화해야 함
2. broad query에서 search 편향을 줄이고 full query pipeline 활용도를 높여야 함
3. Windows x64 폐쇄망 번들 smoke test 자동화를 더 강화해야 함

## 타깃 아키텍처

### 1. 내부 런타임

- `vendor/qmd/` : upstream snapshot
- `src/retrieval/qmd-runtime.ts` : app 내부에서 사용할 런타임 경로 계약
- `src/retrieval/qmd-internal.ts` : internal runtime adapter
- `src/retrieval/qmd-cli.ts` : external CLI 호환/회귀용 adapter

### 2. 오프라인 런타임 루트

앱 루트 하위 고정:

- `.ohmyqwen/runtime/qmd/config`
- `.ohmyqwen/runtime/qmd/cache`
- `.ohmyqwen/runtime/qmd/indexes`
- `.ohmyqwen/runtime/qmd/models`

홈 디렉토리(`~/.cache/qmd`, `~/.config/qmd`) 기본값을 쓰지 않도록 전환한다.

### 3. 모델 정책

기본 정책은 `offlineStrict=true` 전제다.

- HuggingFace pull 금지
- 로컬 GGUF 파일만 사용
- 배포 번들에 모델 포함

필수 모델:

- embedding model
- reranker model
- query-expansion model

## Windows x64 제약

이 migration은 **Windows x64 전용 최종 패키징**을 기준으로 설계한다.

### 네이티브 종속성

- `better-sqlite3`
- `sqlite-vec`
- `node-llama-cpp`

따라서 최종 번들은 Windows x64에서 빌드하거나, 동일 ABI 기준으로 준비해야 한다.

### 실행 기준

폐쇄망 반입물은 다음을 포함해야 한다.

- Node.js runtime
- app dist
- Windows x64용 native `node_modules`
- qmd runtime source/dist
- GGUF 모델 파일

## 단계별 작업

### Phase 1. Vendoring & Runtime Contract

- [x] qmd source vendoring
- [x] qmd runtime/offline/windows 설정 surface 추가
- [x] 내부 런타임 adapter 구현
- [x] local GGUF model path override surface 추가

### Phase 2. Internal API Migration

- [x] `spawn("qmd", ...)` 제거를 기본 경로로 승격
- [x] `createStore / hybridQuery / vectorSearchQuery` 직접 호출 경로 추가
- [x] internal status / index / embed API 기본 경로 정리

### Phase 3. Offline Hardening

- [x] local model path override surface 추가
- [x] offline strict validation 추가
- [ ] vendor/qmd 내부 기본 model URI를 local-model-first 기준으로 더 정리

### Phase 4. Lifecycle Integration

- [x] analyze/search 경로에서 internal runtime index/update/embed 호출 가능
- [ ] ask 시 incremental update/embed
- [x] qmd context sync (project profile, learned knowledge, domain packs) 기본 wiring 추가

### Phase 5. Windows Bundle

- [x] Windows x64 GitHub Actions 빌드 파이프라인
- [x] 번들/런타임 검증 스크립트 추가
- [ ] 폐쇄망 smoke test 자동화 / 실행 리포트 정리

## 설정 키

신규 `config/retrieval.json` qmd 필드:

- `integrationMode`
- `offlineStrict`
- `targetPlatform`
- `runtimeRoot`
- `vendorRoot`
- `modelsDir`
- `embedModelPath`
- `rerankModelPath`
- `generateModelPath`

대응 env:

- `OHMYQWEN_QMD_INTEGRATION_MODE`
- `OHMYQWEN_QMD_OFFLINE_STRICT`
- `OHMYQWEN_QMD_TARGET_PLATFORM`
- `OHMYQWEN_QMD_RUNTIME_ROOT`
- `OHMYQWEN_QMD_VENDOR_ROOT`
- `OHMYQWEN_QMD_MODELS_DIR`
- `OHMYQWEN_QMD_EMBED_MODEL_PATH`
- `OHMYQWEN_QMD_RERANK_MODEL_PATH`
- `OHMYQWEN_QMD_GENERATE_MODEL_PATH`

## 번들링 메모

- mac/Linux 개발 중에는 `scripts/bundle-offline.sh`
- Windows x64 배포물 생성용으로는 `scripts/bundle-offline-win64.ps1`

Windows 최종 산출물은 반드시 Windows x64 환경에서 설치된 native 모듈과 함께 생성해야 한다.

선택적으로 `OHMYQWEN_NODE_RUNTIME_DIR`를 지정하면 번들에 Node 런타임까지 포함시킬 수 있다.

검증 명령:

- `pnpm qmd:health`
- `pnpm verify:offline:win64`

GitHub Actions:

- workflow: `.github/workflows/win64-offline-bundle.yml`
- manual trigger: `Actions -> win64-offline-bundle -> Run workflow`
- 기본값은 `require_models=false` 이므로 모델 없이도 Windows x64 빌드/패키징 경로를 점검할 수 있다.
- 모델까지 포함해 full query/rerank readiness를 확인하려면 모델 파일을 repo 또는 runner 작업공간에 준비한 뒤 `require_models=true`로 실행한다.

## 원칙

1. 외부 설치 의존 제거
2. 홈 디렉토리 기본 경로 제거
3. 네트워크 의존 제거
4. Windows x64 패키징 우선
5. qmd full 기능 활용을 전제로 통합
