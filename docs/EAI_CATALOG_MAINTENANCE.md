# EAI Catalog Maintenance (Project-Preset Scoped)

EAI 목록은 프로젝트 프리셋(`preset.eai.enabled=true`)이 켜진 경우에만 생성된다.

## 기준일자(asOfDate)

- 우선순위:
  1. override 파일의 `asOfDate`
  2. 프리셋의 `eai.asOfDate`
  3. 분석 실행일
- 분석 결과/메모리(`memory/eai-dictionary/latest.md|json`)에 기준일자가 기록된다.

## 변경 방법 (추가/수정/삭제)

프리셋에 지정한 `manualOverridesFile`을 통해 반영한다.

예: `.ohmyqwen/eai-overrides.json`

```json
{
  "asOfDate": "2026-03-06",
  "entries": [
    {
      "op": "upsert",
      "interfaceId": "F10480011",
      "interfaceName": "퇴직보험금 청구대상자 조회",
      "purpose": "퇴직보험금 청구 대상 조회",
      "sourcePath": "resources/eai/env/dev/io/sli/ea2/F10480011_service.xml",
      "usagePaths": ["dcp-insurance/src/main/java/.../Service.java"]
    },
    {
      "op": "delete",
      "interfaceId": "F00000000"
    }
  ]
}
```

- `upsert`: 신규 추가 또는 기존 항목 갱신
- `delete`: interfaceId 기준 삭제

## 운영 권장

1. 프리셋에 EAI 경로 포함 규칙(`servicePathIncludes`)을 명확히 유지
2. 월 1회 이상 asOfDate 갱신
3. 분석 후 `manualOverridesApplied` 값으로 반영 여부 점검
4. 대규모 개편 시 override 파일 초기화 후 재정비

