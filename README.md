# 특허 트렌드 센싱 대시보드 — PRD v3 구현 중

천안형 AI 교육 과제2 · 스폰서사 LG디스플레이 · 3팀

LG디스플레이(자사)와 경쟁사의 공개 특허를 KIPRIS에서 받아 기술 분야별로 분류하고,
**기간별 추이와 동향 요약을 보여주는 트렌드 대시보드**입니다. 아직 만드는 중이에요.

기업 인터뷰(2026-10-16)와 담당자님 메일 답변(2026-11-03)으로 방향이 정해졌어요. 기준 문서는 **PRD v3**입니다.

> 처음 받았다면 팀에 공유된 **DEMO_V2 팀원 실행 가이드**를 그대로 따라 하세요. 2장에도 같은 설치 방법이 있어요.

**화면 구성**

- 맨 위: 메뉴, 마지막 갱신 시각, AI 질문(보류), 새로고침 버튼
- 홈(트렌드 메인): 기간(1~10년), 단위(연간/반기), 출원인을 골라 분야별 출원 추이를 봐요. 최근 18개월은 미공개 출원이 빠져 음영으로 표시해요. 그 아래에 요약, 근거 건수와 증감률, 근거 특허, 최근 공개 동향이 나와요.
- 분야 화면: 범례나 표의 분야를 누르면 1차 → 2차 → 3차로 내려가며 그 분야의 추이와 특허 목록을 봐요.
- 특허 모아보기: 명칭·초록 검색, 출원인, 상태, 공개일, 기술 분야(1~3차)로 필터하고, 표 머리글을 눌러 정렬해요.
- 특허 상세: 행을 누르면 열려요. 초록과 대표 청구항을 나란히 보고, 분류 결과와 근거를 확인해요. 청구항은 "청구항 불러오기"를 누를 때 KIPRIS에서 받아 저장해요 (건당 1회 호출).

## 현재 진행도 (2026-11-04 기준)

**역할:** 요약 2명, 분류 2명, UX/UI 1명, 총괄 1명

**데이터**

- 전체 수집 완료: 약 8.5만 건 (자사 약 4.6만, 삼성디스플레이 약 3.9만)
- 기술 분야 분류 완료 (팀 임시 기준 v0.1): IPC 85.3%, 키워드 1.2%, 미분류 13.4%
- 건수에는 패밀리·후속 건이 포함돼요. 자사 2024년 출원이 2,145건으로 많은데, 증가폭이 실제보다 크게 보일 수 있어요. 일부 특허를 표본으로 조회해 원인을 확인할 예정이에요.

**PRD v3 대비 상태**

| 기능 | 요구사항 | 상태 |
|---|---|---|
| 분류 | 1차 디스플레이 방식, 주분류만 집계, 판정 근거 저장 | ✅ |
| | 2차 8개로 개편 (회로·공정 추가, 마이크로LED 소자 폐지) | ❌ 지금은 v0.1의 7개 |
| | 응용 태그 | ❌ |
| | 새 기술 찾기 (기타 군집화, 급증 키워드, 새 IPC) | ❌ |
| | 애매한 건의 AI 보정, AI 태그 | ❌ |
| 트렌드 | 기간, 단위, 출원인 선택 | ✅ |
| | 최근 18개월 음영과 안내 | ✅ |
| | 분류별 추이 + 분류 안에서 자사 vs 경쟁사 | 🔺 지금은 회사별 그래프 안에 분야별 선. 구조 변경 필요 |
| | BOE·CSOT·Tianma 등 경쟁사 확대 | ❌ |
| | 분기 갱신 시각 표시 | 🔺 새 특허만 받는 새로고침은 있음 |
| 동향 요약 | 사용자가 고른 분류와 기간을 고정 형식으로 요약 | ❌ 지금은 DB 숫자로 만든 규칙 기반 요약 |
| | 모델 2~3개 비교 | ❌ 시험 분야는 최근 3년 OLED 발광 소자 |
| | 근거 건수와 증감률 | ✅ |
| 화면 | 분야 드릴다운, 목록의 IPC·분류 근거 | ✅ |
| | 특허 상세의 초록·대표 청구항, 분류 근거 | ✅ |
| | KIPRIS 원문 링크 | 🔺 KIPRIS 열기와 출원번호 복사. 특허별 직접 링크는 주소를 확인하지 못함 |

