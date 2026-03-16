# RAG Main Construction Plan

## 목적

`ohmyqwen`의 다음 본공사는 **프로젝트 특화 RAG 플랫폼 구축**이다.

현재는 검색/그래프/사전/질문응답의 기반이 갖춰져 있다.  
다음 단계에서는 이를 개별 기능의 집합으로 두지 않고, **통합 knowledge system**으로 승격한다.

이 문서는 그 방향과 우선순위를 정의한다.

---

## 현재 판단

현재 상태는 다음과 같이 본다.

- **RAG-ready foundation**: 확보됨
- **완성된 RAG 시스템**: 아직 아님

즉, 지금은 본공사에 들어갈 시점이다.

이미 갖춘 것:

- internal QMD runtime
- structure index
- front-back graph
- EAI dictionary
- learned knowledge
- domain packs / maturity
- ask / quality gate / retry loop

아직 부족한 것:

- knowledge schema 통합
- retrieval unit 정밀화
- validated knowledge lifecycle
- 질문 유형별 retrieval contract
- broad tag 오염 통제
- 평가/회귀 체계 일반화

---

## 최종 목표

폐쇄망 내부에서 Qwen3 기반으로 다음이 가능해야 한다.

1. 코드/구조/흐름/운영기록이 모두 **하나의 knowledge system**으로 축적된다.
2. 검색은 파일명이 아니라 **entity / block / flow / role** 단위로 수행된다.
3. 질문 유형별로 적절한 evidence contract와 quality gate가 적용된다.
4. 사용자 피드백과 replay 기록이 candidate knowledge를 validated knowledge로 승격시킨다.
5. 외부 지원 없이도 반복 사용을 통해 정합도가 점진 상승한다.

---

## 비목표

아래는 이번 본공사의 목표가 아니다.

- 모델 가중치 재학습
- 프로젝트별 하드코딩 규칙을 계속 추가하는 방식
- 타겟 코드베이스 직접 접근을 전제로 한 운영
- 사람이 매번 정답을 주입하는 구조

---

## 설계 원칙

### 1. Knowledge-first

검색보다 먼저 **지식 단위와 메타데이터 스키마**를 정리한다.

### 2. File-first를 버리고 Entity-first로 간다

retrieval 기본 단위를 파일에서 아래 단위로 옮긴다.

- symbol block
- route block
- controller -> service edge
- service -> downstream edge
- EAI usage block
- batch/process block
- module-role block
- learned knowledge cluster

### 3. Broad tag보다 계층형 의미 모델을 쓴다

모든 질문/증거/지식은 아래 축을 분리한다.

- channel
- domain
- subdomain
- action
- module-role
- process-role

### 4. Candidate -> Validated -> Stale lifecycle

지식은 바로 정답으로 채택하지 않는다.

- candidate
- validated
- stale / degraded

세 단계로 관리한다.

### 5. Quality gate는 질문 유형별로 달라야 한다

cross-layer, module-role, domain-overview, process/batch 질문은 각각 다른 요구 증거를 가져야 한다.

---

## 본공사 범위

## A. Knowledge Schema 통합

현재 구조화 산출물:

- structure index
- front-back graph
- EAI dictionary
- learned knowledge
- domain packs
- project profile

이를 다음 공통 스키마로 통합한다.

### Core Entity Types

- `file`
- `symbol`
- `route`
- `api`
- `controller`
- `service`
- `mapper`
- `dao`
- `eai-interface`
- `batch-job`
- `process`
- `module`
- `knowledge-cluster`

### Core Edge Types

- `declares`
- `calls`
- `routes-to`
- `maps-to`
- `uses-eai`
- `uses-mapper`
- `depends-on`
- `belongs-to-domain`
- `belongs-to-channel`
- `belongs-to-process`
- `supports-module-role`

### Shared Metadata

- `domains`
- `subdomains`
- `channels`
- `actions`
- `moduleRoles`
- `processRoles`
- `confidence`
- `evidencePaths`
- `sourceType`
- `validatedStatus`
- `updatedAt`

---

## B. Retrieval Unit 표준화

