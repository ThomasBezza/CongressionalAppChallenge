import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// Synthetic clients, not a human rehearsal. Never print room credentials or keys.
export async function checkHosted(origin, key, report = () => {}) {
  const url = new URL(origin);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use only the HTTPS service origin (or loopback for local verification).');
  const base = url.origin;
  const clients = [];
  let room;
  async function request(path, token, data, hostKey) {
    const response = await fetch(base + path, {
      method: data === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(hostKey ? { 'X-Preview-Key': hostKey } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(10_000)
    });
    return { status: response.status, data: await response.json() };
  }
  const path = endpoint => `/api/rooms/${room.roomId}/${endpoint}`;
  async function client(token) {
    const controller = new AbortController();
    const c = { token, state: null, controller, failure: null };
    clients.push(c);
    c.timeout = setTimeout(() => controller.abort(), 30_000);
    const response = await fetch(base + path('events'), { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, redirect: 'error' });
    assert.equal(response.status, 200, 'event stream must open');
    c.reader = (async () => {
      const decoder = new TextDecoder(); let buffer = '';
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true }); let index;
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
          if (frame.startsWith('event: state\n')) c.state = JSON.parse(frame.split('\ndata: ')[1]);
        }
      }
    })().catch(error => { if (!controller.signal.aborted) c.failure = error; });
    c.heartbeat = setInterval(() => request(path('heartbeat'), token, {}).catch(() => {}), 4000);
    c.action = data => request(path('action'), token, data);
    c.wait = async predicate => {
      const deadline = Date.now() + 8000;
      while (!predicate(c.state)) {
        if (c.failure || controller.signal.aborted || Date.now() > deadline) throw new Error('Confirmed state did not arrive on the event stream within 8 seconds.');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return c.state;
    };
    await c.wait(state => Boolean(state));
    return c;
  }
  try {
    assert.equal((await request('/healthz')).status, 200, 'health check');
    const html = await fetch(base, { redirect: 'error', signal: AbortSignal.timeout(10_000) }).then(r => r.text());
    assert.ok(!html.includes(key), 'host key must not appear in public HTML');
    assert.equal((await request('/api/rooms', null, {})).status, 403, 'public room creation must be blocked');
    const created = await request('/api/rooms', null, {}, key);
    assert.equal(created.status, 201, 'host key must allow creation'); room = created.data;
    report('Health and protected room creation passed.');
    const host = await client(room.token);
    const pair = [];
    for (const [alias, role] of [['Demo Customer', 'customer'], ['Demo Cashier', 'cashier']]) {
      const joined = await request(path('join'), null, { invite: room.invite, alias });
      assert.equal(joined.status, 201);
      const participant = await client(joined.data.token); pair.push(participant);
      await host.wait(state => state?.waiting.some(p => p.alias === alias && p.connected));
      const member = host.state.waiting.find(p => p.alias === alias);
      assert.equal((await host.action({ action: 'admit', memberId: member.id, role })).status, 200);
      await participant.wait(state => state?.self.role === role);
    }
    for (const participant of pair) assert.equal((await participant.action({ action: 'ready', value: true })).status, 200);
    assert.equal((await host.action({ action: 'start' })).status, 200);
    await Promise.all([host, ...pair].map(c => c.wait(state => state?.phase === 'active')));
    assert.equal((await pair[0].action({ action: 'moment', value: true })).status, 200);
    await Promise.all([host, pair[1]].map(c => c.wait(state => state?.members.some(p => p.role === 'customer' && p.moment))));
    report('Two synthetic participants joined, were admitted and readied; their time request reached the other streams.');
    assert.equal((await host.action({ action: 'end' })).status, 200);
    await Promise.all(pair.map(c => c.wait(state => state?.phase === 'ended')));
    assert.equal((await request(path('state'), room.token)).status, 404);
    report('Room ending reached participants and removed the room.');
  } finally {
    if (room) await request(path('action'), room.token, { action: 'end' }).catch(() => {});
    for (const c of clients) { clearTimeout(c.timeout); clearInterval(c.heartbeat); c.controller.abort(); }
    await Promise.all(clients.map(c => c.reader));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.env.HOST_SETUP_KEY) { console.error('Set HOST_SETUP_KEY privately in your shell first. Never pass the key as a command argument.'); process.exitCode = 1; }
  else {
    try { await checkHosted(process.argv[2], process.env.HOST_SETUP_KEY, console.log); console.log('PASS: synthetic hosted check. This does not test a phone, audio call, or user value.'); }
    catch { console.error('FAIL: hosted check did not complete. Confirm the service is awake, its URL and host key are correct, and event streams are reaching it.'); process.exitCode = 1; }
  }
}
