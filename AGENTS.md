# AGENTS.md

## 프로젝트 큰그림

`ohmyqwen`은 폐쇄망/제한망 환경에서 동작하는 로컬 에이전틱 코딩 런타임이다.  
LLM은 제안만 생성하고, 최종 실행/검증/상태 전이는 상태머신 런타임이 강제한다.

핵심 루프:
`ANALYZE -> PLAN -> IMPLEMENT -> VERIFY -> (FINISH | PATCH | FAIL)`

---

## 현재 프로젝트 목적 (최신화)

1. 입력 요구사항을 고정 템플릿이 아닌 **동적 목적 해석**으로 처리한다.  
2. 품질게이트(`build/test/lint`)와 objective-contract를 통해 **완료/실패 근거를 명확히 남긴다**.  
3. 의존성 설계 시, 제공된 사용 가능 라이브러리 범위를 우선 적용한다.
   - 1순위: 입력값 `availableLibraries`
   - 2순위: 로컬 파일 `availableLibrariesFile` 또는 기본 탐색 파일
   - 3순위: 파일 미존재 시 URL fetch(`availableLibrariesUrl` 또는 env)

---

## Phase 기록

### Phase 1 (완료)

**목표:** 런타임 안정화 + 요구사항 해석/검증 신뢰도 개선 + 라이브러리 allowlist 기반 튜닝 도입

**완료 항목 요약**

- AnalyzeInput 확장:
  - `availableLibraries`
  - `availableLibrariesFile`
  - `availableLibrariesUrl`
- ANALYZE 단계에 튜닝 추가:
  - 라이브러리 소스 자동 해석(입력/파일/URL)
  - allowlist 활성 시 제약 플래그 자동 부여
  - 튜닝 결과 아티팩트 기록: `outputs/analyze.tuning.json`
- LLM 프롬프트 강화:
  - dependencyPolicy(allowlistOnly/availableLibraries) 전달
  - 계획 단계에 feasibility-tuning/의존성 설계 단계 유도
- Objective-contract 강화:
  - Node/Spring 의존성 allowlist 위반 검출
  - 실패 원인 메시지 명확화
- 서버/API 입력 경로 반영:
  - `POST /api/runs`에서 allowlist 관련 필드 수용
- 회귀 테스트 보강 및 전체 테스트/빌드 통과

**산출물 기준**

- 실행 아티팩트: `.ohmyqwen/runs/<runId>/`
- 상태 전이: `state-transitions.jsonl`
- 단계 출력: `outputs/*.json`

---

## 다음 세션 시작점

- **Phase 2부터 진행**
- 권장 초점:
  1) 로컬 파일 기반 allowlist를 DB/RAG provider 인터페이스로 확장  
  2) provider 우선순위/캐시/갱신 정책 정의  
  3) objective-contract와 provider 간 정책 일관성 강화