현재는 path/file 중심 retrieval 비중이 아직 높다.  
본공사에서는 아래 단위를 정식 retrieval unit으로 쓴다.

### 1. Code Block Units
- method body
- service block
- controller block
- route handler block

### 2. Flow Units
- frontend route -> API -> gateway -> controller -> service
- service -> mapper/eai/redis/async
- batch job -> step -> processor

### 3. Knowledge Units
- learned knowledge cluster
- domain/module/process/channel packs
- validated exemplars

### 4. Evidence Bundle Units
- answer를 만들 때 여러 unit을 묶은 evidence bundle

---

## C. 질문 유형 Taxonomy

질문을 아래 유형으로 분리한다.

1. `cross_layer_flow`
2. `business_capability_trace`
3. `domain_capability_overview`
4. `module_role_explanation`
5. `process_or_batch_trace`
6. `channel_or_partner_integration`
7. `config_or_resource_explanation`
8. `symbol_deep_trace`

각 질문 유형은:

- retrieval target
- evidence minimum
- quality gate
- confidence rule

를 따로 가진다.

---

## D. Knowledge Lifecycle

### Candidate

- 새로 추출됐지만 검증이 부족함
- query expansion / rerank에 soft prior로만 반영

### Validated

- 반복 적중
- quality gate 통과
- user feedback 일치
- regression 시나리오 반영

이 조건을 만족하면 승격

### Stale / Degraded

- 코드 변경으로 근거 약화
- 반복 실패
- adjacent confusion 증가

이 경우 점수 약화 또는 비활성화

---

## E. Replay / Regression 강화

사용자 질문과 피드백을 아래 구조로 누적한다.

- question
- detected type
- matched domain/channel/subdomain/action
- used evidence bundle
- confidence
- gate result
- failure reason
- user feedback
- final corrected understanding

이 기록은:

- candidate knowledge 갱신
- validated knowledge 승격
- regression suite 생성
- confidence calibration

에 사용한다.

---

## F. Quality Gate 재설계

### 1. Shape gate

구조가 이어지는가

### 2. Intent gate

질문 의미와 정합하는가

### 3. Specificity gate

broad domain이 아니라 필요한 subdomain / channel / action이 맞는가

### 4. Coverage gate

핵심 단계를 충분히 덮는가

### 5. Noise gate

adjacent flow / unrelated display/content/common infra가 과도하게 섞이지 않았는가

---

## 우선순위

### Phase 3-1. Schema and Units

1. knowledge schema 통합
2. retrieval unit 표준화
3. flow/entity bundle schema 정리

### Phase 3-2. Type-aware Retrieval

4. 질문 유형 taxonomy 적용
5. type별 retrieval contract
6. type별 gate / confidence

### Phase 3-3. Knowledge Lifecycle

7. candidate -> validated -> stale 자동화
8. replay / regression 연동
9. user feedback 승격 규칙 추가

### Phase 3-4. Evaluation

10. 도메인 전반 평가셋 확장
11. module-role / process-role / channel 질문 평가
12. confusion / substitution 지표 도입

---

## 산출물

본공사 이후 최소 산출물은 다음과 같다.

- 통합 knowledge schema 정의 문서
- standardized retrieval units
- validated knowledge store
- replay / regression corpus
- 질문 유형별 gate / confidence contract
- 운영용 quality dashboard / maturity report

---

## 완료 기준

다음 상태를 만족하면 본공사 1차 완료로 본다.

1. 새 질문이 들어오면 file path가 아니라 entity/flow bundle 중심으로 retrieval 된다.
2. broad domain 오염보다 subdomain/channel specificity가 우선 적용된다.
3. module-role / process-role / channel 질문도 별도 gate로 안정적으로 처리된다.
4. 폐쇄망 내부 운영기록이 candidate/validated knowledge에 실제 반영된다.
5. replay / regression이 품질 향상의 기본 루프가 된다.

---

## 다음 실행

즉시 시작해야 할 다음 작업은 아래 세 가지다.

1. **통합 knowledge schema 설계**
2. **retrieval unit 표준화**
3. **질문 유형 taxonomy + type별 quality gate 정의**

이 세 가지가 본공사의 시작점이다.
