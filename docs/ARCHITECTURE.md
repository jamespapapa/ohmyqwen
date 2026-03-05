# Architecture (v0.1.0-alpha)

`ohmyqwen`은 런타임 제어형 상태머신 기반 로컬 에이전틱 코딩 루프다.

## 1) Control Plane

- 파일: `src/core/state-machine.ts`, `src/loop/runner.ts`, `src/loop/run-state.ts`
- 상태:
  - `ANALYZE -> WAIT_CLARIFICATION -> PLAN -> IMPLEMENT -> VERIFY -> (FINISH | PATCH | FAIL)`
- 역할:
  - 단계 전이 강제
  - PATCH 재시도/전략 전환
  - run manifest 기반 resume
  - idempotent stage 재진입

## 2) Durable Run State Plane

- 경로: `.ohmyqwen/runs/<runId>/`
- 핵심 파일:
  - `run.json` (현재 stage/loop/retry/failure signature/체크포인트)
  - `run.lock` (동일 runId 동시 실행 방지)
  - `state-transitions.jsonl`
- 역할:
  - 중단/크래시 후 이어서 실행
  - 단계별 체크포인트(계획 완료, attempt별 action/verify 완료 여부)

## 3) Context Plane

- 파일: `src/context/packer.ts`
- 기능:
  - `small/mid/big` 계층 컨텍스트
  - stage별 토큰 budget factor + hard-cap
  - relevance scoring(작업 설명/diff/error/target 파일)
  - 증분 인덱싱 캐시: `.ohmyqwen/cache/context-index.json`
- CLI:
  - `ohmyqwen context inspect --task ...`

## 4) LLM Plane

- 파일: `src/llm/client.ts`
- 기능:
  - PLAN/IMPLEMENT JSON 제안
  - OpenAI-compatible endpoint 호출
  - 미설정 시 fallback deterministic 출력

## 5) Execution Plane

- 파일: `src/tools/executor.ts`
- 기능:
  - workspace 경계 보호(path escape 차단)
  - command allowlist (`config/commands.allowlist.json`)
  - patch transaction + rollback
  - dry-run
  - 실행 로그(JSONL): `tools.log`

## 6) Gate Plane

- 파일: `src/gates/verify.ts`
- 기본 순서: `build -> test -> lint`
- 기능:
  - 런타임 파일 기반 빌드도구 자동 감지(npm/gradle/maven)
  - profile override (`default/strict/service`)
  - failure classifier (compile/test/lint/runtime/tooling/infra)
  - failure signature/failure summary 생성
  - verify 상세 로그(`verify.log`), failure-summary 아티팩트

### Objective Contract Gate (요구사항 정합성 게이트)

- 파일: `src/gates/objective-contract.ts`
- 역할:
  - objective에서 요구한 계약(예: express 사용, `/hello` 엔드포인트, `npm run start`)을 정적/동적 검사
  - 필요 시 서버 smoke check 수행 (`pnpm run start` + 랜덤 포트 + endpoint 응답 검증)
  - 결과를 `objective-contract` 게이트로 `verifyOutput.gateResults`에 병합
- 목적:
  - build/test/lint가 통과해도 사용자 요구와 어긋난 산출물이 `FINISH`로 넘어가지 않도록 차단

## 7) Mode Policy Plane

- 파일: `src/modes/policies.ts`
- 모드: `feature/refactor/medium/microservice (+ auto)`
- 기능:
  - auto mode 추론 + 근거 기록
  - 모드별 max loop/retry/gate profile/planning guidance
  - 모호 요청 시 clarifying question 생성 + 대기 상태(`WAIT_CLARIFICATION`)

## 8) Plugin Plane (Optional Hooks)

- 파일: `src/plugins/*`
- 훅:
  - `beforeAnalyze`, `beforePlan`, `beforeImplement`, `beforeVerify`
- 기본 플러그인:
  - `context-preload`
  - `gitlab-logs` (읽기 전용, env 없으면 degrade)
- 설정:
  - `config/plugins.json`
- 출력:
  - `outputs/plugins.output.json`

## 9) Localhost Console Plane

- 서버: `src/server/app.ts`, `src/server/routes.ts`, `src/server/store.ts`
- 웹: `web/index.html`, `web/app.js`
- Next.js 웹 콘솔: `console-next/` (프록시 API 포함)
- API:
  - `POST /api/runs`
  - `GET /api/runs/:id`
  - `GET /api/runs/:id/events`
  - `GET /api/runs/:id/artifacts`

## 10) JSON Schema / Contracts

- 스키마: `schemas/*.json`
- 런타임 검증: `zod` (`src/core/types.ts`)
- 원칙:
  - 스키마 불일치 즉시 오류
  - 구조화 JSON 우선
