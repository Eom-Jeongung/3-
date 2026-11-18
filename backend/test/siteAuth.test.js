import test from 'node:test';
import assert from 'node:assert/strict';
import { siteAuth } from '../src/siteAuth.js';

const PASSWORD = 'correct-password';
const basic = (password) => `Basic ${Buffer.from(`user:${password}`).toString('base64')}`;

function call(guard, { password, realIp = '203.0.113.1', forwardedFor = '10.0.0.1' } = {}) {
  const headers = { 'x-real-ip': realIp, 'x-forwarded-for': forwardedFor };
  if (password !== undefined) headers.authorization = basic(password);
  const result = { status: null, headers: {}, passed: false };
  const res = {
    set(name, value) { result.headers[name] = value; return this; },
    status(code) { result.status = code; return this; },
    send() { return this; },
  };
  guard({ headers, socket: {} }, res, () => { result.passed = true; });
  return result;
}

function guardWithClock() {
  const clock = { time: 1_000_000 };
  return { clock, guard: siteAuth(PASSWORD, { maxFailures: 3, lockMs: 60_000, now: () => clock.time }) };
}

test('비밀번호 설정이 없으면 그대로 통과한다', () => {
  assert.equal(call(siteAuth('')).passed, true);
});

test('비밀번호 없이 접속한 요청은 401이지만 실패 횟수로 세지 않는다', () => {
  const { guard } = guardWithClock();
  for (let i = 0; i < 5; i++) assert.equal(call(guard).status, 401);
  assert.equal(call(guard, { password: PASSWORD }).passed, true);
});

test('정해진 횟수를 틀리면 맞는 비밀번호도 잠시 막고, 시간이 지나면 다시 열린다', () => {
  const { clock, guard } = guardWithClock();
  for (let i = 0; i < 3; i++) assert.equal(call(guard, { password: 'wrong' }).status, 401);

  const locked = call(guard, { password: PASSWORD });
  assert.equal(locked.status, 429);
  assert.equal(locked.passed, false);
  assert.equal(locked.headers['Retry-After'], '60');

  clock.time += 60_000;
  assert.equal(call(guard, { password: PASSWORD }).passed, true);
});

test('맞는 비밀번호를 넣으면 실패 횟수가 지워진다', () => {
  const { guard } = guardWithClock();
  for (let round = 0; round < 3; round++) {
    call(guard, { password: 'wrong' });
    call(guard, { password: 'wrong' });
    assert.equal(call(guard, { password: PASSWORD }).passed, true);
  }
});

test('중간 서버 주소가 연결마다 바뀌어도 실제 접속 주소로 잠그고, 다른 접속자는 막지 않는다', () => {
  const { guard } = guardWithClock();
  for (let i = 0; i < 3; i++) call(guard, { password: 'wrong', forwardedFor: `10.0.0.${i}` });

  assert.equal(call(guard, { password: PASSWORD, forwardedFor: '10.9.9.9' }).status, 429);
  assert.equal(call(guard, { password: PASSWORD, realIp: '203.0.113.2', forwardedFor: '10.0.0.1' }).passed, true);
});
