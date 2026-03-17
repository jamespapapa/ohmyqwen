# Offline Self-Improvement Protocol

## 목적

`ohmyqwen`은 폐쇄망에서 **Qwen3 기반으로 프로젝트 정합도를 점진적으로 높이는 시스템**으로 운영한다.

이 문서는 앞으로의 품질 향상 방식과 역할 분담 원칙을 정의한다.

---

## 전제

시스템 고도화는 아래 입력만을 기반으로 진행한다.

- 폐쇄망 내부에서 생성된 인덱스/사전/그래프/리포트
- 사용자가 제공하는 힌트
- 사용자가 제공하는 질의/응답/피드백 기록
- 사용자가 제공하는 실패 사례 및 오답 사례

직접 코드 열람이 가능한 상황에 의존하는 설계나 운영은 지양한다.

---

## 운영 원칙

### 1. 폐쇄망 내부에서 스스로 강해지는 구조를 우선한다

품질 향상은 외부 모델의 수동 개입이 아니라, 폐쇄망 내부 시스템이 아래 산출물을 축적하고 재사용하는 방식으로 진행한다.

- EAI 인터페이스 사전
- Front 페이지 목록
- Front -> Backend 매핑 사전
- Controller / Service / Mapper / EAI / Batch / Async 역할 정보
- Ontology node / edge / path / action / state-store / data-persistence 후보 지식
- 질문 실행 결과와 품질 진단 기록

핵심은 **모델 가중치 학습이 아니라, 프로젝트 지식의 구조화와 승격**이다.

최종 구조는 아래 역할 분리를 따른다.

- ontology: semantic control plane
- QMD / vector / FTS / rerank: retrieval engine
- agentic workflow: 계획 / 검증 / 재시도 / 중단

---

### 2. 사용자의 힌트는 시스템 강화의 입력이다

사용자는 필요 시 아래와 같은 힌트를 제공할 수 있다.

- EAI 인터페이스 목록을 만들어라
- Front 페이지 목록을 만들어라
- Front -> Backend 맵핑 사전을 만들어라
- 이 질문의 답이 틀렸다
- 이 흐름은 다른 업무로 샜다
- 이 도메인은 이런 키워드/화면/API를 중심으로 봐야 한다

시스템은 이 힌트를 받아:

- candidate ontology node / edge / path 생성
- retrieval / rerank 보정
- channel / action / process / state-store / data-persistence 지식 강화
- regression scenario 추가

로 연결해야 한다.

---

### 3. 실제 질의/응답/피드백을 학습 재료로 삼는다

폐쇄망에서 사용자가 실제 질문을 실행하고, 결과에 대해 피드백을 제공하면 시스템은 이를 기록으로 남겨 다음에 활용한다.

기록 대상 예시:

- 질문 원문
- 선택된 전략
- 매칭된 도메인/채널/서브도메인
- 사용된 evidence
- confidence / quality gate 결과
- 오답 원인
- 사용자의 수정 피드백

이 기록은 candidate knowledge를 validated knowledge로 승격하거나, 기존 지식의 오염을 정정하는 근거로 사용한다.

---

### 4. 외부 지원자는 기록을 보고 코드베이스 레벨 수정만 수행한다

폐쇄망에서 쌓인 기록은 주기적으로 외부로 반출될 수 있다.

외부 지원자는:

- 기록 기반으로 부족한 점을 진단하고
- `ohmyqwen` 코드베이스 레벨에서 추출기/랭커/게이트/저장 구조를 수정한다.

단, 이때도 **타겟 프로젝트 코드베이스를 직접 참조할 수 없다고 가정한다.**

필요한 경우에는 사용자가 아래 수준의 힌트만 제공한다.

- 특정 클래스/화면/API 명칭
- 특정 흐름이 왜 틀렸는지에 대한 설명
- 특정 도메인의 핵심 개념

즉, 외부 개선은 **기록과 힌트 기반의 일반화된 엔진 개선**을 원칙으로 한다.

---

### 5. 긴급 보완은 대화 기반으로도 가능해야 한다

폐쇄망 안에서 시스템이 엉뚱하게 동작해 기록 정리조차 어려운 경우가 있다.

