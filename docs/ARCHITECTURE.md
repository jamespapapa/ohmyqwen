# Architecture

`ohmyqwen` v0.1은 런타임이 제어권을 가지는 상태머신 기반 로컬 에이전틱 루프입니다.

## 1) Control Plane

- 구성: `src/core/state-machine.ts`, `src/loop/runner.ts`
- 상태: `ANALYZE -> PLAN -> IMPLEMENT -> VERIFY -> (FINISH | PATCH | FAIL)`
- 책임: 단계 강제, 실패 시 PATCH 재진입, 반복 실패 시 전략 전환/FAIL

## 2) Execution Plane

- 구성: `src/tools/executor.ts`
- 책임:
  - 파일 읽기/쓰기/패치
  - allowlist 명령 실행 (`pnpm`, `node`, `git`, `npx`)
- 목적: 최소 권한과 예측 가능한 실행 경로 유지

## 3) Context Plane

- 구성: `src/context/packer.ts`
- 책임:
  - `small/mid/big` 3계층 컨텍스트
  - 호출별 토큰 예산 하드캡
  - 전체 파일 대신 `symbol / errorLogs / diffSummary` 중심 전달

## 4) LLM Plane

- 구성: `src/llm/client.ts`
- 책임: PLAN/IMPLEMENT 제안 생성
- 연동: OpenAI-compatible endpoint
- 환경변수:
  - `OHMYQWEN_LLM_BASE_URL`
  - `OHMYQWEN_LLM_API_KEY` (옵션)
  - `OHMYQWEN_LLM_MODEL`
- 미설정 시 fallback 모드로 안전 동작

## 5) Gate Plane

- 구성: `src/gates/verify.ts`
- 게이트 순서: `build -> test -> lint`
- 출력: 구조화 결과 + `failureSignature`
- 정책: VERIFY 통과 전 FINISH 금지

## 6) Artifacts Plane

- 경로: `.ohmyqwen/runs/<runId>/`
- 산출물:
  - `state-transitions.jsonl`
  - `prompts/`
  - `outputs/`
  - `verify.log`
- 목표: 성공/실패 모두 재현 가능한 실행 흔적 유지

## JSON I/O & Schema

- 스키마: `schemas/*.json`
- 런타임 검증: `zod` (`src/core/types.ts`)
- 목적: 모델 출력 형상 불일치 조기 차단
