# ohmyqwen

폐쇄망 환경에서 Qwen3를 안전하게 활용하기 위한 로컬 에이전틱 코딩 런타임 v0 골격입니다.

## 핵심 설계

- 모델은 제안/생성만 담당
- 제어권은 런타임 상태머신이 보유
- 짧은 작업 세션(short session) 우선
- 품질게이트 통과 전 완료 처리 금지
- JSON 스키마 기반 구조화 입출력 우선

## 설치

```bash
pnpm install
```

## 빌드

```bash
pnpm run build
```

## CLI

```bash
pnpm run run
pnpm run plan
pnpm run verify
```

직접 실행:

```bash
node dist/cli.js run --input ./sample.analyze.json
node dist/cli.js plan --input ./sample.analyze.json
node dist/cli.js verify
```

## 품질게이트

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
```

`verify` 모드는 위 3개 게이트를 순차 실행합니다.

## 입력 JSON 예시

```json
{
  "taskId": "task-001",
  "objective": "Implement x",
  "constraints": ["short-session", "state-machine"],
  "files": ["src/core/state-machine.ts"],
  "retryPolicy": { "maxAttempts": 1, "backoffMs": 0 }
}
```