**여력이 되면 (필수 범위 아님, 총괄 담당)**

- 미국 특허(USPTO)와 패밀리 정보
- 근거 특허 목록: 많이 늘어난 분야에서 건수가 가장 많이 늘어난 세부 기술의 특허를 최근 공개순으로 뽑은 예시예요. 중요도 순위는 아니고, 지금 화면에 있어요.
- AI 질문: 코드는 있지만 잠깐 보류했어요. 가짜 AI 서버로만 시험했어요.

**알아둘 점**

- 분류 대응표는 팀 문서에서 달라진 부분이 있어요. 5장 "분류 기준에서 달라진 점"을 보세요.
- 1차 "마이크로LED"는 `H10H` 코드 기준이라 일반 무기 LED도 섞여 있어요. 본문에 "마이크로 LED"가 나오는 건 2,899건 중 85건이에요.
- 3차 "기타" 비중이 커요. 요약 시험 범위의 56%가 "기타 OLED 소자"라서 3차 키워드 보강이 필요해요.
- 전체 DB는 아직 천안 서버에 없고, DB는 아직 SQLite예요. 팀 PostgreSQL로 옮길 예정이에요.

**함께 작업하는 규칙**

- 각자 `DEMO_V2`에서 브랜치를 따서 작업하고, `DEMO_V2`로 PR을 올려요. 합치는 건 총괄이 해요.
- `git add .`는 쓰지 말고 고친 파일만 골라 올려요.
- DB를 전달받은 뒤에는 새로고침을 누르지 않아요. 새 데이터가 꼭 필요하면 정해진 한 사람만 누르고 DB를 다시 공유해요.
- `npm run collect`는 실행하지 않아요. KIPRIS를 약 200회 호출해요 (월 무료 1,000회).
- `.env`와 DB 파일은 GitHub에 올리지 않아요.

---

## 1. 먼저 알아두면 좋은 개념

이 프로젝트는 **전부 JavaScript 하나로** 만들었어요. 그래서 Python 파일(`app.py` 등)은 없습니다.

| 이름 | 한 줄 설명 | 비유 |
|---|---|---|
| **JavaScript** | 웹에서 쓰는 프로그래밍 언어 | 우리가 쓰는 "언어" |
| **Node.js** | JavaScript를 브라우저 밖(내 컴퓨터)에서 실행해 주는 프로그램 | Python 파일을 돌리는 `python` 명령 같은 것 |
| **npm** | Node.js와 함께 깔리는 라이브러리 설치·실행 도구 | Python의 `pip` |
| **React** | JavaScript로 웹 화면을 만드는 도구 | 화면을 레고 블록(컴포넌트)처럼 조립 |
| **Vite** | React 화면을 개발할 때 띄워 주는 도구 | 화면용 개발 서버 |
| **Express** | JavaScript로 서버(API)를 만드는 도구 | Python의 Flask / FastAPI |
| **SQLite** | 파일 하나로 된 가벼운 데이터베이스 | 엑셀 파일처럼 생긴 DB (`backend/data/patents.db`) |
| **API** | 프로그램끼리 데이터를 주고받는 창구 | 식당 주문 창구 |
| **KIPRIS** | 특허청(한국특허정보원)의 공개 특허 데이터 서비스 | 특허 데이터 원천 |

### React를 조금 더 자세히

화면을 작은 조각(컴포넌트)으로 나눠서 만들고 조립해요. 이 대시보드는 이렇게 생겼어요.

