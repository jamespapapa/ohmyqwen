# Architecture

`ohmyqwen` v0는 런타임이 제어권을 갖는 상태머신 기반 로컬 에이전틱 루프를 목표로 합니다.

## 1) Control Plane

- 구성: `src/core/state-machine.ts`, `src/loop/runner.ts`
- 상태: `ANALYZE -> PLAN -> IMPLEMENT -> VERIFY -> (FINISH | PATCH | FAIL)`
- 역할: 단계 강제, 유효하지 않은 전이 차단, 완료 조건 통제

## 2) Execution Plane

- 구성: `src/tools/executor.ts`
- 역할: 허용된 명령만 실행(`pnpm`, `node`, `git`), 타임아웃 포함
- 목적: 폐쇄망 환경에서 최소 권한 실행 경로 제공

## 3) Context Plane

- 구성: `src/context/packer.ts`
- 역할: 긴 대화 히스토리를 배제하고, task/objective/files 중심의 짧은 컨텍스트 패킹

## 4) LLM Plane

- 구성: `src/llm/client.ts`
- 역할: 제안/생성 전용 인터페이스
- v0 상태: `StubLlmClient` 제공 (실연동 어댑터 자리 확보)

## 5) Gate Plane

- 구성: `src/gates/verify.ts`
- 역할: `lint/typecheck/test` 게이트 결과를 구조화 출력으로 수집
- 정책: 게이트 미통과 시 `FINISH` 금지, `PATCH` 전이

## JSON I/O & Schema

- 입력/출력 스키마: `schemas/*.json`
- 런타임 검증: `zod` 기반 파싱 (`src/core/types.ts`)
- 목표: 모델 출력 파싱 실패/형상 불일치 조기 차단
