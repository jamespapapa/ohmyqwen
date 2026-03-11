# Windows x64 폐쇄망 배포 가이드

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
OHMYQWEN_LLM_MODEL=qwen3-235b-a22b
OHMYQWEN_LLM_ENDPOINT_KIND=openai
```

## frontend 실행

압축 해제 후 frontend 루트에서:

```bat
serve-console.cmd
```

또는:

```bat
node-runtime\node.exe server.js
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

- `Fail when local GGUF models are missing` → 해제
- `Bundle the runner's Node runtime into the zip` → 체크

모델까지 폐쇄망에 반입할 때만 `Fail when local GGUF models are missing`를 활성화한다.