```
App (상단 메뉴·새로고침)                   frontend/src/App.jsx
 ├─ HomePage            트렌드 메인          frontend/src/pages/HomePage.jsx
 │   └─ TrendSection    설정·그래프·요약      frontend/src/components/TrendSection.jsx
 │       └─ TrendChart  출원 추이 그래프      frontend/src/components/TrendChart.jsx
 ├─ FieldPage           분야 드릴다운        frontend/src/pages/FieldPage.jsx
 ├─ PatentsPage         특허 모아보기        frontend/src/pages/PatentsPage.jsx
 │   ├─ FilterBar       검색과 필터          frontend/src/components/FilterBar.jsx
 │   └─ PatentTable     특허 목록 표         frontend/src/components/PatentTable.jsx
 ├─ PatentDetail        특허 상세 패널        frontend/src/components/PatentDetail.jsx
 └─ AskPanel            AI 질문 패널         frontend/src/components/AskPanel.jsx
```

React의 핵심은 **"상태(state)만 바꾸면 화면이 알아서 다시 그려진다"**는 점이에요.
예를 들어 "자사" 버튼을 누르면 코드는 "지금 필터 = 자사"라는 값만 바꿔요.
그러면 버튼 색, 표 내용, 건수가 자동으로 바뀌어요.
`.jsx` 파일은 JavaScript 안에 HTML 같은 화면 코드를 섞어 쓸 수 있는 React 전용 파일입니다.

### 데이터가 흐르는 길

```
 [브라우저: React 화면]  ── /api 요청 ──▶  [백엔드: Express 서버]  ──▶  [SQLite DB]
   localhost:5173                            localhost:4000                     ▲
                                                                                 │ 전체 수집, 새로고침,
                                             [KIPRIS Open API] ──────────────────┘ 청구항 불러오기 때만 호출
```

1. **수집**: 처음 한 번 전체를 받고, 그 뒤로는 새로고침 버튼으로 새로 공개·등록된 특허만 받아요.
2. **분류**: IPC와 키워드 대응표로 1·2·3차 기술 분야를 정해요. 원본과 분리해서 저장하고, 기준이 바뀌면 다시 계산해요.
3. **표시**: 화면이 백엔드에 요청하고, DB에서 집계한 숫자로 그래프와 표를 그려요.

> 트렌드 집계와 분류는 일반 코드로 만들고, AI(LLM)는 문장 작성과 요약에만 써요. 지금 AI 연결이 필요한 기능은 AI 질문뿐이고, AI 요약은 아직 없어요.

### 왜 Python이 아니라 JavaScript인가

데모 PRD에서 아키텍쳐를 **Node.js(Express) + Vite+React**로 정했고, 그대로 따랐어요.
Python으로도 만들 수 있었지만, 이 프로젝트 조건에서는 JavaScript가 더 맞다고 판단한 이유는 다음과 같아요.

**1. 화면은 어차피 JavaScript예요 (가장 큰 이유)**

브라우저에서 돌아가는 화면 코드는 JavaScript(React)로만 만들 수 있어요. Python으로 백엔드를 만들어도 화면은 JavaScript를 따로 써야 해서
**언어가 두 개**가 돼요. JavaScript로 백엔드까지 만들면 **언어 하나**로 끝나요.

**2. 팀원 모두 두 언어에 익숙하지 않아요**

이미 어느 한쪽에 익숙한 사람이 없다면, 배워야 할 언어가 적을수록 유리해요. 한 언어만 익히면 화면과 서버 파일을 모두 읽고 고칠 수 있어요.
(Python이 문법은 더 쉬운 편이지만, Python 백엔드를 고르면 JavaScript도 같이 배워야 하는 점이 더 부담이에요.)

**3. 서버와 화면이 같은 데이터 형식(JSON)을 그대로 주고받아요**

백엔드가 JSON으로 보내면 화면이 별도 변환 없이 바로 써요. 이 프로젝트에서도 `GET /api/patents`의 응답을 화면이 그대로 표에 그려요.

**4. 설치와 실행이 단순해요**

