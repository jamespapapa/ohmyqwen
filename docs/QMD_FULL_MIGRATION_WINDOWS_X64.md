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

- 현재 통합은 `src/retrieval/qmd-cli.ts` 기반 외부 프로세스 호출이다.
- 실제 사용은 `search` 중심이며, `embed`, `context`, 장기 세션형 `query` 파이프라인은 온전히 활용하지 못한다.
- qmd 원본은 `vendor/qmd/`로 프로젝트 내부에 포함했다.
  - upstream source: `40610c3aa65d9d399ebb188a7e4930f6628ae51c`

## 왜 full migration이 필요한가

현재 구조는 다음 한계를 가진다.

1. 외부 실행파일 설치 필요
2. subprocess 기반이라 모델/session 재사용이 약함
3. `qmd embed` lifecycle 미통합
4. qmd context tree 미활용
5. Windows x64 폐쇄망 번들링 기준이 아직 없음

## 타깃 아키텍처

### 1. 내부 런타임

- `vendor/qmd/` : upstream snapshot
- `src/retrieval/qmd-runtime.ts` : app 내부에서 사용할 런타임 경로 계약
- 이후 단계에서 `src/retrieval/qmd-cli.ts`는 `src/retrieval/qmd-internal.ts`로 대체

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
- [ ] 내부 런타임 adapter 구현

### Phase 2. Internal API Migration

- [ ] `spawn("qmd", ...)` 제거
- [ ] `createStore / hybridQuery / structuredSearch / vectorSearchQuery` 직접 호출
- [ ] internal status / index / embed API 정리

### Phase 3. Offline Hardening

- [ ] `hf:` URI 제거 또는 override
- [ ] local model manifest 도입
- [ ] offline strict validation 추가

### Phase 4. Lifecycle Integration

- [ ] analyze 시 index/update/embed 포함
- [ ] ask 시 incremental update/embed
- [ ] qmd context sync (project profile, learned knowledge, domain packs)

### Phase 5. Windows Bundle

- [ ] Windows x64 빌드 파이프라인
- [ ] 번들 검증 스크립트
- [ ] 폐쇄망 smoke test

## 설정 키

신규 `config/retrieval.json` qmd 필드:

- `integrationMode`
- `offlineStrict`
- `targetPlatform`
- `runtimeRoot`
- `vendorRoot`
- `modelsDir`

대응 env:

- `OHMYQWEN_QMD_INTEGRATION_MODE`
- `OHMYQWEN_QMD_OFFLINE_STRICT`
- `OHMYQWEN_QMD_TARGET_PLATFORM`
- `OHMYQWEN_QMD_RUNTIME_ROOT`
- `OHMYQWEN_QMD_VENDOR_ROOT`
- `OHMYQWEN_QMD_MODELS_DIR`

## 원칙

1. 외부 설치 의존 제거
2. 홈 디렉토리 기본 경로 제거
3. 네트워크 의존 제거
4. Windows x64 패키징 우선
5. qmd full 기능 활용을 전제로 통합
