# AGENTS.md

## 프로젝트 큰그림

`ohmyqwen`은 **폐쇄망/제한망 환경에서 실행되는 로컬 에이전틱 코딩 런타임 + 프로젝트 분석 서버**다.  
핵심은 두 축이다.

1. 상태머신 기반 실행 루프  
   - `ANALYZE -> PLAN -> IMPLEMENT -> VERIFY -> (FINISH | PATCH | FAIL)`
2. 프로젝트 지식화 / 질의응답 루프  
   - 색인 -> 구조분석 -> 사전/그래프/후보지식 축적 -> 질문응답 -> 품질게이트 -> 재시도/승격

LLM은 제안과 해석을 담당하고, **최종 실행/검증/상태 전이와 품질 판단은 런타임이 강제**한다.

---

## 현재 시스템의 핵심 구조

### 1. 실행 런타임
- `src/loop`, `src/core`, `src/gates`
- objective-contract / build/test/lint 기반 품질게이트
- 실행 아티팩트: `.ohmyqwen/runs/<runId>/`

### 2. 프로젝트 분석 서버
- `src/server`
- 프로젝트 등록 / 색인 / 구조분석 / 검색 / 질문 / 디버그 API 제공
- 프론트(`console-next`)와 백엔드(`serve`) 분리 배포 가능

### 3. 내장 QMD 검색 런타임
- `vendor/qmd`
- `src/retrieval/qmd-runtime.ts`
- `src/retrieval/qmd-internal.ts`
- app-owned runtime 경로:
  - `.ohmyqwen/runtime/qmd/config`
  - `.ohmyqwen/runtime/qmd/cache`
  - `.ohmyqwen/runtime/qmd/indexes`
  - `.ohmyqwen/runtime/qmd/models`
- 기본 방향은 **internal-runtime + offline strict + Windows x64 폐쇄망 배포**

### 4. 프로젝트 지식화 계층
- structure index
- front-back graph
- EAI dictionary
- learned knowledge
- domain/module-role/process/channel packs
- 목적: 프로젝트별 정합도를 반복 사용으로 점진 향상

---

## 현재 프로젝트 목적 (최신화)

1. 입력 요구사항을 고정 템플릿이 아닌 **동적 목적 해석**으로 처리한다.
2. 품질게이트(`build/test/lint`)와 objective-contract를 통해 **완료/실패 근거를 명확히 남긴다**.
3. QMD를 외부 CLI가 아니라 **프로젝트 내부 런타임**으로 사용하고, 폐쇄망 Windows x64 환경에서 실행 가능하게 유지한다.
4. 프로젝트 분석 품질은 **하드코딩된 도메인 분기**보다, 사전/그래프/후보지식/회귀테스트 축적을 통해 올린다.
5. 외부 지원 없이도 폐쇄망 내부 Qwen3 기반으로 점진 강화될 수 있도록, **candidate -> validated knowledge 승격 구조**를 우선한다.

---

## 운영 원칙

1. **타겟 코드베이스 직접 접근을 전제로 설계하지 않는다.**  
   폐쇄망 운영 이후에는 추출된 사전/그래프/질의기록/사용자 힌트만으로도 품질을 올릴 수 있어야 한다.

2. **질문별 if/else보다 일반화된 지식 승격 구조를 우선한다.**  
   `channel / domain / subdomain / action / module-role / process-role`를 분리해서 다룬다.

3. **confidence는 구조 완성도만으로 올리지 않는다.**  
   질문 의미 정합성, specificity, adjacent flow confusion을 반드시 반영한다.

4. **재시도는 새 증거가 생길 때만 한다.**  
   evidence 변화가 없으면 반복 호출을 멈춘다.

5. **Windows x64 오프라인 번들 실행성을 항상 의식한다.**  
   네이티브 의존성, bundle root 경로, local model path, wrapper 스크립트 동작을 깨지 않게 유지한다.

---

## Phase 기록

### Phase 1 (완료)

**목표:** 런타임 안정화 + 요구사항 해석/검증 신뢰도 개선 + 라이브러리 allowlist 기반 튜닝 도입

**완료 항목 요약**

- AnalyzeInput 확장
  - `availableLibraries`
  - `availableLibrariesFile`
  - `availableLibrariesUrl`
- ANALYZE 단계 튜닝
  - 라이브러리 소스 자동 해석(입력/파일/URL)
  - allowlist 활성 시 제약 플래그 자동 부여
  - 튜닝 결과 아티팩트 기록: `outputs/analyze.tuning.json`
- Objective-contract 강화
  - Node/Spring 의존성 allowlist 위반 검출
  - 실패 원인 메시지 명확화
- 서버/API 입력 경로 반영
  - `POST /api/runs`에서 allowlist 관련 필드 수용

### Phase 2 (진행 중)

**목표:** 프로젝트 분석/질의응답을 폐쇄망에서 스스로 강화되는 구조로 전환

**현재까지 반영된 축**

- internal QMD runtime 통합
- project analysis / ask / debug API
- structure index / front-back graph / EAI dictionary / learned knowledge
- domain packs / maturity scoring / cross-layer tracing
- Windows x64 오프라인 backend/frontend 번들링

**남은 중점**

1. broad domain -> subdomain -> action 정합도 향상
2. module-role / process-role 질문 품질 강화
3. candidate knowledge 자동 승격 / stale knowledge 약화
4. replay / regression 기반 품질 향상 루프 강화
5. 폐쇄망 운영 기록 기반 엔진 일반화

---

## 다음 세션 시작점

우선순위는 아래 순서로 본다.

1. **폐쇄망 자가강화 구조 강화**
   - 사전/그래프/후보지식 누적
   - replay / regression 축적
   - validated knowledge 승격

2. **질문 품질 일반화**
   - 특정 도메인 하드코딩 축소
   - module-role / process-role / channel 질문 대응력 강화

3. **오프라인 배포 안정화**
   - Windows x64 bundle runtime 검증
   - qmd models / wrapper / frontend-backend startup 안정화
