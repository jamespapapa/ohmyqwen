# Execution Final Readiness

Updated: 2026-03-19  
Purpose: 폐쇄망/제한망 반입 전 최종 체크리스트와 로컬 실행 검증 기준을 한 곳에 모은다.

---

## Scope

이 문서는 현재 기준의 실행 최종준비를 다룬다.

대상:

- Windows x64 오프라인 번들
- backend/frontend 분리 실행
- internal QMD runtime 포함 여부
- ontology/QMD artifact 생성 전제
- 폐쇄망 반입 전 로컬 사전검증

비대상:

- ontology 품질 자체의 정답 판정
- semantic layer 승격 기준
- draft/review/self-eval 정책 상세

---

## Current execution model

현재 실행 모델은 아래와 같다.

- backend: `pnpm serve` 또는 Windows bundle의 `serve-ohmyqwen.cmd`
- frontend: `pnpm ui:dev` / `pnpm ui:build` 또는 Windows bundle의 `serve-console.cmd`
- retrieval: **internal QMD runtime**
- ontology persistence: **filesystem artifact**
- LLM endpoint: 별도 로컬/사내 endpoint 필요

즉:

- ontology/QMD는 app-owned runtime/filesystem 기준
- LLM은 별도 실행 환경/endpoint 필요
- graph/ontology는 DB가 아니라 파일 artifact로 유지

---

## What is bundled vs not bundled

## Bundled by the offline Windows workflow

가능 산출물:

- backend dist
- frontend build output
- runtime dependencies
- vendored QMD dist/runtime
- Windows Node runtime (`include_node_runtime=true`일 때)
- QMD GGUF models (`require_models=true`이고 runner에 실제 모델이 있을 때)

## Not automatically bundled

기본적으로 자동 포함되지 않는 항목:

- 별도 LLM 서버 본체
- LLM용 모델/가중치
- backend/frontend `.env`
- QMD indexes/cache의 완성본
- 프로젝트별 ontology graph / projection / analyze artifact
- 프로젝트별 질문/평가 기록

해석:

- 번들을 반입한 뒤 프로젝트 등록/index/analyze는 다시 수행될 수 있다.
- 모델까지 같이 반입하려면 workflow input과 runner 준비가 모두 맞아야 한다.

---

## Mandatory preflight checks before offline import

## A. Bundle build inputs

GitHub Actions `win64-offline-bundle` 기준으로 최소 확인:

- `include_node_runtime=true`
- 모델까지 넣을 경우 `require_models=true`
- runner 작업공간에 실제 GGUF 모델이 존재하는지 확인

예상 QMD 모델 경로:

- `.ohmyqwen/runtime/qmd/models/embeddinggemma-300M-Q8_0.gguf`
- `.ohmyqwen/runtime/qmd/models/qwen3-reranker-0.6b-q8_0.gguf`
- `.ohmyqwen/runtime/qmd/models/qmd-query-expansion-1.7B-q4_k_m.gguf`

## B. Backend artifact contents

backend zip 안에 최소 존재해야 한다.

- `dist/`
- `config/`
- `node_modules/`
- `vendor/qmd/dist/`
- `serve-ohmyqwen.cmd`
- `node-runtime/node.exe` (Node 미설치 대상이면 필수)
- `.ohmyqwen/runtime/qmd/models/` (모델 반입 시)

## C. Frontend artifact contents

frontend zip 안에 최소 존재해야 한다.

- `.next/`
- `node_modules/`
- `serve-console.cmd`
- `node-runtime/node.exe` (필요 시)

## D. Separate LLM runtime requirement

현재 번들만으로는 질문응답까지 완전 독립 실행되지 않는다.

반드시 별도로 준비해야 할 수 있다.

- 로컬 LLM 서버 또는 사내 LLM endpoint
- 해당 endpoint가 사용하는 모델/인증
- backend `.env`에서 이를 바라보는 설정

현재 확인 포인트:

- `OHMYQWEN_LLM_BASE_URL`
- `OHMYQWEN_LLM_ENDPOINT_KIND`
- `OHMYQWEN_LLM_MODEL`
- 필요 시 `OHMYQWEN_LLM_BASIC_AUTH`

