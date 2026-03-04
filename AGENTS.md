# AGENTS.md

## 프로젝트 큰그림

`ohmyqwen`은 폐쇄망에서 Qwen3 계열 모델을 안전하게 사용하는 로컬 에이전틱 코딩 런타임이다.
모델은 제안만 하고, 제어권은 상태머신 런타임이 가진다.

## v0.1 운영 목표

- 요청 1건을 받아 `ANALYZE -> PLAN -> IMPLEMENT -> VERIFY -> (FINISH | PATCH | FAIL)` 수행
- 품질게이트(`build/test/lint`) 통과 전 `FINISH` 금지
- 실패 시 PATCH 재시도 및 전략 전환, 반복 실패 시 `FAIL`
- 모든 실행 흔적을 `.ohmyqwen/runs/<runId>/`에 보관

## 시스템 경계

입력:

- `AnalyzeInput` JSON (`taskId`, `objective`, `constraints`, `files`, `symbols`, `errorLogs`, `diffSummary`, `contextTier`, `contextTokenBudget`, `retryPolicy`)

출력:

- 단계별 JSON 출력(`plan/implement/verify/final snapshot`)
- 상태 전이 기록(`state-transitions.jsonl`)

## Plane 아키텍처

1. Control Plane
- `src/core/state-machine.ts`, `src/loop/runner.ts`
- 상태 전이 강제, PATCH 루프 제어

2. LLM Plane
- `src/llm/client.ts`
- OpenAI-compatible 호출
- env: `OHMYQWEN_LLM_BASE_URL`, `OHMYQWEN_LLM_API_KEY(옵션)`, `OHMYQWEN_LLM_MODEL`
- 미설정 시 fallback 모드

3. Context Plane
- `src/context/packer.ts`
- `small/mid/big` 계층 + 토큰 하드캡
- 파일 전체 대신 symbol/error/diff 중심 패킹

4. Execution Plane
- `src/tools/executor.ts`
- 파일 read/write/patch
- allowlist command 실행

5. Gate Plane
- `src/gates/verify.ts`
- `build -> test -> lint` 순차 실행, failure signature 생성

6. Artifacts Plane
- `.ohmyqwen/runs/<runId>/`
- `state-transitions.jsonl`, `prompts/`, `outputs/`, `verify.log`

## 운영 원칙

- 짧은 세션 우선: 한 번의 요청을 빠르게 수렴
- 구조화 JSON 우선: 스키마 검증 실패를 즉시 오류 처리
- 실패 가시성 보장: 실패 이유와 마지막 아티팩트를 항상 남김

## Definition of Done (v0.1)

- `run` 1회 실행으로 end-to-end 루프 완료 또는 명시적 실패
- VERIFY 실패 시 PATCH 재시도 로직 동작
- 반복 실패 시 전략 전환 또는 FAIL 전이
- 실행 후 아티팩트가 지정 경로에 생성
