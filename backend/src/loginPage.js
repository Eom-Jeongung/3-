// 비밀번호 입력 화면 (siteAuth.js가 로그인하지 않은 화면 요청에 보내 준다)
// - 로그인 전에는 화면 코드(frontend/dist)를 내려주지 않으므로, 이 화면은 HTML 하나에 글꼴·색·동작을 모두 담는다
// - 색과 로고는 대시보드(frontend/src/index.css)의 사이드바·카드·보라 강조색을 그대로 따른다
export function loginPage({ maxFailures, lockMinutes }) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>LG Display 특허 트렌드 센싱 · 로그인</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #f4f5f9; --surface: #ffffff; --text: #1b1d2a; --muted: #646a7e; --faint: #7c8296;
  --hairline: rgba(27, 29, 42, 0.09); --field: #f4f5f9;
  --accent: #6c4ae8; --accent-text: #ffffff; --focus: rgba(108, 74, 232, 0.45);
  --side-bg: #1f1b3e; --lg: #a50034;
  --warn: #c2410c; --warn-soft: #fff1e6; --danger: #b4232f; --danger-soft: #fdecee;
  --shadow: 0 1px 2px rgba(27, 29, 42, 0.04), 0 12px 40px rgba(27, 29, 42, 0.08);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #12121a; --surface: #1c1c27; --text: #f2f2f7; --muted: #a3a6b6; --faint: #8d90a0;
    --hairline: rgba(255, 255, 255, 0.11); --field: #23232f;
    --accent: #a08bff; --accent-text: #111111; --focus: rgba(160, 139, 255, 0.5);
    --warn: #ff9f6b; --warn-soft: rgba(255, 159, 107, 0.16); --danger: #ff8a93; --danger-soft: rgba(255, 138, 147, 0.14);
    --shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  min-height: 100vh; display: grid; place-items: center; padding: 24px 16px;
  background: var(--bg); color: var(--text);
  font-family: 'Pretendard', 'Noto Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', 'Segoe UI', system-ui, sans-serif;
  font-size: 15px; line-height: 1.47; letter-spacing: -0.02em; -webkit-font-smoothing: antialiased;
}
.panel { width: 100%; max-width: 420px; background: var(--surface); border: 1px solid var(--hairline); border-radius: 18px; box-shadow: var(--shadow); overflow: hidden; }
.brand { display: flex; align-items: center; gap: 12px; padding: 22px 28px; background: var(--side-bg); color: #fff; }
.logo { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: var(--lg); font-size: 14px; font-weight: 700; flex: none; }
.brand-text { font-size: 16px; font-weight: 700; line-height: 1.25; letter-spacing: 0; }
.brand-text small { display: block; font-size: 13px; font-weight: 500; color: rgba(255, 255, 255, 0.72); }
.body { padding: 30px 28px 28px; }
h1 { font-size: 22px; font-weight: 800; letter-spacing: -0.03em; margin: 0 0 6px; }
.lead { margin: 0 0 22px; color: var(--muted); font-size: 14px; }
label { display: block; font-size: 13px; font-weight: 600; color: var(--muted); margin-bottom: 8px; }
.field { display: flex; align-items: center; background: var(--field); border: 1px solid var(--hairline); border-radius: 10px; transition: border-color 0.15s, box-shadow 0.15s; }
.field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--focus); }
.field.bad { border-color: var(--danger); }
input { flex: 1; min-width: 0; border: 0; background: none; color: var(--text); font: inherit; font-size: 16px; padding: 13px 14px; outline: none; }
.toggle { border: 0; background: none; color: var(--faint); font: inherit; font-size: 13px; font-weight: 600; padding: 0 14px; cursor: pointer; align-self: stretch; }
.toggle:hover { color: var(--accent); }
button.go { width: 100%; margin-top: 16px; border: 0; border-radius: 10px; padding: 13px; background: var(--accent); color: var(--accent-text); font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; transition: opacity 0.15s; }
button.go:hover { opacity: 0.92; }
button.go:disabled, input:disabled { cursor: not-allowed; opacity: 0.55; }
.msg { margin: 16px 0 0; padding: 12px 14px; border-radius: 10px; font-size: 14px; display: none; }
.msg.show { display: block; }
.msg strong { display: block; font-size: 14px; margin-bottom: 2px; }
.msg.error { background: var(--danger-soft); color: var(--danger); }
.msg.warn { background: var(--warn-soft); color: var(--warn); }
.msg .count { font-weight: 800; }
.dots { display: flex; gap: 4px; margin-top: 8px; }
.dots i { flex: 1; height: 4px; border-radius: 2px; background: currentColor; opacity: 0.2; }
.dots i.used { opacity: 0.85; }
.foot { margin: 20px 0 0; color: var(--faint); font-size: 12.5px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
</head>
<body>
<main class="panel">
  <div class="brand"><span class="logo" aria-hidden="true">LG</span><span class="brand-text">LG Display<small>특허 트렌드 센싱</small></span></div>
  <form class="body" id="form" novalidate>
    <h1>접속 비밀번호</h1>
    <p class="lead">팀에서 받은 비밀번호를 입력하면 대시보드로 들어가요.</p>
    <label for="pw">비밀번호</label>
    <div class="field" id="field">
      <input id="pw" name="password" type="password" autocomplete="current-password" autofocus required aria-describedby="msg">
      <button type="button" class="toggle" id="toggle" aria-pressed="false">보기</button>
    </div>
    <button class="go" id="go" type="submit">들어가기</button>
    <div class="msg" id="msg" role="alert" aria-live="assertive"></div>
    <p class="foot">${maxFailures}번 틀리면 ${lockMinutes}분 동안 접속이 차단돼요. 로그인은 이 기기에서 7일 동안 유지돼요.</p>
  </form>
</main>
<script>
(() => {
  const MAX = ${maxFailures};
  const form = document.getElementById('form');
  const pw = document.getElementById('pw');
  const go = document.getElementById('go');
  const msg = document.getElementById('msg');
  const field = document.getElementById('field');
  const toggle = document.getElementById('toggle');
  let timer;

  toggle.addEventListener('click', () => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    toggle.textContent = show ? '숨기기' : '보기';
    toggle.setAttribute('aria-pressed', String(show));
    pw.focus();
  });

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function show(kind, html) { msg.className = 'msg show ' + kind; msg.innerHTML = html; }
  function setBusy(busy) { go.disabled = busy; go.textContent = busy ? '확인하는 중…' : '들어가기'; }

  function lock(seconds, text) {
    clearInterval(timer);
    pw.disabled = true; go.disabled = true; toggle.disabled = true;
    field.classList.add('bad');
    let left = seconds;
    const draw = () => {
      const m = Math.floor(left / 60), s = left % 60;
      show('error', '<strong>접속이 차단됐어요</strong>' + esc(text) + '<br>남은 시간 <span class="count">' + m + '분 ' + String(s).padStart(2, '0') + '초</span>');
    };
    draw();
    timer = setInterval(() => {
      left -= 1;
      if (left > 0) return draw();
      clearInterval(timer);
      pw.disabled = false; go.disabled = false; toggle.disabled = false;
      field.classList.remove('bad');
      show('warn', '<strong>다시 입력할 수 있어요</strong>비밀번호를 확인하고 다시 시도해 주세요.');
      go.textContent = '들어가기';
      pw.focus();
    }, 1000);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pw.value) { field.classList.add('bad'); show('warn', '비밀번호를 입력해 주세요.'); pw.focus(); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw.value }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { go.textContent = '들어가는 중…'; location.reload(); return; }
      setBusy(false);
      if (res.status === 429) { pw.value = ''; return lock(data.retryAfter || 900, data.error || ''); }
      field.classList.add('bad');
      if (res.status === 401 && typeof data.remaining === 'number') {
        const used = MAX - data.remaining;
        const dots = Array.from({ length: MAX }, (_, i) => '<i class="' + (i < used ? 'used' : '') + '"></i>').join('');
        show(data.remaining <= 3 ? 'error' : 'warn',
          '<strong>' + esc(data.error) + ' 남은 기회 <span class="count">' + data.remaining + '번</span></strong>' + esc(data.warning) +
          '<div class="dots" aria-hidden="true">' + dots + '</div>');
      } else {
        show('warn', esc(data.error || '잠시 뒤 다시 시도해 주세요.'));
      }
      pw.select();
    } catch {
      setBusy(false);
      show('warn', '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
    }
  });
  pw.addEventListener('input', () => field.classList.remove('bad'));
})();
</script>
</body>
</html>`;
}
