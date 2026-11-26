# 운영 안내 (배포·자동 실행·백업)

배포 서버를 관리하는 사람을 위한 문서임. 앱 사용법은 [README](../README.md)에 있음.

## 1. 자동 실행

서버가 켜져 있는 동안 알아서 돎. 따로 할 일 없음.

| 무엇 | 언제 | 끄는 법 |
|---|---|---|
| 새 특허 받기 | 마지막 갱신 후 90일마다 | `.env`에 `SYNC_INTERVAL_DAYS=0` |
| AI 동향 요약 13개 | 분기마다 (1·4·7·10월) | `.env`에서 `AUTO_SUMMARY` 지우기 |

**AI 요약 자동 실행은 서버에서만 켤 것.** 노트북에서도 켜면 같은 AI 키로 두 번 만들어 사용량을 두 배로 씀.

서버가 꺼져 있으면 아무것도 안 돎. 다시 켜면 밀린 것부터 처리함.

## 2. 배포 (Railway)

화면·서버·DB를 Railway 서비스 하나에 올림. 서버 하나가 화면과 API를 함께 보내고, DB 파일은 볼륨에 둠.

| 항목 | 설정 |
|---|---|
| 플랜·지역 | Railway Hobby (결제 전까지 체험판), Southeast Asia (Singapore) |
| 저장소·브랜치 | `Eom-Jeongung/3-` · `main` (합치면 자동으로 다시 배포됨) |
| Build Command | `npm ci --prefix backend --omit=dev && npm ci --prefix frontend --include=dev && npm run build` |
| Start Command | `npm start` |
| Healthcheck Path | `/api/health` (비밀번호 없이 열림, 데이터 없음) |
| 볼륨 | `/data` (DB는 `/data/patents.db`) |

환경변수는 Railway의 Variables에 넣음. 키와 비밀번호는 채팅·문서에 적지 말 것.

| 이름 | 값 | 이유 |
|---|---|---|
| `PORT`, `API_PORT` | `8080` | Railway 공개 포트와 서버 포트를 맞춤 |
| `NODE_VERSION` | `22` | Node 22.12 이상 필요 |
| `DB_PATH` | `/data/patents.db` | 없으면 다시 배포할 때 DB가 사라짐 |
| `SITE_PASSWORD` | 팀 공용 비밀번호 (12자 이상) | 주소만 알면 누구나 AI 요약을 눌러 비용을 쓸 수 있어서 |
| `KIPRIS_API_KEY` | 발급받은 키 | 자동 갱신, 청구항 |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | `https://openrouter.ai/api/v1`, 운영팀 키, `anthropic/claude-haiku-5.5` | AI 요약 |
| `AI_INSIGHT_MODEL` | 비워 둠 | 기술 분석 보고서의 흐름·경쟁사·결론 단계만 다른 모델로 쓰고 싶을 때. 비우면 `AI_MODEL`(하이쿠)을 씀 |
| `AI_REASONING_EFFORT` | `low` | AI가 생각(추론)을 짧게 하게 함. 안 넣으면 자료가 많은 동향 요약에서 생각만 하다가 빈 답을 돌려줄 수 있음 |
| `SYNC_INTERVAL_DAYS` | `90` | 자동 갱신 주기 |
| `AUTO_SUMMARY` | `1` | 분기마다 동향 요약 13개 |

알아 둘 것

- 비밀번호를 10번 틀리면 그 접속 주소는 15분 동안 막힘. Railway가 알려 주는 실제 접속 주소(`X-Real-IP`)로 셈
- 다시 배포하는 동안 잠깐 접속이 끊김. 수정은 모아서 합치고, 시연 직전에는 `main`에 합치지 말 것
- 배포 서버가 자동 갱신·자동 요약을 맡으므로 천안 서버 `.env`는 `SYNC_INTERVAL_DAYS=0`, `AUTO_SUMMARY`는 비워 둠. 둘 다 켜면 KIPRIS·AI 한도를 두 번 씀
- 콘솔(Railway → 서비스 → Console)에서 `node`가 안 잡히면 먼저 이 줄을 실행함

```bash
export PATH="$(ls -d /mise/installs/node/*/bin | head -1):$PATH"
```

## 3. DB 백업과 복원

### 백업 (서버를 켠 채로 가능)

`VACUUM INTO`로 빈 공간을 뺀 정리본을 만들고 압축함. 주 1회와 실습서버 종료 전에 함.

```bash
cd /app/backend
node -e 'require("better-sqlite3")("/data/patents.db",{readonly:true}).exec("VACUUM INTO \x27/tmp/patents-backup.db\x27")'
node -e 'const d=require("better-sqlite3")("/tmp/patents-backup.db",{readonly:true});console.log(d.pragma("integrity_check",{simple:true}),d.prepare("select count(*) n from patents").get().n)'
gzip -9 /tmp/patents-backup.db
sha256sum /tmp/patents-backup.db.gz
```

- 두 번째 줄 결과가 `ok`이고 특허 건수가 화면과 같으면 정상임
- Railway에서는 압축 파일을 `/app`으로 복사한 뒤, 콘솔 아래 파일 창에서 파일을 오른쪽 클릭 → Download로 받음. 받은 뒤 `/app`과 `/tmp`의 복사본은 지움
- 볼륨(`/data`)에는 정리본을 만들지 말 것. 체험판 볼륨은 약 430MB라 DB 두 개가 들어가지 않음
- 백업 파일과 검증값(SHA-256)은 깃허브에 올리지 말고 팀 안에서 보관함

### 복원

1. 받은 압축 파일의 검증값이 백업할 때 적은 값과 같은지 확인함 (`sha256sum`)
2. 압축을 풀고 위 확인 명령으로 `ok`와 건수를 확인함
3. 서버를 끄고 `patents.db`를 교체함. 같은 폴더의 `patents.db-shm`, `patents.db-wal`은 지움
4. 서버를 켜고 화면의 건수와 마지막 갱신 시각을 확인함

Railway에서는 콘솔 파일 창의 Upload로 압축 파일을 `/data`에 올리고, 콘솔에서 1~3을 한 뒤 서비스를 Restart함.

