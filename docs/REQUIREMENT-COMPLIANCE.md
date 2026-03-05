# REQUIREMENT COMPLIANCE 개선 보고

## 배경

실사용 프롬프트(예: Express REST API + `/hello` + `npm run start`)에서 런타임이 품질게이트를 통과해도, 사용자 요구 정합성이 약한 문제가 확인되었다.

## 문서/코드 분석 결과 (원인)

1. **Phase-06 verify 설계의 한계**
   - 기본 게이트가 `build -> test -> lint`로 고정되어 objective(요구사항) 자체 검증이 빠져 있었다.
2. **Hello World 힌트 편향**
   - IMPLEMENT 힌트가 `hello world` 키워드만으로 CLI 최소 구현을 유도하여, API 요구가 있어도 잘못된 방향으로 갈 수 있었다.
3. **액션 정규화 취약점**
   - `npm pkg`가 `pnpm run pkg`로 오정규화되거나, inline `node -e`가 깨져 실행 실패하는 케이스가 있었다.
4. **운영 가이드 부족**
   - 포트 충돌(UI 3000 vs 생성 서버 3000) 등 현장 이슈를 운영 문서에서 충분히 안내하지 못했다.

## 고도화 내용

### 1) Objective Contract Gate 추가

- 파일: `src/gates/objective-contract.ts`
- 동작:
  - objective에서 계약 추출(Express 요구, endpoint, start/dev 스크립트 요구)
  - 정적 검사(`package.json`, 엔트리 파일, endpoint/응답 텍스트)
  - 필요 시 동적 smoke check(`pnpm run start` + 랜덤 포트 + endpoint 호출)
- 결과:
  - `verifyOutput.gateResults`에 `objective-contract` 게이트를 병합
  - 요구사항 미충족 시 `FINISH` 차단

### 2) IMPLEMENT 힌트 정교화

- 파일: `src/llm/client.ts`
- 개선:
  - Hello World + API 요청 동시 존재 시, CLI 최소구현 힌트 제거
  - API/Express/start/dev/endpoint 요구를 objective hints로 명시 주입
  - inline `node -e` 액션 드롭 및 프롬프트 금지 강화
  - `npm pkg` -> `pnpm pkg` 정규화 보정

### 3) Executor/Allowlist 보강

- 파일: `src/tools/executor.ts`, `config/commands.allowlist.json`
- 개선:
  - `pnpm pkg` 허용
  - 기존 정규화와 결합해 script 누락 오탐 감소

### 4) 운영 문서 보강

- `docs/ARCHITECTURE.md`: objective-contract 게이트 반영
- `docs/OPERATIONS.md`: 포트 충돌/contract gate 트러블슈팅 반영
- `README.md`: objective-contract 설명 및 포트 점검 명령 추가

## 검증 상태

- `pnpm test` 통과
- `pnpm run typecheck` 통과
- `pnpm run build` 통과
- `pnpm --dir console-next build` 통과

## Phase-2: Retrieval/QMD 통합 (요약)

- retrieval provider 인터페이스/팩토리/체인 도입 (`src/retrieval/*`)
- QMD primary + lexical fallback + hybrid merge 도입
- local embedding endpoint preflight + semantic degrade 정책 추가
- verify 실패 feedback 재주입 아티팩트(`verify.feedback.attempt-*.json`) 추가
- stale index metadata 감지 + `context doctor --reindex` 경로 추가
- 평가 하네스(`pnpm eval:retrieval`) 및 운영 문서(`docs/RETRIEVAL.md`) 추가
