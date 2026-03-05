# Sample Task

다음은 `ohmyqwen`에 전달할 수 있는 예시 작업이다.

## Objective

- Verify 파이프라인 실패 반복 시 PATCH 전략이 승격되는지 확인

## Suggested AnalyzeInput snippet

```json
{
  "taskId": "sample-feature-001",
  "objective": "Improve verify failure handling in runner",
  "constraints": [
    "minimal-diff",
    "keep-build-green"
  ],
  "files": [
    "src/loop/runner.ts",
    "src/gates/verify.ts"
  ],
  "symbols": [
    "runLoop",
    "runQualityGates"
  ],
  "errorLogs": [],
  "diffSummary": [],
  "contextTier": "mid",
  "contextTokenBudget": 1800,
  "retryPolicy": {
    "maxAttempts": 3,
    "backoffMs": 0,
    "sameFailureLimit": 2,
    "rollbackOnVerifyFail": true
  },
  "mode": "feature",
  "clarificationAnswers": [],
  "dryRun": false
}
```
