# DCP Services Project Preset (Domain Context)

이 문서는 `dcp-services` 계열 프로젝트를 대상으로, 코드가 계속 바뀌더라도 비교적 안정적인 큰 그림을 LLM에 제공하기 위한 컨텍스트 프리셋이다.

## 목적

- 삼성생명 홈페이지 백엔드에서 사용자 요청을 받아 내부/외부(특히 EAI) 처리계로 안전하게 전달한다.
- 핵심 역할은 **요청 조립 + 권한/세션/검증 + EAI 인터페이스 호출 오케스트레이션**이다.

## 상위 구조

- `dcp-*` 마이크로서비스 계열
- `dcp-core`:
  - 공통 의존성/기반 코드
  - 여러 서비스에서 공통으로 참조
- 주요 도메인 서비스:
  - `dcp-loan`, `dcp-insurance`, `dcp-member`, `dcp-retire`, `dcp-fund`, `dcp-pension`, `dcp-batch`, `dcp-cms`
- 전단 관문:
  - `dcp-gateway` (권한체크, Redis 세션, 전처리/라우팅)
- 보조/유틸 성격:
  - `dcp-async`, `dcp-upload`, `dcp-display`
- 비활성/죽은 레포 가능성:
  - `dcp-chatbot` 등

## 기술 스택 (안정 가정)

- Spring 5 MVC 기반
- Oracle + MyBatis
- Redis(세션/캐시)
- KSign 등 암복호화 연계
- 대출/보험 핵심 처리는 EAI 처리계 중심

## 분석 시 권장 원칙

1. XML 설정 근거(권한/URL/인터페이스)와 실제 Java/Kotlin 로직 근거를 분리해서 제시한다.
2. 로직 질문에는 가능하면 Controller → Service → Mapper/EAI 호출 체인으로 설명한다.
3. 근거가 XML 위주로만 존재하면 확정 결론을 피하고 누락 가능성을 명시한다.
4. EAI 인터페이스는 `interfaceId/serviceName/purpose/usage` 사전으로 관리한다.

