// Main chat page logic
(function () {
  const token = localStorage.getItem('token');
  const me = JSON.parse(localStorage.getItem('user') || 'null');
  if (!token || !me) {
    location.href = '/';
    return;
  }

  const $ = (id) => document.getElementById(id);
  const state = {
    rooms: [],
    users: [],
    online: new Set(),
    active: null, // { type: 'room' | 'dm', id }
    unread: {}, // key -> count
    typers: {}, // key -> Map(userId -> username)
    oldestLoaded: null,
    loadingOlder: false,
    noMoreHistory: false,
  };
  const keyOf = (type, id) => `${type}:${id}`;

  // ---------- helpers ----------
  async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    if (res.status === 401) return logout();
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    location.href = '/';
  }

  // Saved login whose account no longer exists (e.g. database was reset) -> back to sign in
  fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
    .then((res) => {
      if (res.status === 401 || res.status === 404) logout();
    })
    .catch(() => {}); // server unreachable: the reconnect logic below handles it

  // Muted earth tones from one warm family, so avatars sit quietly next to each other
  const AVATAR_COLORS = ['#8A6F4E', '#5E7A6B', '#9B5B4B', '#5B6B8A', '#7A6A8E', '#A07C3B', '#4F7C7A'];
  function avatarColor(name) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }
  function avatar(name, size = 'h-8 w-8 text-[11px]') {
    const el = document.createElement('div');
    el.className = `${size} shrink-0 rounded-[9px] grid place-items-center font-semibold tracking-wide text-white`;
    el.style.background = avatarColor(name);
    el.textContent = name.slice(0, 2).toUpperCase();
    return el;
  }

  function formatTime(date) {
    return new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function formatDay(date) {
    const d = new Date(date);
    const today = new Date();
    const yesterday = new Date(Date.now() - 864e5);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
  }

  // ---------- profile ----------
  $('meName').textContent = me.username;
  const meAv = $('meAvatar');
  meAv.textContent = me.username.slice(0, 2).toUpperCase();
  meAv.style.background = avatarColor(me.username);
  meAv.classList.add('text-white');
  $('logoutBtn').addEventListener('click', () => {
    socket.disconnect();
    logout();
  });

  // ---------- mobile sidebar ----------
  function toggleSidebar(open) {
    $('sidebar').classList.toggle('-translate-x-full', !open);
    $('backdrop').classList.toggle('hidden', !open);
  }
  $('menuBtn').addEventListener('click', () => toggleSidebar(true));
  $('backdrop').addEventListener('click', () => toggleSidebar(false));

  // ---------- sidebar lists ----------
  function navItem({ active, label, sub, leading, badge, onClick }) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = `w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[14px] transition active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal ${
      active ? 'bg-white text-ink shadow-soft ring-1 ring-line/80' : 'text-ink/75 hover:bg-white/60 hover:text-ink'
    }`;
    if (active) btn.setAttribute('aria-current', 'true');
    btn.append(leading);
    const text = document.createElement('div');
    text.className = 'flex-1 min-w-0';
    const l = document.createElement('div');
    l.className = `truncate ${badge || active ? 'font-medium text-ink' : ''}`;
    l.textContent = label;
    text.append(l);
    if (sub) {
      const s = document.createElement('div');
      s.className = 'truncate text-xs text-ink/45';
      s.textContent = sub;
      text.append(s);
    }
    btn.append(text);
    if (badge) {
      const b = document.createElement('span');
      b.className = 'min-w-5 h-5 px-1.5 rounded-md bg-signal text-white font-mono text-[11px] font-medium tabular-nums grid place-items-center';
      b.textContent = badge > 99 ? '99+' : badge;
      btn.append(b);
    }
    btn.addEventListener('click', onClick);
    li.append(btn);
    return li;
  }

  function renderRooms() {
    const ul = $('roomList');
    ul.innerHTML = '';
    for (const room of state.rooms) {
      const key = keyOf('room', room._id);
      const hash = document.createElement('div');
      hash.className = 'h-8 w-8 shrink-0 rounded-[9px] bg-ink/[0.06] grid place-items-center font-mono text-[13px] text-ink/60';
      hash.textContent = '#';
      ul.append(
        navItem({
          active: state.active && keyOf(state.active.type, state.active.id) === key,
          label: room.name,
          leading: hash,
          badge: state.unread[key],
          onClick: () => openConversation('room', room._id),
        })
      );
    }
  }

  function renderUsers() {
    const ul = $('userList');
    ul.innerHTML = '';
    // Online users first, then alphabetical
    const users = [...state.users].sort(
      (a, b) => state.online.has(b._id) - state.online.has(a._id) || a.username.localeCompare(b.username)
    );
    $('noUsers').classList.toggle('hidden', users.length > 0);
    for (const u of users) {
      const key = keyOf('dm', u._id);
      const online = state.online.has(u._id);
      const wrap = document.createElement('div');
      wrap.className = 'relative';
      wrap.append(avatar(u.username));
      const dot = document.createElement('span');
      dot.className = `absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-mist ${online ? 'bg-live' : 'bg-ink/20'}`;
      dot.title = online ? 'Online' : 'Offline';
      wrap.append(dot);
      ul.append(
        navItem({
          active: state.active && keyOf(state.active.type, state.active.id) === key,
          label: u.username,
          sub: online ? 'Online' : lastSeenText(u.lastSeen),
          leading: wrap,
          badge: state.unread[key],
          onClick: () => openConversation('dm', u._id),
        })
      );
    }
  }

  function lastSeenText(date) {
    if (!date) return 'Offline';
    const mins = Math.round((Date.now() - new Date(date)) / 60000);
    if (mins < 1) return 'Last seen just now';
    if (mins < 60) return `Last seen ${mins} min ago`;
    if (mins < 1440) return `Last seen ${Math.round(mins / 60)} h ago`;
    return `Last seen ${new Date(date).toLocaleDateString()}`;
  }

  // ---------- header ----------
  function renderHeader() {
    if (!state.active) return;
    const { type, id } = state.active;
    if (type === 'room') {
      const room = state.rooms.find((r) => r._id === id);
      $('chatTitle').textContent = `# ${room?.name || 'Room'}`;
      $('chatSubtitle').textContent = room?.description || 'Group room';
    } else {
      const u = state.users.find((x) => x._id === id);
      $('chatTitle').textContent = u?.username || 'Direct message';
      $('chatSubtitle').textContent = state.online.has(id) ? 'Online' : lastSeenText(u?.lastSeen);
    }
  }

  // ---------- messages ----------
  const box = $('messages');
  let lastRender = { senderId: null, time: 0, day: null };

  function resetMessages() {
    box.innerHTML = '';
    lastRender = { senderId: null, time: 0, day: null };
  }

  function messageNode(msg, grouped) {
    const mine = msg.sender._id === me._id;
    const row = document.createElement('div');
    row.className = `enter flex gap-3 ${mine ? 'flex-row-reverse' : ''} ${grouped ? 'mt-1' : 'mt-5'}`;
    row.dataset.id = msg._id;

    if (!mine) {
      const av = grouped ? document.createElement('div') : avatar(msg.sender.username);
      if (grouped) av.className = 'w-8 shrink-0';
      row.append(av);
    }

    const col = document.createElement('div');
    col.className = `max-w-[75%] sm:max-w-[60%] flex flex-col ${mine ? 'items-end' : 'items-start'}`;

    if (!grouped) {
      const meta = document.createElement('div');
      meta.className = 'mb-1 flex items-baseline gap-2 px-1';
      if (!mine) {
        const who = document.createElement('span');
        who.className = 'text-[13px] font-medium text-ink/80';
        who.textContent = msg.sender.username;
        meta.append(who);
      }
      const time = document.createElement('span');
      time.className = 'font-mono text-[11px] tabular-nums text-ink/40';
      time.textContent = formatTime(msg.createdAt);
      meta.append(time);
      col.append(meta);
    }

    const bubble = document.createElement('div');
    bubble.className = `px-4 py-2.5 rounded-[18px] whitespace-pre-wrap break-words text-[15px] leading-relaxed ${
      mine ? 'bg-ink text-paper rounded-br-[6px]' : 'bg-white text-ink shadow-soft ring-1 ring-line/70 rounded-bl-[6px]'
    }`;
    bubble.textContent = msg.text; // textContent = safe from XSS
    bubble.title = new Date(msg.createdAt).toLocaleString();
    col.append(bubble);
    row.append(col);
    return row;
  }

  function daySeparator(date) {
    const sep = document.createElement('div');
    sep.className = 'flex items-center gap-4 my-8 font-mono text-[11px] text-ink/40';
    sep.innerHTML = '<span class="flex-1 h-px bg-line"></span><span></span><span class="flex-1 h-px bg-line"></span>';
    sep.children[1].textContent = formatDay(date);
    return sep;
  }

  function appendMessage(msg) {
    const t = new Date(msg.createdAt).getTime();
    const day = new Date(msg.createdAt).toDateString();
    if (day !== lastRender.day) {
      box.append(daySeparator(msg.createdAt));
      lastRender.senderId = null;
    }
    // Group consecutive messages from the same person within 5 minutes
    const grouped = lastRender.senderId === msg.sender._id && t - lastRender.time < 5 * 60000;
    box.append(messageNode(msg, grouped));
    lastRender = { senderId: msg.sender._id, time: t, day };
  }

  function renderHistory(messages) {
    resetMessages();

    if (messages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'h-full grid place-items-center text-center';
      empty.id = 'noMessages';
      empty.innerHTML = '<div class="max-w-xs"><p class="font-display text-4xl italic leading-tight text-ink/80">Quiet in here.</p><p class="mt-3 text-[15px] text-ink/50">Nobody has written yet. Send the first message.</p></div>';
      box.append(empty);
      return;
    }
    messages.forEach(appendMessage);
    box.scrollTop = box.scrollHeight;
  }

  // Store all loaded messages so prepending older history can re-render cleanly
  state._loadedMessages = [];

  async function openConversation(type, id) {
    state.active = { type, id };
    state.unread[keyOf(type, id)] = 0;
    state.noMoreHistory = false;
    toggleSidebar(false);
    renderRooms();
    renderUsers();
    renderHeader();
    renderTyping();

    $('msgInput').disabled = false;
    $('sendBtn').disabled = false;
    $('msgInput').placeholder = type === 'room' ? 'Message the room' : 'Write a private message';
    $('msgInput').focus();

    resetMessages();
    // Skeleton rows shaped like messages while history loads
    const loading = document.createElement('div');
    loading.setAttribute('aria-label', 'Loading messages');
    loading.className = 'space-y-6 pt-2';
    for (const [w, mine] of [['w-56', false], ['w-40', false], ['w-64', true], ['w-48', false]]) {
      const row = document.createElement('div');
      row.className = `flex items-end gap-3 ${mine ? 'flex-row-reverse' : ''}`;
      if (!mine) row.innerHTML = '<div class="skeleton h-8 w-8 rounded-[9px]"></div>';
      const bar = document.createElement('div');
      bar.className = `skeleton h-10 ${w} max-w-[60%] rounded-[18px]`;
      row.append(bar);
      loading.append(row);
    }
    box.append(loading);

    try {
      const path = type === 'room' ? `/messages/room/${id}` : `/messages/dm/${id}`;
      const msgs = await api(path);
      if (!isActive(type, id)) return; // user clicked elsewhere meanwhile
      state._loadedMessages = msgs;
      state.noMoreHistory = msgs.length < 50;
      renderHistory(msgs);
    } catch (err) {
      box.innerHTML = '';
      toast(`Couldn't load messages: ${err.message}`);
    }
  }

  // Load older messages when scrolled to the top
  box.addEventListener('scroll', async () => {
    if (box.scrollTop > 40 || !state.active || state.loadingOlder || state.noMoreHistory) return;
    const first = state._loadedMessages[0];
    if (!first) return;
    state.loadingOlder = true;
    const { type, id } = state.active;
    try {
      const path = type === 'room' ? `/messages/room/${id}` : `/messages/dm/${id}`;
      const older = await api(`${path}?before=${encodeURIComponent(first.createdAt)}`);
      if (!isActive(type, id)) return;
      if (older.length < 50) state.noMoreHistory = true;
      if (older.length) {
        state._loadedMessages = [...older, ...state._loadedMessages];
        const prevHeight = box.scrollHeight;
        resetMessages();
        state._loadedMessages.forEach(appendMessage);
        box.scrollTop = box.scrollHeight - prevHeight;
      }
    } catch (err) {
      toast(err.message);
    } finally {
      state.loadingOlder = false;
    }
  });

  function isActive(type, id) {
    return state.active && state.active.type === type && state.active.id === id;
  }

  function receive(type, convId, msg) {
    if (isActive(type, convId)) {
      $('noMessages')?.remove();
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
      state._loadedMessages.push(msg);
      appendMessage(msg);
      if (nearBottom || msg.sender._id === me._id) box.scrollTop = box.scrollHeight;
    } else if (msg.sender._id !== me._id) {
      const key = keyOf(type, convId);
      state.unread[key] = (state.unread[key] || 0) + 1;
      type === 'room' ? renderRooms() : renderUsers();
    }
  }

  // ---------- typing indicator ----------
  function renderTyping() {
    const el = $('typing');
    el.innerHTML = '';
    if (!state.active) return;
    const typers = state.typers[keyOf(state.active.type, state.active.id)];
    if (!typers || typers.size === 0) return;
    const names = [...typers.values()];
    const dots = document.createElement('span');
    dots.className = 'flex gap-0.5';
    dots.innerHTML = '<span class="typing-dot h-1.5 w-1.5 rounded-full bg-ink/50"></span>'.repeat(3);
    const text = document.createElement('span');
    text.textContent =
      names.length === 1 ? `${names[0]} is typing` : names.length === 2 ? `${names[0]} and ${names[1]} are typing` : 'Several people are typing';
    el.append(dots, text);
  }

  function setTyper(key, userId, username, isTyping) {
    if (!state.typers[key]) state.typers[key] = new Map();
    isTyping ? state.typers[key].set(userId, username) : state.typers[key].delete(userId);
    renderTyping();
  }

  // ---------- socket ----------
  const socket = io({ auth: { token } });

  socket.on('connect', async () => {
    $('connState').textContent = '';
    // (Re)join every room so we get unread counts for all of them
    for (const room of state.rooms) socket.emit('join_room', room._id);
  });
  socket.on('disconnect', () => ($('connState').textContent = 'Reconnecting…'));
  socket.on('connect_error', (err) => {
    if (/token|authenticated/i.test(err.message)) logout();
    else $('connState').textContent = 'Offline';
  });

  socket.on('online_users', (ids) => {
    state.online = new Set(ids);
    renderUsers();
    renderHeader();
  });
  socket.on('user_online', ({ userId, username }) => {
    state.online.add(userId);
    // A brand-new user registered -> add them to the list
    if (userId !== me._id && !state.users.some((u) => u._id === userId)) {
      state.users.push({ _id: userId, username });
    }
    renderUsers();
    renderHeader();
  });
  socket.on('user_offline', ({ userId, lastSeen }) => {
    state.online.delete(userId);
    const u = state.users.find((x) => x._id === userId);
    if (u) u.lastSeen = lastSeen;
    for (const key in state.typers) state.typers[key].delete(userId);
    renderUsers();
    renderHeader();
    renderTyping();
  });

  socket.on('room_created', (room) => {
    if (state.rooms.some((r) => r._id === room._id)) return;
    state.rooms.push(room);
    socket.emit('join_room', room._id);
    renderRooms();
  });

  socket.on('room_message', (msg) => {
    setTyper(keyOf('room', msg.room), msg.sender._id, null, false);
    receive('room', msg.room, msg);
  });

  socket.on('private_message', (msg) => {
    // The "other person" in this DM, from my point of view
    const other = msg.sender._id === me._id ? msg.recipient : msg.sender._id;
    setTyper(keyOf('dm', other), msg.sender._id, null, false);
    receive('dm', other, msg);
  });

  socket.on('typing', ({ roomId, from, userId, username }) => {
    if (roomId) setTyper(keyOf('room', roomId), userId, username, true);
    else if (from) setTyper(keyOf('dm', from), from, username, true);
  });
  socket.on('stop_typing', ({ roomId, from, userId }) => {
    if (roomId) setTyper(keyOf('room', roomId), userId, null, false);
    else if (from) setTyper(keyOf('dm', from), from, null, false);
  });

  // ---------- composer ----------
  const input = $('msgInput');
  let typingTimer = null;
  let isTyping = false;

  function target() {
    if (!state.active) return null;
    return state.active.type === 'room' ? { roomId: state.active.id } : { to: state.active.id };
  }

  function stopTyping() {
    if (isTyping && target()) socket.emit('stop_typing', target());
    isTyping = false;
    clearTimeout(typingTimer);
  }

  input.addEventListener('input', () => {
    if (!state.active) return;
    if (!isTyping) {
      isTyping = true;
      socket.emit('typing', target());
    }
    // Debounce: stop typing after 1.5s of no keystrokes
    clearTimeout(typingTimer);
    typingTimer = setTimeout(stopTyping, 1500);
  });

  $('composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !state.active) return;
    stopTyping();

    const event = state.active.type === 'room' ? 'room_message' : 'private_message';
    $('sendBtn').disabled = true;
    socket.timeout(5000).emit(event, { ...target(), text }, (err, res) => {
      $('sendBtn').disabled = false;
      if (err) return toast("Message didn't send. Check your connection and try again.");
      if (res?.error) return toast(res.error);
      input.value = '';
      input.focus();
    });
  });

  // ---------- new room dialog ----------
  const dialog = $('roomDialog');
  $('newRoomBtn').addEventListener('click', () => {
    $('roomForm').reset();
    $('roomError').classList.add('hidden');
    dialog.showModal();
  });
  $('cancelRoom').addEventListener('click', () => dialog.close());
  $('roomForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const room = await api('/rooms', {
        method: 'POST',
        body: JSON.stringify({ name: $('roomName').value, description: $('roomDesc').value }),
      });
      if (!state.rooms.some((r) => r._id === room._id)) {
        state.rooms.push(room);
        socket.emit('join_room', room._id);
      }
      dialog.close();
      openConversation('room', room._id);
    } catch (err) {
      $('roomError').textContent = err.message;
      $('roomError').classList.remove('hidden');
    }
  });

  // ---------- start ----------
  // Retried on every socket (re)connect until it succeeds, so a page opened
  // while the server was down recovers once the server is back.
  let loaded = false;
  let loading = false;
  async function loadInitialData() {
    if (loaded || loading) return;
    loading = true;
    try {
      const [rooms, users] = await Promise.all([api('/rooms'), api('/users')]);
      state.rooms = rooms;
      state.users = users;
      users.filter((u) => u.online).forEach((u) => state.online.add(u._id));
      renderRooms();
      renderUsers();
      if (socket.connected) rooms.forEach((r) => socket.emit('join_room', r._id));
      if (rooms[0] && !state.active) openConversation('room', rooms[0]._id);
      loaded = true;
    } catch (err) {
      toast(`Couldn't load your chats: ${err.message}. Retrying when the server is back…`);
    } finally {
      loading = false;
    }
  }
  socket.on('connect', loadInitialData);
  loadInitialData();
})();
