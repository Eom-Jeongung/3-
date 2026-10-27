# 특허 현황 대시보드 — 데모 v1 (가정 검증용 초안)

천안형 AI 교육 과제2 · 스폰서사 LG디스플레이

LG디스플레이(자사)와 삼성디스플레이(경쟁사)의 특허를 KIPRIS 공개 데이터에서 가져와
**만료일·상태별로 보여주는 대시보드**입니다. 기업 인터뷰 전에 우리 가정이 맞는지 확인하려고 만든
**러프한 초안**이에요. 완성품이 아닙니다.

**화면 구성**

- 맨 위: 마지막 갱신 시각과 새로고침 버튼
- 가운데: 특허 목록 표. 자사/경쟁사와 상태로 필터하고(**⏰ 만료임박만** 버튼 포함), 표 머리글을 눌러 정렬하고, 6개월 안에 만료되는 특허에는 배지가 붙어요. **행을 누르면 오른쪽에 상세 패널**(일정, IPC, 초록, 도면)이 열려요.
- 아래: 자사와 경쟁사의 기술분야를 나란히 비교하는 막대

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
App (대시보드 전체)                       frontend/src/App.jsx
 ├─ FilterBar           필터 버튼           frontend/src/components/FilterBar.jsx
 ├─ PatentTable         특허 목록 표         frontend/src/components/PatentTable.jsx
 ├─ PatentDetail        행 클릭 시 상세 패널  frontend/src/components/PatentDetail.jsx
 └─ TechCategoryCompare 기술분야 비교 막대   frontend/src/components/TechCategoryCompare.jsx
```

React의 핵심은 **"상태(state)만 바꾸면 화면이 알아서 다시 그려진다"**는 점이에요.
예를 들어 "자사" 버튼을 누르면 코드는 "지금 필터 = 자사"라는 값만 바꿔요.
그러면 버튼 색, 표 내용, 건수가 자동으로 바뀌어요.
`.jsx` 파일은 JavaScript 안에 HTML 같은 화면 코드를 섞어 쓸 수 있는 React 전용 파일입니다.

### 데이터가 흐르는 길

```
 [브라우저: React 화면]  ── /api/patents 요청 ──▶  [백엔드: Express 서버]  ──▶  [SQLite DB]
   localhost:5173                                    localhost:4000                     ▲
                                                                                         │ 새로고침 버튼을
                                                     [KIPRIS Open API] ──────────────────┘ 누를 때만 호출
```

1. **수집**: 새로고침을 누르면 백엔드가 KIPRIS에서 특허 데이터를 받아 와요.
2. **가공·저장**: 날짜 형식을 바꾸고, 만료예정일(출원일+20년)을 계산하고, 기술분야를 분류해서 DB에 저장해요. 바뀐 특허만 갱신합니다.
3. **표시**: 화면이 백엔드에 목록을 요청하고, 받은 데이터로 표와 막대그래프를 그려요.

> AI(LLM)는 아직 쓰지 않아요. PRD 계획대로 핵심 기능은 일반 코드로 만들고, LLM은 확장 기능에서만 쓸 예정입니다.

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

이번 데모가 하는 일은 KIPRIS 호출, 날짜 계산, DB 저장, 목록 조회, 필터와 정렬이에요. Python이 특별히 유리한 부분(대용량 데이터 분석, 머신러닝)은 아직 쓰지 않아요.

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

### 2-2. KIPRIS API 키 넣기

1. [plus.kipris.or.kr](https://plus.kipris.or.kr)에 가입합니다.
2. **「특허·실용 공개·등록공보」** 서비스를 장바구니에 담고, 무료 플랜으로 신청을 끝까지 완료합니다.
3. 마이페이지에서 인증키를 복사합니다.
4. `backend/.env` 파일을 만들고 아래 내용을 넣습니다. 팀원에게서 받은 `.env`가 있으면 그 파일을 그대로 넣어도 돼요.

```
KIPRIS_API_KEY=여기에_인증키
API_PORT=4000
DB_PATH=./data/patents.db
```

> ⚠️ `.env`에는 비밀 키가 들어 있어서 GitHub에 올라가지 않도록 `.gitignore`에 넣어 뒀어요. 키를 채팅방이나 문서에 붙여넣지 마세요.

### 2-3. 라이브러리 설치와 DB 생성

VS Code에서 **이 폴더(PJ.2_DEMO)를 연 상태로** 터미널(`` Ctrl+` ``)을 열고 실행합니다.

```powershell
npm run setup
```

### 2-4. 처음 데이터 가져오기

```powershell
npm run sync
```

`수집 100건 / 변경 100건`이 나오면 성공이에요.

---

## 3. 매번: 실행하기

```powershell
npm run dev
```

명령 하나로 백엔드(API)와 화면(WEB)이 함께 켜져요. 로그 앞에 `[API]`, `[WEB]`이 붙어서 어느 쪽 출력인지 구분됩니다.
브라우저에서 **http://localhost:5173** 을 여세요. 끌 때는 터미널에서 `Ctrl+C`를 누릅니다.

