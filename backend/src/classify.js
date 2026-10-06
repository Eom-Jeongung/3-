// 기술분야 임시 분류 (데모 v1: 하드코딩 키워드 + IPC 매핑)
// 분류 체계 자체가 인터뷰에서 확인할 "가정"이므로, 규칙을 화면에 그대로 노출한다 (GET /api/tech-categories/compare)
// 위에서부터 먼저 걸리는 분류 하나만 붙인다

export const UNCLASSIFIED = '미분류';

export const TECH_RULES = [
  {
    name: '차량용',
    keywords: ['차량', '자동차', '운전자', '계기판', '클러스터', '헤드업', 'HUD', '센터페시아'],
    ipcPrefixes: ['B60K', 'B60R', 'B60Q'],
  },
  {
    name: '폴더블·탠덤',
    keywords: ['폴더블', '폴딩', '접이', '접힘', '롤러블', '슬라이더블', '탠덤', '텐덤', '복수의 발광 스택', '전하 생성층', '전하생성층'],
    ipcPrefixes: ['G06F 1/1652', 'G09F 9/301'],
  },
  {
    name: 'P-OLED',
    keywords: ['플렉서블', '플렉시블', '플라스틱 기판', '폴리이미드', '웨어러블', '스마트폰'],
    ipcPrefixes: [],
  },
  {
    name: '대형OLED',
    keywords: ['대형', '텔레비전', 'TV', '백색 유기', '백색 발광', '화이트 유기', 'WOLED', '백색 서브 화소', '백색 서브화소'],
    ipcPrefixes: [],
  },
];

export function classifyTech({ title = '', abstract = '', ipc_codes = '' }) {
  const text = `${title} ${abstract ?? ''}`;
  const ipcs = (ipc_codes ?? '').split('|').map((s) => s.trim());
  for (const rule of TECH_RULES) {
    if (rule.keywords.some((k) => text.includes(k))) return rule.name;
    if (rule.ipcPrefixes.some((p) => ipcs.some((c) => c.startsWith(p)))) return rule.name;
  }
  return UNCLASSIFIED;
}

// KIPRIS 초록(astrtCont) 검색어: '+'가 OR (예: 폴더블+롤러블)
export const toKiprisQuery = (rule) => rule.keywords.join('+');
