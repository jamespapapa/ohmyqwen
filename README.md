# ohmyqwen (v0.1.0-alpha)

폐쇄망 환경에서 Qwen3 계열 모델을 **상태머신 제어** 하에 안전하게 사용하는 로컬 에이전틱 코딩 런타임입니다.

핵심 원칙:

- 모델은 제안만 수행, 최종 제어는 런타임이 보유
- `ANALYZE -> PLAN -> IMPLEMENT -> VERIFY -> (FINISH | PATCH | FAIL)` 강제
- `build -> test -> lint` 품질게이트 통과 전 `FINISH` 금지
- 실패/중단 시에도 run 상태와 아티팩트 보존

## 5분 시작 가이드

```bash
pnpm install
pnpm build
```

기본 실행:

```bash
pnpm run run -- --input ./samples/request.e2e.json
```

품질게이트만 실행:

```bash
pnpm run verify
```

localhost 콘솔:

```bash
pnpm run serve
# http://127.0.0.1:4311
```

Next.js 콘솔(UI):

```bash
pnpm --dir console-next install
pnpm run ui:dev
# http://127.0.0.1:3000
```

## 환경변수

`.env.example` 참고.
CLI는 현재 작업 디렉토리의 `.env`를 자동 로드합니다(이미 export된 값은 덮어쓰지 않음).

LLM (OpenAI-compatible):

- `OHMYQWEN_LLM_BASE_URL`
- `OHMYQWEN_LLM_MODEL`
- `OHMYQWEN_LLM_API_KEY` (옵션, Bearer)
- `OHMYQWEN_LLM_BASIC_AUTH` (옵션, `user:password` 또는 `user/password`)
- `OHMYQWEN_LLM_BASIC_AUTH_USER` / `OHMYQWEN_LLM_BASIC_AUTH_PASSWORD` (옵션)
- `OHMYQWEN_LLM_ENDPOINT_KIND` (옵션: `auto` | `openai` | `opencode`)
- `OHMYQWEN_AVAILABLE_LIBRARIES_URL` (옵션: available library 파일이 없을 때 fallback fetch URL)

Retrieval / Local Embedding (옵션):

- `OHMYQWEN_RETRIEVAL_PROVIDERS` (예: `qmd,hybrid,lexical,semantic`)
- `OHMYQWEN_RETRIEVAL_STAGE_CAP_PLAN`
- `OHMYQWEN_RETRIEVAL_STAGE_CAP_IMPLEMENT`
- `OHMYQWEN_RETRIEVAL_STAGE_CAP_VERIFY`
- `OHMYQWEN_CONTEXT_CHUNK_VERSION`
- `OHMYQWEN_RETRIEVAL_VERSION`
- `OHMYQWEN_REINDEX_ON_STALE`
- `OHMYQWEN_QMD_ENABLED`
- `OHMYQWEN_QMD_COMMAND` (기본: `qmd`)
- `OHMYQWEN_QMD_QUERY_MODE` (`query_then_search` | `search_only` | `query_only`)
- `OHMYQWEN_QMD_COLLECTION`
- `OHMYQWEN_QMD_MASK`
- `OHMYQWEN_QMD_SYNC_INTERVAL_MS`
- `OHMYQWEN_QMD_CONFIG_DIR` / `OHMYQWEN_QMD_CACHE_HOME` / `OHMYQWEN_QMD_INDEX_PATH`
- `OHMYQWEN_PROJECT_HOME` (옵션: memory 루트 기준이 되는 프로젝트 홈)
- `OHMYQWEN_MEMORY_HOME` (옵션: 기본 `memory`, 프로젝트 홈 기준 상대경로 또는 절대경로)
- `OHMYQWEN_EMBEDDING_ENABLED`
- `OHMYQWEN_EMBEDDING_ENDPOINT`
- `OHMYQWEN_EMBEDDING_HEALTH_PATH`
- `OHMYQWEN_EMBEDDING_EMBED_PATH`
- `OHMYQWEN_EMBEDDING_MODEL`
- `OHMYQWEN_EMBEDDING_TIMEOUT_MS`

미설정 시 fallback 모드로 안전 동작.

`qmd` CLI가 설치되어 있으면 QMD provider가 실제로 다음을 수행합니다.
- workspace collection/index 자동 생성/증분 update
- `qmd query`(실패 시 `qmd search`) 호출
- 결과를 runtime 공통 RetrievalHit으로 정규화

Web UI 프로젝트 모드에서는:
- 프로젝트 인덱싱 + LLM 구조 분석(`/api/projects/:id/analyze`)
- memory markdown 저장(`memory/project-analysis/*.md`, `memory/query-reports/*.md`)
- 프로젝트 프리셋 컨텍스트 자동 주입(예: `dcp-services`, `memory/project-profile/*.md`)
- EAI 인터페이스 사전 자동 생성(`memory/eai-dictionary/latest.md`, `latest.json`)
- 검색 결과 파일 상세 조회(`/api/projects/:id/file`)
- 프로젝트 질의응답 + confidence 반환(`/api/projects/:id/ask`)

