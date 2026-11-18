# CLAUDE.md

이 파일은 이 저장소에서 일하는 Claude가 먼저 읽는 작업 규칙이다. 팀원 누구의 Claude든 똑같이 따른다.

## 프로젝트 한 줄 소개

LG디스플레이(자사)·삼성디스플레이·중국 4사(BOE·CSOT·Tianma·Visionox)의 한국 공개 특허를 KIPRIS에서 받아,
기술 분야별 출원 흐름과 AI 동향 요약을 보여 주는 웹 대시보드 **"LG Display 특허 트렌드 센싱"**.

- 작업 브랜치: `patent-trend` (DEMO_V1·DEMO_V2는 데모 시절 기록, 새 작업은 올리지 않는다)
- 팀원은 `patent-trend`에서 자기 브랜치를 만들어 작업하고, 합치는 것은 저장소 관리자가 한다

## 꼭 지킬 규칙

1. **사용자에게 보이는 글은 모두 한국어.** 답변, 질문, 진행 안내, 커밋 메시지까지. 경험이 적은 팀원도 읽는다는 생각으로 쉬운 말로 쓴다.
2. **커밋·푸시는 사용자가 하라고 할 때만.** 고친 뒤에는 무엇을 바꿨는지 알려 주고 기다린다.
3. **커밋 메시지에 Claude 표시를 넣지 않는다.** `Co-Authored-By: Claude …`, `Generated with Claude Code` 같은 줄 금지. 작성자는 작업한 사람 본인.
4. **키·비밀번호는 절대 코드·채팅·로그·커밋에 넣지 않는다.** 값은 사람이 `backend/.env`에 직접 넣고, Claude는 변수 이름만 다룬다. `.env`는 커밋 금지, 새 변수는 `backend/.env.example`에 이름과 설명만 추가.
5. **기술 분류에는 AI를 쓰지 않는다.** 정확도는 무작위 100건 검증 → 규칙(`backend/classification/*.csv`, `classification.js`) 보강을 반복해서 올린다.
6. **AI는 설정값만 바꾸면 교체되게.** AI 호출은 `backend/src/ai.js` 한 곳에서만, OpenAI 호환 형식으로. 모델·주소는 `AI_BASE_URL`·`AI_API_KEY`·`AI_MODEL` 환경변수로만 바꾼다 (사내 AI로 옮길 수 있어야 함).
7. **숫자는 DB, 문장은 AI.** 건수·증감률은 SQL로 계산하고, AI에는 계산된 숫자를 넘겨 문장만 쓰게 한다. AI가 숫자를 지어내게 하지 않는다.
8. **`package-lock.json`은 설치하다 바뀐 것이면 커밋하지 않는다.** 라이브러리를 새로 추가한 경우에만 함께 올린다.

## 화면 5개와 담당 파일

화면마다 담당 팀원이 정해져 있다. 내 화면이 아닌 파일을 고쳐야 하면 먼저 사용자에게 알린다.

| 사이드바 메뉴 | 화면 파일 (`frontend/src/`) | 주로 쓰는 백엔드 (`backend/src/`) |
|---|---|---|
| 대시보드 | `pages/HomePage.jsx`, `components/DashCharts.jsx` | `trendData.js` (`/api/trends/overview`, `/series`) |
| 기술 분야별 분석 | `pages/FieldPage.jsx`, `components/FieldPicker.jsx`, `TrendChart.jsx` | `trendData.js` |
| AI 동향 요약 | `pages/SummaryPage.jsx`, `components/AiSummaryPanel.jsx` | `trendSummary.js`, `autoSummary.js`, `summaryCheck.js`, `routes/summaries.js` |
| 신기술 탐지 | `pages/EmergingPage.jsx` | `emerging.js` (`/api/trends/emerging`) |
| 특허 목록 | `pages/PatentsPage.jsx`, `components/FilterBar.jsx`, `PatentTable.jsx`, `hooks/usePatentList.js` | `routes/patents.js`, `patentSummary.js` |

