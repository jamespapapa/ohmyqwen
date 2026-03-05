# OPERATIONS

폐쇄망 운영 시 `ohmyqwen` 실행/보안/장애 대응 기준.

## 1. 기본 운영 루틴

1) 실행 전
- `pnpm typecheck && pnpm test && pnpm build`
- `config/commands.allowlist.json` 검토
- 플러그인 설정(`config/plugins.json`) 점검

2) 실행
- 표준: `ohmyqwen run --input <json>`
- 재개: `ohmyqwen run --resume <runId> --input <json>`

3) 사후 점검
- `outputs/final.snapshot.json`
- `verify.log`
- `outputs/failure-summary.json` (실패 시)

## 2. 보안 가드

### Command Allowlist

- 허용 명령만 실행 (`pnpm`, `node`, `git`, `npx` 기본)
- 허용 인자 prefix + deny pattern 동시 검사
- 위험 명령은 즉시 차단

### Workspace Boundary

- 작업 디렉토리 밖 파일 수정 차단
- path escape(`../`)는 오류 처리

### Transaction / Rollback

- 패치 전 스냅샷 유지
- verify 실패 시 rollback 옵션(`retryPolicy.rollbackOnVerifyFail`) 가능

## 3. 장애 대응

### 중단/크래시

- run manifest: `.ohmyqwen/runs/<runId>/run.json`
- lock 정리 후 `--resume` 재개

### 반복 실패

- failure signature 반복 시 patch 전략 승격(small -> mid -> big)
- 전략 소진 시 `FAIL_WITH_ARTIFACT`로 종료

### 미존재 run

- API: 404 반환
- CLI: `Cannot resume: run manifest not found ...`

## 4. 트러블슈팅

### LLM 연결 실패

- env 확인: `OHMYQWEN_LLM_BASE_URL`, `OHMYQWEN_LLM_MODEL`
- 미설정이면 fallback 모드로 동작 (정상)

### verify 실패 원인 찾기

- `verify.log`에서 gate별 에러 확인
- `outputs/failure-summary.json`에서 핵심 라인/관련 파일 확인
- `objective-contract` 게이트 실패 시:
  - `scripts.start`/`scripts.dev` 누락
  - express 의존성 누락
  - 엔드포인트/응답 텍스트 불일치
  - 서버 smoke check 실패(포트/기동/응답 문제)
  를 우선 점검

### 빌드 도구 자동 감지

- verify는 워크스페이스 파일을 보고 기본 프로파일을 자동 선택한다:
  - `build.gradle*` / `gradlew` 존재 시: Gradle(`./gradlew build/test/check`)
  - `pom.xml` / `mvnw` 존재 시: Maven(`./mvnw package/test/verify`)
  - 그 외: npm(`npm run build/test/lint`)
- `gradlew`/`mvnw` 실행권한이 없으면 verify 단계에서 자동으로 실행권한을 부여해(`chmod 755`) 재시도한다.

### 도구 실행 확인

- `tools.log` JSONL에서 command/exitCode/duration/stdout/stderr 요약 확인

### 서버가 "실행된 것처럼 보이는데" 접근이 안 될 때

- 3000 포트 점유 여부 확인:
  - `lsof -nP -iTCP:3000 -sTCP:LISTEN`
- UI 서버(Next)와 생성 서버가 같은 포트를 쓰면 충돌 가능
- `PORT=3100 npm run start`처럼 포트를 바꿔 재확인

## 5. localhost 콘솔 운영

- 시작: `pnpm run serve`
- URL: `http://127.0.0.1:4311`
- API:
  - `POST /api/runs`
  - `GET /api/runs/:id`
  - `GET /api/runs/:id/events`
  - `GET /api/runs/:id/artifacts`

### available 라이브러리 allowlist 입력

- 권장: 워크스페이스에 파일 배치
  - `.ohmyqwen/available-libraries.json` 또는 `.txt`
- 대안: `POST /api/runs` payload에 직접 전달
  - `availableLibraries`, `availableLibrariesFile`, `availableLibrariesUrl`
- 파일이 없으면 allowlist를 무시하며, URL이 지정된 경우(`availableLibrariesUrl` 또는 `OHMYQWEN_AVAILABLE_LIBRARIES_URL`) fetch 후 적용한다.
