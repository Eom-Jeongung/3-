// 접속 비밀번호 (배포용): SITE_PASSWORD가 있으면 모든 화면·API에 비밀번호를 묻는다
// - 로그인 기능이 없어서, 주소만 알면 누구나 AI 요약을 눌러 크레딧을 쓸 수 있기 때문에 둔다
// - 브라우저 기본 로그인 창(HTTP Basic)을 쓴다. 아이디는 아무거나, 비밀번호만 맞으면 통과
// - 같은 주소에서 비밀번호를 10번 틀리면 15분 동안 막아, 비밀번호를 하나씩 대입해 보는 공격을 막는다
// - SITE_PASSWORD가 비어 있으면(노트북·천안 서버 개발) 아무것도 하지 않는다
import crypto from 'node:crypto';

const MAX_FAILURES = 10;
const LOCK_MS = 15 * 60 * 1000;
const MAX_TRACKED_ADDRESSES = 10_000; // 기록이 끝없이 늘어 메모리를 채우지 않게 하는 상한

const sameText = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Railway는 실제 접속 주소를 X-Real-IP로 알려 준다
// X-Forwarded-For 맨 뒤 값은 연결마다 바뀌는 중간 서버 주소라서, 기준으로 쓰면 다른 사용자까지 함께 막힌다
const clientAddress = (req) => req.headers['x-real-ip']?.trim() || req.socket?.remoteAddress || 'unknown';

export function siteAuth(password, { maxFailures = MAX_FAILURES, lockMs = LOCK_MS, now = Date.now } = {}) {
  if (!password) return (req, res, next) => next();
  const failures = new Map(); // 접속 주소 → { count, resetAt }

  return (req, res, next) => {
    const address = clientAddress(req);
    const time = now();
    const record = failures.get(address);
    if (record && record.resetAt <= time) failures.delete(address);
    else if (record && record.count >= maxFailures) {
      // 잠긴 동안에는 맞는 비밀번호도 확인하지 않는다 (응답 차이로 정답을 알아낼 수 없게)
      res.set('Retry-After', String(Math.ceil((record.resetAt - time) / 1000)));
      return res.status(429).send('비밀번호를 여러 번 틀렸어요. 15분 뒤 다시 시도해 주세요.');
    }

    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
    const given = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':') : '';
    if (sameText(given, password)) {
      failures.delete(address);
      return next();
    }

    // 브라우저는 처음에 비밀번호 없이 접속하므로, 비밀번호를 보낸 요청만 실패로 센다
    if (req.headers.authorization) {
      const current = failures.get(address);
      if (!current && failures.size >= MAX_TRACKED_ADDRESSES) failures.delete(failures.keys().next().value);
      failures.set(address, { count: (current?.count ?? 0) + 1, resetAt: time + lockMs });
    }
    res.set('WWW-Authenticate', 'Basic realm="LG Display Patent Trend", charset="UTF-8"');
    res.status(401).send('비밀번호가 필요해요.');
  };
}
