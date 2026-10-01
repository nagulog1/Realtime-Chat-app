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

  function setMode(next) {
    mode = next;
    const isLogin = mode === 'login';
    $('formTitle').textContent = isLogin ? 'Welcome back' : 'Create your account';
    $('formHint').textContent = isLogin
      ? 'Sign in to pick up where you left off.'
      : 'Pick a username. Your friends will see it in every chat.';
    $('submitBtn').textContent = isLogin ? 'Sign in' : 'Create account';
    $('switchText').textContent = isLogin ? 'New here?' : 'Already have an account?';
    $('switchMode').textContent = isLogin ? 'Create an account' : 'Sign in';
    $('password').autocomplete = isLogin ? 'current-password' : 'new-password';
    $('pwRule').classList.toggle('hidden', isLogin);
    hideError();
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.remove('hidden');
  }
  function hideError() {
    errorBox.classList.add('hidden');
  }

  $('switchMode').addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));

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

  // Small looping sample conversation on the brand panel
  const demo = $('demo');
  if (demo) {
    const lines = [
      ['meera', 'Staging is green. Want to ship before standup?', false],
      ['you', 'Yes, merging now', true],
      ['tomás', 'I’ll watch the error logs for the first hour', false],
    ];
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let i = 0;
    const add = () => {
      if (i === lines.length) {
        demo.innerHTML = '';
        i = 0;
      }
      const [who, text, mine] = lines[i++];
      const row = document.createElement('div');
      row.className = `flex ${mine ? 'justify-end' : ''}`;
      const bubble = document.createElement('div');
      bubble.className = `max-w-[80%] rounded-2xl px-3.5 py-2 text-[15px] leading-snug transition-all duration-500 ${
        mine ? 'bg-ink text-paper rounded-br-[6px]' : 'bg-mist text-ink rounded-bl-[6px]'
      }`;
      if (!reduce) bubble.style.cssText = 'opacity:0;transform:translateY(8px)';
      const name = document.createElement('div');
      name.className = 'font-mono text-[10.5px] opacity-50 mb-0.5';
      name.textContent = who;
      const body = document.createElement('div');
      body.textContent = text;
      bubble.append(name, body);
      row.append(bubble);
      demo.append(row);
      if (!reduce) requestAnimationFrame(() => (bubble.style.cssText = ''));
    };
    lines.forEach(add);
    if (!reduce) {
      demo.innerHTML = '';
      i = 0;
      add();
      setInterval(add, 1800);
    }
  }
})();