**여러 화면이 같이 쓰는 파일 — 고치기 전에 사용자에게 먼저 확인:**
- `frontend/src/index.css` (전체 디자인·색 변수) — 디자인 담당이 관리
- `frontend/src/App.jsx` (사이드바·상단 검색), `components/Icon.jsx`
- `components/TrendSection.jsx` (대시보드·기술 분야별 분석), `components/PatentDetail.jsx`·`PatentSummary.jsx` (모든 화면에서 열리는 특허 상세)
- `backend/src/db.js` (테이블), `classification.js`·`backend/classification/*.csv` (분류 규칙 — 모든 화면 숫자가 바뀜), `ai.js`, `sync.js`, `scheduler.js`

## 디자인 규칙

- Figma 'DISPLAY INSIGHT' 시안 기준: 왼쪽 남보라 사이드바, 밝은 회청색 바탕, 둥근 흰 카드, 보라 포인트.
- 색은 `index.css` 맨 위 `:root`의 변수만 쓴다 (`--accent`, `--own`, `--competitor`, `--china`, `--series-1~8` 등). 새 색을 직접 적지 않는다.
- 다크 모드는 `prefers-color-scheme`으로 자동 전환 — 새 색 변수를 만들면 다크 값도 같이 넣는다.
- 휴대폰 폭(375px)에서도 가로로 넘치지 않게. 넓은 표는 `.table-wrap` 안에 넣는다.
- 아이콘은 `components/Icon.jsx`의 선 아이콘을 쓴다.

## 실행과 확인

```bash
npm run setup                      # 처음 한 번: 라이브러리 설치 + DB 생성
npm run dev                        # 개발 서버 (화면 + 백엔드 함께)
npx oxlint src                     # frontend 폴더에서: 코드 검사
npx vite build --outDir /tmp/build-check   # frontend 폴더에서: 빌드가 되는지만 확인 (dist를 덮지 않게)
```

- **천안 공용 서버:** 화면 포트는 `$PORT`(예: user53 → 3053), 백엔드는 `$PORT + 100`. 남의 포트를 쓰지 않는다. 브라우저는 VS Code PORTS 탭 포워딩(localhost:$PORT)으로 연다.
- 서버 끄기는 `devstop`(내 것만). **`pkill node` 금지** — VS Code와 Claude Code까지 꺼진다.
- `ssh`로 명령만 보내면 `$PORT`가 비어 있다. 이때는 `bash -lc "devstop"`, `bash -lc "nohup npm run dev > ~/patent-trend-dev.log 2>&1 < /dev/null &"`처럼 로그인 셸로 실행한다.
- 화면을 고쳤으면 브라우저에서 직접 열어 보고, 콘솔 오류가 없는지까지 확인한 뒤 "확인했다"고 말한다. 확인 못 했으면 못 했다고 말한다.

## 데이터와 자동 작업

- DB: SQLite `backend/data/patents.db` (커밋 안 됨). 특허 기본 정보 + 분류(`classification` 테이블) + 요약(`trend_summaries`, `patent_summaries`).
- 날짜 기준: 추이 그래프는 **출원일**, 최근 동향·KPI는 **공개일**. 출원 후 약 18개월 뒤 공개되므로 최근 1~2년 출원은 "미공개 출원 반영 전"으로 음영 표시한다.
- 자동 갱신: 서버가 켜져 있으면 마지막 갱신 후 90일(`SYNC_INTERVAL_DAYS`)마다 새 특허를 받는다. 화면에 새로고침 버튼은 없다.
- 자동 요약: `AUTO_SUMMARY=1`인 서버에서만 분기마다 AI 동향 요약을 만든다 (노트북에서 켜면 무료 한도를 두 번 씀).
- KIPRIS는 월 무료 호출 수가 정해져 있다. 전체 수집(`npm run collect --prefix backend`)은 사용자 허락 없이 돌리지 않는다.
- 중국 4사는 한국에 낸 출원만이라 실제 규모보다 작다. 화면 설명에 이 점을 남긴다.

## 자주 쓰는 백엔드 명령 (`backend` 폴더 기준 `npm run …`)

| 명령 | 하는 일 |
|---|---|
| `sync` | 마지막 갱신 이후 새 특허만 받기 |
| `classify` | 분류 규칙을 고친 뒤 전체 재분류 |
| `auto-summary` | 분기 AI 요약 수동 실행 (`-- --all`이면 전체 다시) |
| `ai-usage` | AI 호출 기록·사용량 확인 |
| `probe` | KIPRIS API 연결 테스트 |
