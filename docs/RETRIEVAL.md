# RETRIEVAL 운영/구조 가이드

## 1) 목표

ohmyqwen Retrieval은 런타임 제어 하에 다음을 보장한다.

- QMD 1순위 검색
- 로컬 임베딩(폐쇄망) 기반 semantic 확장
- 실패 시 lexical 자동 강등(Graceful degrade)
- stage별 토큰 하드캡 + 증거 우선 패킹
- verify 실패 신호 재주입

## 2) 구성

- 설정: `config/retrieval.json`
- 코드:
  - `src/retrieval/*` (provider/factory/chain/config)
  - `src/context/packer.ts` (인덱스 + retrieval 통합 + 패킹)
- 캐시:
  - `.ohmyqwen/cache/context-index.json`
  - `.ohmyqwen/cache/qmd/config/*.yml` (QMD collection config)
  - `.ohmyqwen/cache/qmd/indexes/*.sqlite` (QMD index DB)
  - `.ohmyqwen/cache/embedding-cache.json`

## 3) Provider 체인

기본 우선순위: `qmd -> hybrid -> lexical -> semantic`

실행 순서:
1. `qmd`
2. `lexical`
3. `semantic` (활성/헬시일 때)
4. `hybrid` (lexical + semantic 병합)

선택 규칙:
- primary(qmd) 성공 시 우선 사용
- QMD는 실제 `qmd` CLI를 호출해서 검색한다
  - 기본 모드: `query_then_search` (`qmd query` 실패 시 `qmd search`)
- qmd 실패/empty면 fallback provider로 자동 전환
- 모든 provider 실패 시 changed/index fallback으로 run 지속

QMD 관련 주요 설정:
- `qmd.command` (`OHMYQWEN_QMD_COMMAND`)
- `qmd.queryMode` (`OHMYQWEN_QMD_QUERY_MODE`)
- `qmd.collectionName` (`OHMYQWEN_QMD_COLLECTION`)
- `qmd.mask` (`OHMYQWEN_QMD_MASK`)
- `qmd.configDir/cacheHome/indexPath` (폐쇄망 경로 고정용)

## 4) 로컬 임베딩 연동

환경변수 또는 `config/retrieval.json`에서 설정한다.

- `OHMYQWEN_EMBEDDING_ENABLED=1`
- `OHMYQWEN_EMBEDDING_ENDPOINT=http://127.0.0.1:8081`
- `OHMYQWEN_EMBEDDING_HEALTH_PATH=/health`
- `OHMYQWEN_EMBEDDING_EMBED_PATH=/embed`

preflight 실패 시 semantic은 `degraded` 상태로 기록되고 lexical-only로 계속 진행한다.

## 5) verify 피드백 루프

VERIFY 실패 시 다음 아티팩트를 남기고 PATCH 검색에 재주입한다.

- `outputs/verify.feedback.attempt-<n>.json`
  - failure signature/category/core lines/recommendation
  - 다음 attempt 검색용 signal

검색 실행 아티팩트:

- `outputs/retrieval.plan.attempt-<n>.json`
- `outputs/retrieval.implement.attempt-<n>.json`

각 파일에 provider 상태/선택/강등 여부(fallbackUsed)가 기록된다.

## 6) 인덱스 라이프사이클

`context-index.json` metadata:
- chunkVersion
- retrievalVersion
- providerFingerprint
- embeddingModel

metadata mismatch 시 stale로 감지하고 (`autoReindexOnStale=true`) 자동 재인덱싱한다.

QMD 인덱스는 provider 내부에서 collection 존재 여부를 확인하고:
- 없으면 `qmd collection add`
- 있으면 주기적으로 `qmd update`
를 수행한다.

진단 명령:

```bash
ohmyqwen context doctor
ohmyqwen context doctor --reindex
```

## 7) 평가 하네스

```bash
pnpm eval:retrieval
```

출력: `.ohmyqwen/eval/retrieval-eval-*.json`

지표:
- runSuccessRate
- averageLoopCount
- verifyFirstPassRate
- retrievalHitRateAt5
