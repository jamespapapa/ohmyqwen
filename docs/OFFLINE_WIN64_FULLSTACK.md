# Windows x64 폐쇄망 배포 가이드

이 문서는 **실행 절차 요약**이다.  
반입 전 체크리스트와 빠질 수 있는 항목은 `docs/EXECUTION_FINAL_READINESS.md`를 우선 본다.

## 산출물

GitHub Actions `win64-offline-bundle` workflow는 두 개의 artifact를 생성한다.

- `ohmyqwen-offline-win64-backend`
- `ohmyqwen-offline-win64-frontend`

## backend 실행

압축 해제 후 backend 루트에서:

```bat
serve-ohmyqwen.cmd
```

또는:

```bat
node-runtime\node.exe dist\cli.js serve
```

기본 포트는 `4311`.

### backend `.env`

```env
OHMYQWEN_LLM_BASE_URL=https://api.t.drt.samsunglife.kr/llmproxy/v1/
OHMYQWEN_LLM_MODEL=Qwen3-235B-A22B-Instruct-2507-FP8
OHMYQWEN_LLM_ENDPOINT_KIND=openai
```

주의:

- 실제 폐쇄망에서는 위 값 대신 **현장 endpoint/model**에 맞춘 별도 `.env`가 필요하다.
- LLM 서버/모델은 이 번들에 자동 포함되지 않는다.

## frontend 실행

압축 해제 후 frontend 루트에서:

```bat
serve-console.cmd
```

또는:

```bat
node-runtime\node.exe node_modules\next\dist\bin\next start -p 3005
```

기본 포트는 `3005`.

### frontend 환경변수

```env
BACKEND_BASE_URL=http://127.0.0.1:4311
PORT=3005
```

## 실행 순서

1. backend 실행
2. frontend 실행
3. 브라우저에서 `http://127.0.0.1:3005` 접속

## workflow 권장 입력값

- `Fail when local GGUF models are missing`
  - 모델까지 반입할 때만 활성화
- `Bundle the runner's Node runtime into the zip`
  - 폐쇄망 대상에 Node가 없으면 반드시 체크

## 중요 보충

- QMD 모델은 runner에 실제 모델 파일이 있어야 번들에 포함된다.
- project-specific index / analyze artifact / ontology snapshot은 보통 번들에 미리 포함되지 않는다.
- 반입 전 최종 점검은 `docs/EXECUTION_FINAL_READINESS.md` 체크리스트 기준으로 수행한다.