Node.js 하나만 설치하면 서버, 화면 개발 도구(Vite), 라이브러리 설치(npm)가 모두 해결돼요. 명령 하나(`npm run dev`)로 둘 다 켜지고요.

**5. 데모 범위에는 JavaScript로 충분해요**

이 프로젝트가 하는 일은 KIPRIS 호출, DB 저장, 분류, 집계, LLM API 호출이에요. Python이 특별히 유리한 부분(대용량 데이터 분석, 머신러닝)은 아직 쓰지 않아요.

### 비교

| 항목 | JavaScript (현재) | Python |
|---|---|---|
| 화면 (React) | 그대로 사용 | 화면은 JavaScript로 따로 만들어야 함 (또는 Streamlit 같은 간이 도구) |
| 백엔드 | Express | FastAPI / Flask |
| 언어 개수 | **1개** | 2개 (백엔드 Python + 화면 JavaScript) |
| 입문 난이도 | 비동기(`async/await`) 개념이 처음엔 낯섦 | 문법이 간결해서 읽기 쉬움 |
| 이번 데모 기능 | 충분 | 충분 |
| LLM API 호출 (분류 보정, 요약 등) | 공식 SDK 있음, Python과 거의 동일 | 공식 SDK 있음 |
| 데이터 분석·통계 | 라이브러리가 적은 편 | **pandas 등 훨씬 강함** |
| 임베딩을 내 컴퓨터에서 직접 계산 | 어려움 (모델 대부분이 Python 전용) | **쉬움** |
| 학습 자료·예제 (LangChain, RAG 등) | 적은 편 | **많음** |

### 확장 과제(LLM 등)를 붙일 때는

PRD의 확장 기능 대부분은 **LLM API를 호출해서 텍스트를 보내고 답을 받는 일**이라 JavaScript로도 Python과 거의 똑같이 할 수 있어요.

| 확장 기능 | JavaScript로 가능? |
|---|---|
| 기술분야 분류 보정 | ✅ API 호출 |
| 특허 요약 정리 | ✅ API 호출 |
| 자연어 경쟁사 질의 | ✅ 대체로 가능 |
| 유사 특허 검토 (임베딩 비교) | ⚠️ 임베딩 **API**를 쓰면 가능. 내 컴퓨터에서 직접 모델을 돌리려면 Python이 유리 |
| 대량 통계·분석 리포트 | ❌ Python이 훨씬 편함 |

그래서 **지금은 JavaScript로 통일하고, 확장 단계에서 Python이 꼭 필요한 부분(임베딩 직접 계산, 데이터 분석)이 생기면 그 부분만 작은 Python 서비스로 붙이는 방식**을 염두에 두고 있어요.

```
React 화면 → Express(JavaScript) 서버 → SQLite
                    ↓ (필요한 기능만)
              Python 서비스 (임베딩, 분석)
```

### Python으로 바꾸고 싶어진다면

코드가 아직 작아서(백엔드 파일 몇 개) 옮기기 쉬운 시점이에요. 팀이 Python에 훨씬 익숙해지거나, 확장 과제의 중심이 데이터 분석·임베딩이 되면 백엔드를 FastAPI로 옮기는 걸 고려해 보세요.
화면(`frontend/`)은 그대로 쓰고 백엔드(`backend/`)만 교체하면 돼요. API 주소(`/api/patents` 등)만 같게 맞추면 화면은 수정할 필요가 없어요.

---

## 2. 처음 한 번만: 설치

### 2-1. Node.js 설치

