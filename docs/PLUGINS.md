# PLUGINS

플러그인은 런타임의 기본 루프를 깨지 않고 선택적으로 컨텍스트를 보강하는 hook 시스템이다.

## Hook 단계

- `beforeAnalyze`
- `beforePlan`
- `beforeImplement`
- `beforeVerify`

플러그인 결과는 `outputs/plugins.output.json`에 저장된다.

## 설정 파일

`config/plugins.json`

예시:

```json
{
  "plugins": [
    { "name": "context-preload", "enabled": true, "options": {} },
    { "name": "gitlab-logs", "enabled": true, "options": {} }
  ]
}
```

## 기본 플러그인

### 1) context-preload

- 역할: 사전 분석된 컨텍스트를 PLAN에 주입
- 소스: `.ohmyqwen/cache/context-preload.json`
- tier(`small/mid/big`)에 따라 주입량을 조절

### 2) gitlab-logs

- 역할: 최근 GitLab pipeline/job 요약을 읽기 전용으로 수집
- 필요 env:
  - `OHMYQWEN_GITLAB_BASE_URL`
  - `OHMYQWEN_GITLAB_PROJECT_ID`
  - `OHMYQWEN_GITLAB_TOKEN`

## Graceful Degrade

토큰/URL/프로젝트 설정이 없거나 API 호출이 실패해도 런타임은 중단되지 않는다.
플러그인은 비활성/경고로 처리되고 본 루프는 계속 진행된다.

## 보안 주의

- 플러그인은 읽기 전용 컨텍스트 수집을 기본 원칙으로 한다.
- 민감 로그를 그대로 모델 프롬프트에 넣지 말고 요약/마스킹 권장.
