// 접속 비밀번호 (배포용): SITE_PASSWORD가 있으면 모든 화면·API에 비밀번호를 묻는다
// - 로그인 기능이 없어서, 주소만 알면 누구나 AI 요약을 눌러 크레딧을 쓸 수 있기 때문에 둔다
// - 로그인하지 않은 채 화면을 열면 비밀번호 입력 화면(loginPage.js)을 보여 준다
// - 비밀번호가 맞으면 7일 동안 유지되는 로그인 쿠키를 준다. 비밀번호를 바꾸면 쿠키 값도 바뀌어 모두 다시 로그인한다
// - 같은 주소에서 비밀번호를 10번 틀리면 15분 동안 막아, 비밀번호를 하나씩 대입해 보는 공격을 막는다
//   틀릴 때마다 남은 횟수를 알려 준다
// - SITE_PASSWORD가 비어 있으면(노트북·천안 서버 개발) 아무것도 하지 않는다
import crypto from 'node:crypto';
import { loginPage } from './loginPage.js';

const MAX_FAILURES = 10;
const LOCK_MS = 15 * 60 * 1000;
const MAX_TRACKED_ADDRESSES = 10_000; // 기록이 끝없이 늘어 메모리를 채우지 않게 하는 상한
const COOKIE = 'site_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const LOGIN_PATH = '/api/login';

const sameText = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Railway는 실제 접속 주소를 X-Real-IP로 알려 준다
// X-Forwarded-For 맨 뒤 값은 연결마다 바뀌는 중간 서버 주소라서, 기준으로 쓰면 다른 사용자까지 함께 막힌다
const clientAddress = (req) => req.headers['x-real-ip']?.trim() || req.socket?.remoteAddress || 'unknown';

const readCookie = (req, name) => {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
};

const minutesLeft = (ms) => Math.max(1, Math.ceil(ms / 60_000));

export function siteAuth(password, { maxFailures = MAX_FAILURES, lockMs = LOCK_MS, now = Date.now } = {}) {
  if (!password) return (req, res, next) => next();
  const failures = new Map(); // 접속 주소 → { count, resetAt }
  // 쿠키에는 비밀번호 대신, 비밀번호로 만든 서명 값을 넣는다
  const token = crypto.createHmac('sha256', password).update('site-session-v1').digest('base64url');
  const lockMinutes = minutesLeft(lockMs);

  const sendLocked = (res, waitMs) => {
    res.set('Retry-After', String(Math.ceil(waitMs / 1000)));
    return res.status(429).json({
      error: `비밀번호를 ${maxFailures}번 틀려서 접속이 차단됐어요. ${minutesLeft(waitMs)}분 뒤 다시 시도해 주세요.`,
      locked: true,
      retryAfter: Math.ceil(waitMs / 1000),
    });
  };

  const login = (req, res) => {
    const address = clientAddress(req);
    const time = now();
    let record = failures.get(address);
    if (record && record.resetAt <= time) {
      failures.delete(address);
      record = undefined;
    }
    // 잠긴 동안에는 맞는 비밀번호도 확인하지 않는다 (응답 차이로 정답을 알아낼 수 없게)
    if (record && record.count >= maxFailures) return sendLocked(res, record.resetAt - time);

    const given = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!given) return res.status(400).json({ error: '비밀번호를 입력해 주세요.' }); // 빈 입력은 실패로 세지 않는다
    if (sameText(given, password)) {
      failures.delete(address);
      const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      res.set('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`);
      return res.json({ ok: true });
    }

    if (!record && failures.size >= MAX_TRACKED_ADDRESSES) failures.delete(failures.keys().next().value);
    const count = (record?.count ?? 0) + 1;
    failures.set(address, { count, resetAt: time + lockMs });
    if (count >= maxFailures) return sendLocked(res, lockMs);
    const remaining = maxFailures - count;
    return res.status(401).json({
      error: '비밀번호가 틀렸어요.',
      remaining,
      warning: `${remaining}번 더 틀리면 ${lockMinutes}분 동안 접속이 차단돼요.`,
    });
  };

  return (req, res, next) => {
    if (req.path === LOGIN_PATH && req.method === 'POST') return login(req, res);

    const session = readCookie(req, COOKIE);
    if (session && sameText(session, token)) return next();

    if (req.path.startsWith('/api/')) return res.status(401).json({ error: '로그인이 필요해요.', login: true });
    // 화면 요청에는 비밀번호 입력 화면을 보여 준다. 로그인하면 같은 주소를 다시 불러온다
    res.set('Cache-Control', 'no-store');
    return res.status(401).type('html').send(loginPage({ maxFailures, lockMinutes }));
  };
}