> 💡 `cd backend && npm run dev`처럼 `&&`를 쓰면 VS Code 기본 터미널(Windows PowerShell 5.1)에서 오류가 나요.
> 위의 `npm run dev`는 `&&` 없이 루트에서 바로 실행되도록 만들어 두었어요.
> 명령 두 개를 이어서 실행하고 싶으면 `&&` 대신 `;`를 쓰세요. 예: `cd backend; npm run sync`

| 명령 (루트에서 실행) | 하는 일 |
|---|---|
| `npm run setup` | 처음 한 번: 라이브러리 설치와 DB 테이블 생성 |
| `npm run dev` | 백엔드와 화면을 함께 실행 |
| `npm run sync` | KIPRIS에서 데이터 수집 (화면의 새로고침 버튼과 같은 일) |

---

## 4. 코드 지도: 어디에 뭐가 있나

```
PJ.2_DEMO/
├─ package.json             루트 실행 명령 (setup / dev / sync)
├─ backend/                 서버 (Express + SQLite)
│  ├─ .env                  API 키·포트 (비공개, 직접 만들어야 함)
│  ├─ data/patents.db       DB 파일 (sync하면 생김)
│  ├─ docs/kipris-sample.xml  KIPRIS 실제 응답 예시
│  ├─ scripts/              수동 실행용 스크립트 (DB 생성, 수집, API 테스트)
│  └─ src/
│     ├─ index.js           ★ 서버 시작점 (Python의 app.py 역할)
│     ├─ db.js              DB 연결과 테이블 정의
│     ├─ kipris.js          KIPRIS API 호출
│     ├─ sync.js            수집 → 만료일 계산 → 분류 → DB 저장
│     ├─ classify.js        기술분야 분류 규칙 (키워드·IPC)
│     └─ routes/            API 주소별 처리
│        ├─ patents.js        GET /api/patents (목록·필터·정렬), GET /api/patents/:id
│        ├─ sync.js           POST /api/sync (새로고침)
│        └─ techCategories.js GET /api/tech-categories/compare (기술분야 비교)
└─ frontend/                화면 (Vite + React)
   └─ src/
      ├─ App.jsx            ★ 대시보드 전체 틀
      ├─ index.css          색상·디자인
      └─ components/        화면 조각들 (FilterBar, PatentTable, TechCategoryCompare)
```

### 자주 고칠 곳 (인터뷰 후 바로 바꿀 만한 것)

| 바꾸고 싶은 것 | 파일 | 찾을 곳 |
|---|---|---|
| 만료임박 기준 (지금 6개월) | `backend/src/routes/patents.js` | `EXPIRING_MONTHS = 6` |
| 기술분야 분류명·키워드 | `backend/src/classify.js` | `TECH_RULES` |
| 대상 회사 (자사/경쟁사) | `backend/src/kipris.js` | `APPLICANTS` |
| 샘플 건수·구성 | `backend/src/sync.js` | `sampleBuckets()` |
| 색상 | `frontend/src/index.css` | 맨 위 `:root { ... }` |

`backend/src`를 고치면 서버가 자동으로 다시 시작되고, `frontend/src`를 고치면 브라우저에 바로 반영돼요.
KIPRIS 쪽 설정(회사, 키워드, 샘플)을 바꿨다면 새로고침 버튼이나 `npm run sync`로 데이터를 다시 받아야 해요.

---

## 5. 데모 범위 (PRD 기준)

**포함**

- KIPRIS 실제 연동 (자사와 경쟁사 각 50건, 총 100건)
- 특허 목록 표
- 만료일·상태 정렬과 필터
- 만료임박 강조
- 자사 vs 경쟁사 기술분야 비교

**제외 (일부러 안 만듦)**

- 자동 갱신 스케줄러
- 알림
- 자연어 질의
- 유사특허 플래그
- 로그인
- 엑셀 다운로드
- PostgreSQL
- 해외 특허

### PRD에서 달라진 점

- **출원인명:** KIPRIS에서 `LG디스플레이`로 검색하면 0건이 나와요. 등록된 표기가 `엘지디스플레이 주식회사`라서 `엘지디스플레이`로 검색합니다.
- **스키마 컬럼 추가:** KIPRIS 실제 응답에 맞춰 `ipc_codes`, `register_number`, `open_date`, `drawing_url`을 추가했어요. 응답에 대표도면 이미지 URL도 들어 있었어요.
- **기술분야 비교 방식:** 샘플 100건은 대부분 2006~2007년 LCD 특허라서 분류 결과가 98건 미분류였어요. 그래서 KIPRIS 전체 출원을 분야 키워드로 검색한 **건수**로 비교합니다. 이 결과는 `tech_category_stats` 테이블에 저장해요.
- **환경변수 이름:** `PORT`를 `API_PORT`로 바꿨어요. 실행 환경이 `PORT`를 미리 정해두면 충돌이 났기 때문이에요.
- **만료일 계산:** 출원일+20년(실용신안은 +10년)으로 단순 계산해요. 존속기간 연장과 연차료 미납으로 인한 조기 소멸은 반영하지 않았어요.
