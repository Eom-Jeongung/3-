// 접속 비밀번호 (배포용): SITE_PASSWORD가 있으면 모든 화면·API에 비밀번호를 묻는다
// - 로그인 기능이 없어서, 주소만 알면 누구나 AI 요약을 눌러 크레딧을 쓸 수 있기 때문에 둔다
// - 브라우저 기본 로그인 창(HTTP Basic)을 쓴다. 아이디는 아무거나, 비밀번호만 맞으면 통과
// - SITE_PASSWORD가 비어 있으면(노트북·천안 서버 개발) 아무것도 하지 않는다
import crypto from 'node:crypto';

const sameText = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function siteAuth(password) {
  if (!password) return (req, res, next) => next();
  return (req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
    const given = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':') : '';
    if (sameText(given, password)) return next();
    res.set('WWW-Authenticate', 'Basic realm="LG Display Patent Trend", charset="UTF-8"');
    res.status(401).send('비밀번호가 필요해요.');
  };
}
