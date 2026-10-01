// Login / register page logic
(function () {
  // Already logged in? Go straight to chat — but only if the server still knows
  // this account (a saved token can outlive its user, e.g. after a database reset).
  const savedToken = localStorage.getItem('token');
  if (savedToken) {
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${savedToken}` } })
      .then((res) => {
        if (res.ok) location.href = '/chat.html';
        else {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
      })
      .catch(() => {}); // server unreachable: stay on the sign-in page
  }

  let mode = 'login'; // or 'register'
  const $ = (id) => document.getElementById(id);
  const form = $('authForm');
  const errorBox = $('error');

  // Restart a one-shot CSS animation class on an element
  function replay(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // force reflow so the animation runs again
    el.classList.add(cls);
  }

  function setMode(next) {
    mode = next;
    const isLogin = mode === 'login';
    $('formTitle').textContent = isLogin ? 'Welcome back' : 'Create your account';
    $('formHint').textContent = isLogin
      ? 'Sign in to pick up where you left off.'
      : 'Pick a username. Your friends will see it in every chat.';
    $('submitLabel').textContent = isLogin ? 'Sign in' : 'Create account';
    $('switchText').textContent = isLogin ? 'New here?' : 'Already have an account?';
    $('switchMode').textContent = isLogin ? 'Create an account' : 'Sign in';
    $('password').autocomplete = isLogin ? 'current-password' : 'new-password';
    $('pwRule').classList.toggle('hidden', isLogin);
    hideError();
    for (const id of ['formTitle', 'formHint', 'submitLabel', 'pwRule']) replay($(id), 'swap');
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.remove('hidden');
    replay(errorBox, 'shake');
  }
  function hideError() {
    errorBox.classList.add('hidden');
  }

  $('switchMode').addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));

  // Show / hide the password so people can check what they typed
  $('togglePw').addEventListener('click', () => {
    const input = $('password');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('togglePw').textContent = show ? 'Hide' : 'Show';
    $('togglePw').setAttribute('aria-pressed', String(show));
    input.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    const username = $('username').value.trim();
    const password = $('password').value;

    if (!username || !password) return showError('Enter a username and password.');
    if (mode === 'register' && password.length < 6) return showError('Password must be at least 6 characters.');

    const btn = $('submitBtn');
    btn.disabled = true;
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      location.href = '/chat.html';
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Live sample conversation on the brand panel ----------
  // Incoming messages are preceded by a typing indicator, my replies pop in,
  // and the thread fades out and starts over.
  const demo = $('demo');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (demo) {
    const script = [
      ['meera', 'Staging is green. Want to ship before standup?', false],
      ['you', 'Yes, merging now', true],
      ['tomás', 'I’ll watch the error logs for the first hour', false],
      ['meera', 'Release notes are up in #changelog', false],
    ];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    function bubble(who, text, mine) {
      const row = document.createElement('div');
      row.className = `flex ${mine ? 'justify-end' : ''}`;
      const b = document.createElement('div');
      b.className = `max-w-[80%] rounded-2xl px-3.5 py-2 text-[15px] leading-snug ${
        mine ? 'bg-ink text-paper rounded-br-[6px] bubble-in-mine' : 'bg-mist text-ink rounded-bl-[6px] bubble-in'
      }`;
      const name = document.createElement('div');
      name.className = 'font-mono text-[10.5px] opacity-50 mb-0.5';
      name.textContent = who;
      const body = document.createElement('div');
      body.textContent = text;
      b.append(name, body);
      row.append(b);
      return row;
    }

    function typingBubble(who) {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-2 bubble-in';
      row.innerHTML =
        '<div class="typing-bounce flex gap-1 rounded-2xl rounded-bl-[6px] bg-mist px-3.5 py-3">' +
        '<span class="h-1.5 w-1.5 rounded-full bg-ink"></span><span class="h-1.5 w-1.5 rounded-full bg-ink"></span><span class="h-1.5 w-1.5 rounded-full bg-ink"></span></div>' +
        '<span class="font-mono text-[10.5px] text-ink/40"></span>';
      row.lastChild.textContent = `${who} is typing`;
      return row;
    }

    if (reduceMotion) {
      script.forEach(([who, text, mine]) => demo.append(bubble(who, text, mine)));
    } else {
      (async function play() {
        await wait(1500); // let the card finish its entrance first
        for (;;) {
          for (const [who, text, mine] of script) {
            if (!mine) {
              const t = typingBubble(who);
              demo.append(t);
              await wait(1100);
              t.remove();
            }
            demo.append(bubble(who, text, mine));
            await wait(mine ? 900 : 1300);
          }
          await wait(2600);
          for (const row of demo.children) row.classList.add('bubble-out');
          await wait(500);
          demo.innerHTML = '';
          await wait(400);
        }
      })();
    }
  }

  // ---------- 3D tilt + light sheen on the demo card ----------
  // Pointer devices only; transforms are written once per animation frame.
  const card = $('demoCard');
  if (card && !reduceMotion && window.matchMedia('(pointer: fine)').matches) {
    let frame = 0;
    card.addEventListener('pointermove', (e) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width; // 0..1
        const y = (e.clientY - r.top) / r.height;
        card.style.setProperty('--ry', `${(x - 0.5) * 10}deg`);
        card.style.setProperty('--rx', `${(0.5 - y) * 8}deg`);
        card.style.setProperty('--mx', `${x * 100}%`);
        card.style.setProperty('--my', `${y * 100}%`);
        card.classList.add('is-tracking');
      });
    });
    card.addEventListener('pointerleave', () => {
      cancelAnimationFrame(frame);
      card.classList.remove('is-tracking');
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    });
  }
})();