이 경우 사용자는 대화로 바로 문제를 제기할 수 있다.

외부 지원자는:

- 기록이 불완전하더라도
- 대화로 전달된 현상/오류/오답 요약만으로
- 원인 가설과 보완 전략을 제시할 수 있어야 한다.

이때도 타겟 코드베이스를 직접 보는 전제는 두지 않는다.

---

## 설계 원칙

### A. 하드코딩보다 지식 승격 구조를 우선한다

특정 프로젝트/업무별 `if/else`를 계속 추가하는 방식은 지양한다.

우선해야 할 것은:

- candidate knowledge 생성
- evidence 기반 점수화
- validated knowledge 승격
- stale knowledge 약화/폐기
- replay / regression test 축적

이다.

legacy domain pack / preset은 호환성 계층일 뿐,  
질문 해석과 응답 생성의 중심 로직은 ontology graph로 이동해야 한다.

---

### B. 의미 계층을 분리한다

질문/흐름/지식은 아래 축을 분리해 관리한다.

- channel
- domain
- subdomain
- action
- state-store
- data-persistence
- module-role
- process-role

즉, `member-auth` 같은 broad tag 하나로 모든 것을 설명하지 않고,
`monimo + member-auth + register + callback`처럼 조합으로 다룬다.

---

### C. Confidence는 구조 완성도만으로 올리지 않는다

confidence와 quality gate는 반드시 아래를 함께 반영해야 한다.

- 질문 의미 정합성
- channel / domain / subdomain specificity
- adjacent flow confusion 가능성
- 직접 근거의 밀도
- evidence coverage

구조가 그럴듯하다는 이유만으로 높은 confidence를 주지 않는다.

---

### D. 재시도는 새 증거가 생길 때만 한다

저신뢰 답변 이후의 재시도는 아래 조건을 충족할 때만 의미가 있다.

- 새 evidence 생성
- 새 linked flow 확보
- 새 hydrated block 확보
- 새 learned knowledge match 확보
- domain / channel / subdomain이 더 좁혀짐

변화가 없으면 재시도를 중단한다.

---

## 폐쇄망 운영 루프

1. 프로젝트 색인 / 구조 분석 수행
2. 사전/그래프/후보지식 생성
3. 실제 질문 실행
4. 품질게이트 평가
5. 오답/저신뢰 시 원인 기록
6. 사용자 피드백 반영
7. candidate knowledge 갱신
8. validated knowledge 승격
9. regression scenario 누적
10. 다음 질문에서 강화된 prior로 재사용

---

## 외부 개선 루프

1. 폐쇄망에서 생성된 기록 반출
2. 외부에서 기록 검토
3. 추출기 / 랭커 / 게이트 / 저장 구조 개선
4. `ohmyqwen` 코드베이스 수정
5. 폐쇄망에 새 버전 재반입
6. 다시 기록 축적

---

## 기대 효과

이 구조가 자리잡으면 품질 향상은 다음 방식으로 진행된다.

- 초기에는 broad retrieval + 약한 candidate knowledge
- 반복 사용 후 domain/channel/process knowledge가 점차 구조화
- 잘 맞는 흐름은 validated pack으로 승격
- 잘못된 broad tag / 오염된 graph는 지속적으로 정정
- 외부 고성능 모델의 상시 개입 없이도 정합도가 점진 상승

---

## 비목표

아래는 이 프로토콜의 목표가 아니다.

- 폐쇄망 내부 모델이 스스로 가중치를 재학습하는 것
- 사람 검증 없이 모든 지식을 자동 승격하는 것
- 타겟 프로젝트 코드 직접 접근을 전제로 운영하는 것

---

## 현재 운영 선언

앞으로 `ohmyqwen`의 품질 향상은 다음 원칙으로 진행한다.

- 폐쇄망 내부의 Qwen3 기반 지식 축적/검증 루프를 우선한다.
- 사용자의 힌트와 실제 질의 피드백을 주요 강화 입력으로 사용한다.
- 외부 지원자는 기록과 힌트만 보고 엔진을 일반화된 방식으로 개선한다.
- 타겟 프로젝트 코드베이스를 직접 볼 수 없는 조건에서도 동작 가능한 구조를 목표로 한다.
