# MODES

`ohmyqwen`은 작업 성격에 따라 정책을 주입한다.

## 모드 목록

- `feature`
- `refactor`
- `medium`
- `microservice`
- `auto` (입력 기반 추론)

## 모드별 정책

| mode | maxLoops | maxPatchRetries | gateProfile | planning focus |
|---|---:|---:|---|---|
| feature | 4 | 3 | strict | 기능 수용조건/호환성 |
| refactor | 3 | 2 | strict | 동작 유지 + 구조 개선 |
| medium | 3 | 2 | default | 속도/안전 균형 |
| microservice | 5 | 4 | service | 경계/계약/운영 안전 |

## auto 추론

`objective + constraints` 키워드를 기준으로 추론하며, 추론 근거는 run 아티팩트에 남는다.

예:

- `microservice`, `api`, `gateway` 포함 -> `microservice`
- `refactor`, `cleanup` 포함 -> `refactor`
- `feature`, `add`, `implement` 포함 -> `feature`
- 그 외 -> `medium`

## 모호 요청 처리

모호한 objective면 최대 3개 질문을 생성하고 `WAIT_CLARIFICATION`으로 전이한다.

재개 방법:

```bash
ohmyqwen run --resume <runId> --input <input.json>
```

입력 JSON의 `clarificationAnswers`를 채우면 대기 상태에서 재개한다.

## CLI 예시

```bash
# 자동 추론
ohmyqwen run --input ./samples/request.e2e.json

# 수동 지정
ohmyqwen run --mode refactor --input ./samples/request.e2e.json
```
