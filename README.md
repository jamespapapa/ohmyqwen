# ohmyqwen

폐쇄망 환경에서 Qwen3를 안전하게 활용하기 위한 로컬 에이전틱 코딩 런타임(v0.1)입니다.

핵심 원칙:

- 모델은 제안/생성만 수행
- 제어권은 상태머신 런타임이 보유
- 짧은 작업세션(short session)
- JSON 스키마 기반 입출력
- `build -> test -> lint` 품질게이트 통과 전 `FINISH` 금지

## 설치

```bash
pnpm install
```

## 빌드

```bash
pnpm run build
```

## LLM 어댑터 환경변수

OpenAI-compatible 로컬 엔드포인트를 지원합니다.

- `OHMYQWEN_LLM_BASE_URL` (예: `http://127.0.0.1:8000` 또는 `http://127.0.0.1:8000/v1`)
- `OHMYQWEN_LLM_API_KEY` (옵션, 없어도 동작)
- `OHMYQWEN_LLM_MODEL` (예: `qwen3-coder`)

세 변수가 완전히 설정되지 않으면 fallback 모드로 동작합니다.

## CLI

```bash
pnpm run run
pnpm run plan
pnpm run verify
```

직접 실행:

```bash
node dist/cli.js run -i ./samples/request.e2e.json
node dist/cli.js plan -i ./samples/request.e2e.json
node dist/cli.js verify
```

## v0.1 End-to-End 실행 예시

fallback(환경변수 없이):

```bash
node dist/cli.js run -i ./samples/request.e2e.json
```

로컬 LLM 연동:

```bash
export OHMYQWEN_LLM_BASE_URL="http://127.0.0.1:8000"
export OHMYQWEN_LLM_MODEL="qwen3-coder"
# export OHMYQWEN_LLM_API_KEY="<optional>"

node dist/cli.js run -i ./samples/request.e2e.json
```

## 상태머신 루프

- `ANALYZE -> PLAN -> IMPLEMENT -> VERIFY -> (FINISH | PATCH | FAIL)`
- VERIFY 실패 시 PATCH로 전이 후 재시도
- 동일 실패 시그니처 반복 시 전략 전환(`small -> mid -> big`) 또는 `FAIL`

## 런 아티팩트

각 실행은 `.ohmyqwen/runs/<runId>/` 아래에 저장됩니다.

- `state-transitions.jsonl`
- `prompts/`
- `outputs/`
- `verify.log`

실패 시에도 마지막 상태와 에러 정보는 `outputs/final.snapshot.json`, `outputs/runtime.error.json`(해당 시)에 남습니다.

## 품질게이트

```bash
pnpm run build
pnpm run test
pnpm run lint
```

`verify` 모드는 위 순서로 게이트를 실행합니다.

## 폐쇄망 반입 (빌드 완료 바이너리)

온라인(반출 준비) 환경:

```bash
pnpm install --frozen-lockfile
pnpm run bundle:offline
```

생성물:

- `release/ohmyqwen-offline-v<version>.tar.gz`

폐쇄망(반입 후):

```bash
tar -xzf ohmyqwen-offline-v<version>.tar.gz
cd ohmyqwen-offline
npx --no-install ohmyqwen run -i ./samples/request.e2e.json
```

다른 모드:

```bash
npx --no-install ohmyqwen plan -i ./samples/request.e2e.json
npx --no-install ohmyqwen verify
```