[nodejs.org](https://nodejs.org)에서 **LTS** 버전을 받아 설치하세요. 아래 명령으로 설치해도 됩니다.

```powershell
winget install OpenJS.NodeJS.LTS
```

설치가 끝나면 **VS Code를 완전히 껐다가 다시 열고** 터미널에서 확인합니다. 버전 번호가 나오면 성공이에요.

```powershell
node -v
```

### 2-2. 키 넣기 (필요한 사람만)

화면을 보는 데는 키가 필요 없어요. 청구항 불러오기나 수집을 할 때만 KIPRIS 키를 넣으세요.

1. [plus.kipris.or.kr](https://plus.kipris.or.kr)에 가입합니다.
2. **「특허·실용 공개·등록공보」** 서비스를 장바구니에 담고, 무료 플랜으로 신청을 끝까지 완료합니다.
3. 마이페이지에서 인증키를 복사합니다.
4. `backend/.env.example`을 복사해 `backend/.env`를 만들고 키를 넣습니다. 내 노트북에서는 `API_PORT=4000`으로 두세요.

```
KIPRIS_API_KEY=여기에_인증키
API_PORT=4000
DB_PATH=./data/patents.db
```

동향 요약을 개발하려면 AI 설정도 넣습니다. 키는 총괄에게 따로 받아요. 이 값들만 바꾸면 OpenRouter든 사내 AI 서버든 그대로 동작해요.

```
AI_BASE_URL=https://openrouter.ai/api/v1
AI_API_KEY=여기에_키
AI_MODEL=anthropic/claude-sonnet-5.5
```

> ⚠️ `.env`에는 비밀 키가 들어 있어서 GitHub에 올라가지 않도록 `.gitignore`에 넣어 뒀어요. 키를 채팅방이나 문서, 캡처에 올리지 마세요.

### 2-3. 라이브러리 설치와 DB 생성

VS Code에서 **이 폴더(PJ.2_DEMO)를 연 상태로** 터미널(`` Ctrl+` ``)을 열고 실행합니다.

```powershell
npm run setup
```

### 2-4. 처음 데이터 넣기

**팀원에게서 DB 파일을 받았다면** `backend/data/patents.db`를 덮어쓰고 끝이에요. 서버를 끈 상태에서 하고, `patents.db-shm`, `patents.db-wal`이 있으면 지워요. 분류 결과도 그 안에 들어 있어요. KIPRIS 무료 한도(월 1,000회)를 아끼려면 이 방법을 쓰세요.

**DB 파일이 없다면** 전체 수집과 분류를 차례로 실행합니다.

```powershell
npm run collect --prefix backend
```

```powershell
npm run classify --prefix backend
```

전체 수집은 KIPRIS를 약 200회 호출하니 **팀에서 한 번만** 실행하세요. 중간에 끊겨도 다시 실행하면 이어서 받아요.

---

## 3. 매번: 실행하기

```powershell
npm run dev
```

명령 하나로 백엔드(API)와 화면(WEB)이 함께 켜져요. 로그 앞에 `[API]`, `[WEB]`이 붙어서 어느 쪽 출력인지 구분됩니다.
브라우저에서 **http://localhost:5173** 을 여세요. 끌 때는 터미널에서 `Ctrl+C`를 누릅니다.

> 🖥️ **천안 서버에서 실행할 때:** 포트를 따로 정하지 않아도 돼요. 화면은 내 포트(`echo $PORT`, 예: 3053), 백엔드는 `$PORT + 100`(예: 3153)으로 자동으로 켜집니다.
> `backend/.env`는 `backend/.env.example`을 복사해 만들고, `API_PORT`는 비워 두세요.
> 브라우저는 VS Code 아래 **PORTS 탭 → 내 포트 옆 지구본**으로 엽니다. 끌 때는 `Ctrl+C` 또는 `devstop` (`pkill node`는 VS Code까지 꺼지니 쓰지 마세요).

> 💡 `cd backend && npm run dev`처럼 `&&`를 쓰면 VS Code 기본 터미널(Windows PowerShell 5.1)에서 오류가 나요.
> 위의 `npm run dev`는 `&&` 없이 루트에서 바로 실행되도록 만들어 두었어요.
> 명령 두 개를 이어서 실행하고 싶으면 `&&` 대신 `;`를 쓰세요. 예: `cd backend; npm run sync`

| 명령 (루트에서 실행) | 하는 일 |
|---|---|
| `npm run setup` | 처음 한 번: 라이브러리 설치와 DB 테이블 생성 |
| `npm run dev` | 백엔드와 화면을 함께 실행 |
| `npm run sync` | 새로 공개·등록된 특허만 받기 (화면의 새로고침 버튼과 같은 일, 보통 4회 호출) |
| `npm run collect --prefix backend` | 전체 특허 수집 (처음 한 번, 약 200회 호출) |
| `npm run classify --prefix backend` | 대응표(`backend/classification/*.csv`)를 DB에 넣고 전체 특허를 다시 분류 (KIPRIS 호출 없음) |

---

## 4. 코드 지도: 어디에 뭐가 있나

```
PJ.2_DEMO/
├─ package.json             루트 실행 명령 (setup / dev / sync)
├─ backend/                 서버 (Express + SQLite)
│  ├─ .env                  API 키·포트 (비공개, 직접 만들어야 함)
│  ├─ .env.example          .env 견본 (항목 이름만)
│  ├─ data/patents.db       DB 파일 (GitHub에 안 올라감)
│  ├─ classification/       분류 대응표 (ipc_map.csv, keyword_map.csv)
│  ├─ sql/classification.sql  분류·청구항 테이블 정의
│  ├─ scripts/              수동 실행용 스크립트 (DB 생성, 전체 수집, 새로고침, 재분류, API 테스트)
│  └─ src/
│     ├─ index.js           ★ 서버 시작점 (Python의 app.py 역할)
│     ├─ db.js              DB 연결과 테이블 정의
│     ├─ kipris.js          KIPRIS API 호출 (검색, 청구항)
│     ├─ sync.js            새로고침: 새 특허만 받아 저장·분류
│     ├─ classify.js        v1 임시 분류 (tech_category, 교체 예정)
│     ├─ classification.js  기술 분야 분류기 (기준 v0.1, 결과는 classification 테이블)
│     ├─ trendData.js       트렌드 집계 (AI 없이 DB만)
│     ├─ ai.js              AI 호출 (OpenAI 호환 형식, 이 파일에만 둠)
│     ├─ ask.js             AI 질문: 해석 → DB 조회 → 문장 작성·숫자 검사
│     └─ routes/            API 주소별 처리
│        ├─ ask.js            POST /api/ask, GET /api/ask/status
│        ├─ patents.js        GET /api/patents (목록·필터·정렬), GET /api/patents/:id, POST /api/patents/:id/claims
│        ├─ sync.js           POST /api/sync (새로고침)
│        ├─ techCategories.js GET /api/tech-categories/compare (기술분야 비교, 지금 화면에서는 안 씀)
│        └─ trends.js         GET /api/trends/series (출원 추이), GET /api/trends/overview (공개 동향)
└─ frontend/                화면 (Vite + React)
   └─ src/
      ├─ App.jsx            ★ 상단 메뉴와 화면 전환
      ├─ index.css          색상·디자인
      ├─ pages/             화면 (HomePage 트렌드 메인, FieldPage 분야 드릴다운, PatentsPage 특허 모아보기)
      ├─ hooks/             특허 목록을 나눠 받는 usePatentList
      └─ components/        화면 조각들 (TrendSection, TrendChart, FilterBar, PatentTable, PatentDetail, AskPanel)
```

### 자주 고칠 곳

| 바꾸고 싶은 것 | 파일 | 찾을 곳 |
|---|---|---|
| 기술 분야 분류 기준 | `backend/classification/*.csv` | 고친 뒤 `npm run classify --prefix backend` |
| 대상 회사 (자사/경쟁사) | `backend/src/kipris.js` | `APPLICANTS` |
| 증감률을 표시할 최소 건수 (지금 30건) | `backend/src/trendData.js` | `MIN_COUNT` |
| 근거 특허 건수·규칙 | `backend/src/trendData.js` | `selectEvidence` |
| AI 모델 | `backend/.env` | `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` |
| 색상 | `frontend/src/index.css` | 맨 위 `:root { ... }` |

`backend/src`를 고치면 서버가 자동으로 다시 시작되고, `frontend/src`를 고치면 브라우저에 바로 반영돼요.
대상 회사를 바꿨다면 `npm run collect --prefix backend`로 데이터를 다시 받아야 해요.

---

## 5. 범위와 설계 메모 (PRD v3 기준)

PRD v3의 핵심 기능은 기술 분야 분류, 트렌드 지표, 기간별 동향 요약 세 가지예요. 개별 특허 요약은 후순위예요. 진행 상태는 맨 위 "현재 진행도"를 보세요.

**하지 않는 것 (PRD)**

- 만료 임박 알림, 심사청구·연차료 기한 관리
- 공개 전 특허
- 특허 검색 자체 (모아보기의 검색은 목록을 찾기 위한 보조 기능이에요)
- 특허 침해·무효 같은 법적 판단
- 사내 특허 DB 실제 연동
- 매일 자동 갱신 (분기 갱신으로 충분)

### 날짜 기준

- **출원 추이 그래프는 출원일 기준**이에요. PRD대로 기술이 언제 나왔는지 보여 주고, 아직 공개되지 않은 최근 18개월 구간은 음영으로 표시해요.
- **최근 공개 동향 표는 공개일 기준**이에요. 최근 12개월을 이전 구간과 비교하지만, 공개된 특허는 대체로 1년 반쯤 전에 출원한 기술이에요.

### 분류 기준에서 달라진 점

팀 문서 "특허 분류 기준 v0.1"을 따르되, 아래는 문서와 달라요. 팀 확인이 필요해요.

- **대응표:** 문서의 표를 옮겨 `backend/classification/`에 직접 만들었어요. 문서에 나온 CSV 파일은 받지 못했어요.
- **대응표에 없는 첫 IPC:** 키워드로 추정하지 않고 미분류로 둬요. 추정하면 로봇 아암이 광학으로 가는 식의 오분류가 생겼어요.
- **`H10K 59` 세부 코드 19줄 추가:** 예: `59/131`(배선)은 TFT 소자, `59/38`(컬러필터)은 광학, `59/40`(터치)은 설계. 어느 2차로 보낼지는 임시 판단이에요.
- **대응표 4줄 추가:** `G09G 3`, `G06F 3`은 설계, `G09F 9`, `G06F 1`은 기구.
- **동점 처리:** 1차는 공통, 2차는 미분류, 3차는 표에서 먼저 나온 항목으로 정했어요.
- **키워드 비교:** 띄어쓰기와 대소문자를 무시해요.

### 구현 중 알게 된 점

- **출원인명:** KIPRIS에서 `LG디스플레이`로 검색하면 0건이 나와요. 등록된 표기가 `엘지디스플레이 주식회사`라서 `엘지디스플레이`로 검색합니다.
- **청구항:** 목록 API에는 없고 상세 API에 있어요. 특허 1건당 1회 호출이라 전체를 미리 받지 않고, 상세에서 요청한 특허만 저장해요.
- **환경변수 이름:** 포트 설정은 `API_PORT`를 먼저 보고, 없으면 `$PORT + 100`을 써요. 천안 서버 규칙에 맞춘 거예요.
- **설치 설정:** `backend/.npmrc`의 `ignore-scripts=true`는 `better-sqlite3`를 다시 빌드하다 Visual Studio가 없어 실패하는 문제를 막아요. 이 설정 때문에 `predev`는 실행되지 않지만, `.env`가 없어도 서버는 켜져요.
- **만료일:** 인터뷰에서 범위에서 빠져 화면에는 없어요. `expiry_date` 칸은 DB에 남아 있어요.
- **v1 코드:** `backend/src/classify.js`, `routes/techCategories.js`, `tech_category_stats` 테이블은 v1에서 남은 것으로, 지금 화면에서는 쓰지 않아요.
