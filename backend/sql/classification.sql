-- 특허 분류 테이블 (팀 문서 "특허 분류 기준 v0.1"의 DB 저장 구조)
-- 원본(patent_ipc) / 기준(ipc_map, keyword_map) / 결과(classification)를 나눈다
-- 기준이 바뀌면 대응표만 고치고 결과를 다시 계산한다. 팀 DB로 옮길 때 이 파일을 다시 실행한다

-- 원본: 특허의 IPC 전부, 순서와 함께 ('첫 번째 IPC 기준' 규칙에 필요)
CREATE TABLE IF NOT EXISTS patent_ipc (
  application_number TEXT NOT NULL REFERENCES patents(application_number),
  ipc_code           TEXT NOT NULL,
  seq                INTEGER NOT NULL,                  -- 1부터
  PRIMARY KEY (application_number, seq)
);

-- 기준: IPC 앞자리 → 1차(방식 코드) 또는 2차. 같은 앞자리가 2차 여러 개에 걸릴 수 있다 (예: H10K 59)
CREATE TABLE IF NOT EXISTS ipc_map (
  ipc_prefix       TEXT NOT NULL,
  level1           TEXT,
  level2           TEXT,
  criteria_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ipc_map_version ON ipc_map (criteria_version);

-- 기준: 키워드 → 1차(방식 키워드) 또는 2차·3차
CREATE TABLE IF NOT EXISTS keyword_map (
  level1           TEXT,
  level2           TEXT,
  level3           TEXT,
  keyword          TEXT NOT NULL,
  criteria_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_keyword_map_version ON keyword_map (criteria_version);

-- 결과: 특허마다 주분류 1행 + 부분류 N행
CREATE TABLE IF NOT EXISTS classification (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  application_number TEXT NOT NULL REFERENCES patents(application_number),
  level1             TEXT NOT NULL,                     -- 1차: 디스플레이 방식
  level2             TEXT NOT NULL,                     -- 2차: 기술 영역 (못 정하면 '미분류')
  level3             TEXT,                              -- 3차: 세부 기술 (부분류·미분류는 NULL)
  is_primary         INTEGER NOT NULL DEFAULT 1,        -- 주분류 1, 부분류 0
  basis              TEXT NOT NULL,                     -- 근거 (IPC / 키워드 / 미분류)
  basis_detail       TEXT,                              -- 근거가 된 IPC 코드 (화면 표시용)
  criteria_version   TEXT NOT NULL,                     -- 기준 버전 (v0.1 ...)
  classified_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_classification_number ON classification (application_number);
CREATE INDEX IF NOT EXISTS idx_classification_levels ON classification (level1, level2, level3);
-- 집계가 본문을 읽지 않고 색인만으로 끝나도록 (최신 버전 찾기, 분야별 건수)
CREATE INDEX IF NOT EXISTS idx_classification_current ON classification (criteria_version, is_primary, level1, level2, level3, application_number);

-- 원본: KIPRIS에서 받은 청구항 (특허 1건당 호출 1회라 상세에서 요청한 특허만 저장)
CREATE TABLE IF NOT EXISTS patent_claims (
  application_number TEXT NOT NULL REFERENCES patents(application_number),
  seq                INTEGER NOT NULL,                  -- 1부터
  claim              TEXT NOT NULL,
  fetched_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (application_number, seq)
);