## E. Environment files

반입 전, 폐쇄망용 설정 파일을 분리 준비한다.

backend 예:

```env
OHMYQWEN_LLM_BASE_URL=http://localhost:4096
OHMYQWEN_LLM_ENDPOINT_KIND=opencode
OHMYQWEN_LLM_MODEL=gpt-5.3-codex
```

frontend 예:

```env
BACKEND_BASE_URL=http://127.0.0.1:4311
PORT=3005
```

주의:

- 위 값은 예시다.
- 실제 폐쇄망 endpoint/model에 맞게 별도 준비해야 한다.

---

## Local validation checklist before import

폐쇄망 반입 전 로컬에서 최소 아래를 통과해야 한다.

## 1. Code validation

```bash
pnpm lint
pnpm test
pnpm build
pnpm ui:build
```

## 2. Backend smoke run

```bash
pnpm serve
```

확인:

- backend가 기동되는지
- `/api/projects` 응답이 오는지
- analyze/ask API가 정상 응답하는지

## 3. Frontend smoke run

```bash
BACKEND_BASE_URL=http://127.0.0.1:4311 pnpm ui:dev
```

확인:

- 프로젝트 등록/조회 가능
- 구조분석 가능
- ontology fullscreen route 렌더링 가능

## 4. QMD/runtime artifact expectation check

확인:

- internal QMD runtime 경로 생성 여부
- 모델이 필요한 경우 `.ohmyqwen/runtime/qmd/models` 존재 여부
- indexes/cache는 필요 시 재생성되는지

## 5. Offline workflow artifact spot-check

artifact zip을 실제로 풀어보고 최소 아래를 확인한다.

- backend cmd 실행 가능
- frontend cmd 실행 가능
- Node runtime 포함 여부
- 모델 포함 여부
- `.env` 별도 배치 계획

---

## Runtime artifact locations

현재 ontology/QMD 관련 주요 artifact는 filesystem에 저장된다.

대표 위치:

- `memory/ontology-graph/latest.json`
- `memory/ontology-projections/latest.json`
- `memory/project-analysis/latest.json`
- `.ohmyqwen/runtime/qmd/config`
- `.ohmyqwen/runtime/qmd/cache`
- `.ohmyqwen/runtime/qmd/indexes`
- `.ohmyqwen/runtime/qmd/models`

해석:

- ontology는 analyze 시 메모리에서 build되고 파일로 persist 된다.
- DB 저장 전제가 아니다.

---

## Known execution caveats

1. **QMD 모델은 자동 포함이 아니다.**  
   workflow input/runner state가 맞아야 번들에 포함된다.

2. **Node runtime 포함도 선택 옵션이다.**  
   폐쇄망 대상 PC에 Node가 없다면 반드시 bundle에 포함해야 한다.

3. **LLM 서버/모델은 별도 준비물이다.**  
   현재 번들만으로 완결되지 않는다.

4. **project-specific indexes/ontology artifacts는 보통 번들에 미리 안 들어간다.**  
   첫 실행 후 다시 index/analyze가 필요할 수 있다.

5. **개발 산출물(`console-next/.next-dev/**`)은 실행 자산이 아니다.**  
   배포/커밋 기준에서 제외한다.

---

## Final go/no-go checklist

반입 직전 아래 8개가 모두 참이면 `go`로 본다.

1. 코드 검증 4종(`lint/test/build/ui:build`) 통과
2. backend 로컬 기동 성공
3. frontend 로컬 기동 성공
4. analyze/ask 최소 smoke test 성공
5. backend zip contents 확인 완료
6. frontend zip contents 확인 완료
7. 폐쇄망용 `.env` 준비 완료
8. LLM server/model 준비 책임이 명확함

이 중 하나라도 빠지면 `no-go`다.

---

## Operational note

실행 최종준비는 “앱이 켜진다” 수준으로 끝나면 안 된다.

최소한 아래가 같이 맞아야 한다.

- 기동
- analyze 가능
- ask 가능
- ontology artifact 생성 가능
- offline prerequisite 누락 없음

이 문서는 그 체크를 표준화하기 위한 기준 문서다.