참고: `opencode serve`를 LLM 백엔드로 사용할 때는 다음처럼 설정:

```env
OHMYQWEN_LLM_BASE_URL=http://localhost:4096
OHMYQWEN_LLM_MODEL=openai/gpt-5.2
OHMYQWEN_LLM_ENDPOINT_KIND=opencode
OHMYQWEN_LLM_BASIC_AUTH=opencode/mypassword
```

플러그인(GitLab 로그, 옵션):

- `OHMYQWEN_GITLAB_BASE_URL`
- `OHMYQWEN_GITLAB_PROJECT_ID`
- `OHMYQWEN_GITLAB_TOKEN`

미설정 시 자동 비활성(경고만 기록).

## CLI

```bash
# 전체 루프
pnpm run run -- --input ./samples/request.e2e.json

# run 재개
pnpm run run -- --resume <runId> --input ./samples/request.e2e.json

# mode 강제 지정
pnpm run run -- --mode feature --input ./samples/request.e2e.json

# dry-run (쓰기/패치/명령 시뮬레이션)
pnpm run run -- --dry-run --input ./samples/request.e2e.json

# PLAN만
pnpm run plan -- --input ./samples/request.e2e.json

# VERIFY만 (프로파일)
pnpm run verify -- --profile strict

# 컨텍스트 선택 결과 점검
node dist/cli.js context inspect --task "fix verify" --files "src/loop/runner.ts,src/gates/verify.ts" --tier mid --budget 1600 --stage PLAN

# 인덱스/리트리버 진단 + 재인덱싱
node dist/cli.js context doctor
node dist/cli.js context doctor --reindex

# retrieval 평가 하네스
pnpm eval:retrieval

# localhost API + 웹 콘솔
pnpm run serve

# Next.js UI
pnpm --dir console-next install
pnpm run ui:dev
```

## localhost Runtime API

- `POST /api/runs` (task/mode 입력으로 백그라운드 run 시작)
- `GET /api/runs/:id`
- `GET /api/runs/:id/events`
- `GET /api/runs/:id/artifacts`

`POST /api/runs`에서 의존성 allowlist 입력을 지원:

- `availableLibraries: string[]` (직접 전달)
- `availableLibrariesFile: string` (워크스페이스 기준 파일 경로)
- `availableLibrariesUrl: string` (파일 미존재 시 fallback fetch URL)
- `retrieval: object` (provider 우선순위, stage token cap, 로컬 임베딩 endpoint/모델, lifecycle 정책 override)

파일 자동 탐색 순서(입력 미지정 시):

- `.ohmyqwen/available-libraries.json`
- `.ohmyqwen/available-libraries.txt`
- `config/available-libraries.json`
- `config/available-libraries.txt`
- `available-libraries.json`
- `available-libraries.txt`

웹 콘솔(기본): `web/index.html`, `web/app.js`  
웹 콘솔(Next.js): `console-next/`

Next.js UI 실행 순서:

1) 터미널 A: 런타임 API 서버
```bash
pnpm run serve
```
2) 터미널 B: Next.js 콘솔
```bash
pnpm --dir console-next install
pnpm run ui:dev
```

브라우저에서 `http://127.0.0.1:3000` 접속.

## Run 내구성/복구

각 실행은 `.ohmyqwen/runs/<runId>/`에 저장됩니다.

- `run.json` (현재 stage, loop/retry 카운터, failure signature, 체크포인트)
- `run.lock` (동시 실행 방지)
- `state-transitions.jsonl`
- `prompts/`
- `outputs/`
- `verify.log`
- `tools.log`

중단 후 `--resume <runId>`로 이어서 실행 가능.

## 실패 시 확인 위치

- 최종 상태: `outputs/final.snapshot.json`
- 런타임 예외: `outputs/runtime.error.json`
- 검증 실패 요약: `outputs/failure-summary.json`
- 검증 상세: `verify.log`
- 실행 도구 로그: `tools.log`
- retrieval 실행 로그: `outputs/retrieval.plan.attempt-*.json`, `outputs/retrieval.implement.attempt-*.json`
- verify 재주입 신호: `outputs/verify.feedback.attempt-*.json`

추가로, objective에 API/서버 요구가 있으면 `objective-contract` 게이트가 다음을 점검합니다:

- `scripts.start` / `scripts.dev` 요구 충족 여부
- express 의존성 존재 여부
- 엔드포인트/응답 텍스트 정합성
- 필요 시 서버 smoke check(랜덤 포트에서 endpoint 응답 확인)

서버 접근 문제가 있으면 포트 충돌을 먼저 확인하세요:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
PORT=3100 npm run start
```

## 추가 문서

- `docs/ARCHITECTURE.md`
- `docs/MODES.md`
- `docs/PLUGINS.md`
- `docs/OPERATIONS.md`
- `docs/REQUIREMENT-COMPLIANCE.md`
- `docs/RETRIEVAL.md`
- `examples/sample-task.md`
