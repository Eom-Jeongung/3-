// better-sqlite3 연결 및 스키마 초기화
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = process.env.DB_PATH || './data/patents.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 필드명은 KIPRIS getAdvancedSearch 실제 응답(docs/kipris-sample.xml) 기준으로 맞춤
// 날짜는 KIPRIS의 YYYYMMDD를 YYYY-MM-DD로 변환해 저장
export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS patents (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      application_number TEXT NOT NULL UNIQUE,              -- applicationNumber
      applicant_name     TEXT NOT NULL,                     -- applicantName
      applicant_type     TEXT NOT NULL CHECK (applicant_type IN ('own', 'competitor')),
      title              TEXT NOT NULL,                     -- inventionTitle
      application_date   TEXT NOT NULL,                     -- applicationDate
      registration_date  TEXT,                              -- registerDate (미등록이면 NULL)
      register_number    TEXT,                              -- registerNumber
      open_date          TEXT,                              -- openDate (공개일)
      legal_status       TEXT NOT NULL,                     -- registerStatus 원문 (공개/등록/소멸/거절 등)
      ipc_codes          TEXT,                              -- ipcNumber, '|' 구분 원문
      expiry_date        TEXT,                              -- 계산값: 특허 출원일+20년, 실용신안 +10년
      tech_category      TEXT NOT NULL DEFAULT '미분류',     -- 대형OLED/P-OLED/차량용/폴더블·탠덤/미분류
      abstract           TEXT,                              -- astrtCont
      drawing_url        TEXT,                              -- drawing (대표도면 썸네일, 100x100)
      big_drawing_url    TEXT,                              -- bigDrawing (대표도면 원본, 확대 팝업용)
      last_synced_at     TEXT NOT NULL,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_patents_expiry ON patents (expiry_date);
    CREATE INDEX IF NOT EXISTS idx_patents_type_status ON patents (applicant_type, legal_status);
    CREATE INDEX IF NOT EXISTS idx_patents_open_date ON patents (open_date); -- 트렌드 기간 집계, 목록 정렬용
    CREATE INDEX IF NOT EXISTS idx_patents_application_date ON patents (application_date);
    DROP INDEX IF EXISTS idx_patents_trend;
    -- 분류와 묶어 집계할 때 초록이 든 본문을 읽지 않도록
    CREATE INDEX IF NOT EXISTS idx_patents_covering ON patents (application_number, application_date, open_date, applicant_type);
    CREATE INDEX IF NOT EXISTS idx_patents_registration_date ON patents (registration_date);

    CREATE TABLE IF NOT EXISTS sync_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at          TEXT NOT NULL DEFAULT (datetime('now')),
      source          TEXT NOT NULL CHECK (source IN ('manual', 'scheduled')),
      records_fetched INTEGER NOT NULL DEFAULT 0,
      records_changed INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL
    );

    -- 기술분야별 전체 포트폴리오 건수 (KIPRIS 초록 키워드 검색 totalCount)
    -- 샘플 100건만으로는 분야 비교가 불가능해 추가한 테이블
    CREATE TABLE IF NOT EXISTS tech_category_stats (
      tech_category  TEXT NOT NULL,
      applicant_type TEXT NOT NULL CHECK (applicant_type IN ('own', 'competitor')),
      total_count    INTEGER NOT NULL,
      query          TEXT NOT NULL,
      synced_at      TEXT NOT NULL,
      PRIMARY KEY (tech_category, applicant_type)
    );

    -- 데모 v1 범위 밖, 스키마만 미리 설계
    CREATE TABLE IF NOT EXISTS scraps (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      patent_id INTEGER NOT NULL REFERENCES patents(id) ON DELETE CASCADE,
      saved_at  TEXT NOT NULL DEFAULT (datetime('now')),
      note      TEXT
    );
  `);
  db.exec(fs.readFileSync(new URL('../sql/classification.sql', import.meta.url), 'utf8'));
}

// LIKE의 특수문자를 글자 그대로 찾도록 처리
export const likePattern = (s) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;

// 이미 만들어진 DB에 나중에 추가한 컬럼 (CREATE TABLE IF NOT EXISTS는 기존 테이블을 바꾸지 않음)
function migrate() {
  const cols = db.prepare('PRAGMA table_info(patents)').all().map((c) => c.name);
  if (!cols.includes('big_drawing_url')) db.exec('ALTER TABLE patents ADD COLUMN big_drawing_url TEXT');
  const classificationCols = db.prepare('PRAGMA table_info(classification)').all().map((c) => c.name);
  if (!classificationCols.includes('basis_detail')) db.exec('ALTER TABLE classification ADD COLUMN basis_detail TEXT');
}

// 다른 모듈이 import 시점에 prepare 하므로 연결 직후 스키마를 보장
initSchema();
migrate();
