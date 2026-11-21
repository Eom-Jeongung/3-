import test from 'node:test';
import assert from 'node:assert/strict';
import { siteAuth } from '../src/siteAuth.js';

const PASSWORD = 'correct-password';

// 가짜 요청을 보내고 상태 코드·헤더·응답 본문을 돌려받는다
function call(guard, { path = '/', method = 'GET', password, cookie, realIp = '203.0.113.1', forwardedFor = '10.0.0.1', proto } = {}) {
  const headers = { 'x-real-ip': realIp, 'x-forwarded-for': forwardedFor };
  if (cookie) headers.cookie = cookie;
  if (proto) headers['x-forwarded-proto'] = proto;
  const req = { path, method, headers, socket: {}, body: password === undefined ? undefined : { password } };
  const result = { status: 200, headers: {}, body: null, type: null, passed: false };
  const res = {
    set(name, value) { result.headers[name] = value; return this; },
    status(code) { result.status = code; return this; },
    type(t) { result.type = t; return this; },
    send(body) { result.body = body; return this; },
    json(body) { result.body = body; return this; },
  };
  guard(req, res, () => { result.passed = true; });
  return result;
}

const login = (guard, password, extra = {}) => call(guard, { path: '/api/login', method: 'POST', password, ...extra });
const sessionCookie = (result) => result.headers['Set-Cookie'].split(';')[0];

function guardWithClock() {
  const clock = { time: 1_000_000 };
  return { clock, guard: siteAuth(PASSWORD, { maxFailures: 3, lockMs: 60_000, now: () => clock.time }) };
}

test('비밀번호 설정이 없으면 그대로 통과한다', () => {
  assert.equal(call(siteAuth('')).passed, true);
});

test('로그인하지 않고 화면을 열면 비밀번호 입력 화면을, API는 401 JSON을 준다', () => {
  const { guard } = guardWithClock();
  const page = call(guard, { path: '/' });
  assert.equal(page.passed, false);
  assert.equal(page.type, 'html');
  assert.match(page.body, /접속 비밀번호/);
  assert.equal(page.body.includes(PASSWORD), false);

  const api = call(guard, { path: '/api/patents' });
  assert.equal(api.status, 401);
  assert.equal(api.body.login, true);
});

test('맞는 비밀번호면 로그인 쿠키를 주고, 그 쿠키로 화면과 API가 열린다', () => {
  const { guard } = guardWithClock();
  const ok = login(guard, PASSWORD, { proto: 'https' });
  assert.equal(ok.body.ok, true);
  const setCookie = ok.headers['Set-Cookie'];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.equal(setCookie.includes(PASSWORD), false); // 쿠키에 비밀번호를 그대로 넣지 않는다

  const cookie = sessionCookie(ok);
  assert.equal(call(guard, { path: '/', cookie }).passed, true);
  assert.equal(call(guard, { path: '/api/patents', cookie: `other=1; ${cookie}` }).passed, true);
  assert.equal(call(guard, { path: '/', cookie: 'site_session=forged' }).passed, false);
});

test('비밀번호를 바꾸면 예전 로그인 쿠키는 더 이상 통하지 않는다', () => {
  const { guard } = guardWithClock();
  const cookie = sessionCookie(login(guard, PASSWORD));
  const changed = siteAuth('new-password-123');
  assert.equal(call(changed, { path: '/', cookie }).passed, false);
});

test('틀릴 때마다 남은 횟수를 알려 주고, 다 쓰면 맞는 비밀번호도 잠시 막는다', () => {
  const { clock, guard } = guardWithClock();
  const first = login(guard, 'wrong');
  assert.equal(first.status, 401);
  assert.equal(first.body.remaining, 2);
  assert.match(first.body.warning, /2번 더 틀리면 1분 동안 접속이 차단돼요/);
  assert.equal(login(guard, 'wrong').body.remaining, 1);

  const third = login(guard, 'wrong');
  assert.equal(third.status, 429);
  assert.equal(third.body.locked, true);
  assert.equal(third.headers['Retry-After'], '60');

  const locked = login(guard, PASSWORD);
  assert.equal(locked.status, 429);
  assert.equal(locked.headers['Set-Cookie'], undefined);

  clock.time += 60_000;
  assert.equal(login(guard, PASSWORD).body.ok, true);
});

test('빈 비밀번호와 로그인하지 않은 화면 요청은 실패로 세지 않는다', () => {
  const { guard } = guardWithClock();
  for (let i = 0; i < 5; i++) {
    assert.equal(login(guard, '').status, 400);
    call(guard, { path: '/' });
  }
  assert.equal(login(guard, 'wrong').body.remaining, 2);
});

test('맞는 비밀번호를 넣으면 실패 횟수가 지워진다', () => {
  const { guard } = guardWithClock();
  for (let round = 0; round < 3; round++) {
    login(guard, 'wrong');
    login(guard, 'wrong');
    assert.equal(login(guard, PASSWORD).body.ok, true);
  }
});

test('중간 서버 주소가 연결마다 바뀌어도 실제 접속 주소로 잠그고, 다른 접속자는 막지 않는다', () => {
  const { guard } = guardWithClock();
  for (let i = 0; i < 3; i++) login(guard, 'wrong', { forwardedFor: `10.0.0.${i}` });

  assert.equal(login(guard, PASSWORD, { forwardedFor: '10.9.9.9' }).status, 429);
  assert.equal(login(guard, PASSWORD, { realIp: '203.0.113.2' }).body.ok, true);
});
