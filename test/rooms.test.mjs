import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, previewSettings, hostedSettings } from '../server.mjs';
import { checkHosted } from '../scripts/check-hosted.mjs';
import { Rooms } from '../app/rooms.mjs';
import { request as rawRequest } from 'node:http';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// These tests use real HTTP connections and receive state on separate SSE streams.
async function fixture(t, options = {}) {
  const app = createApp(options); const clients = [];
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { clients.forEach(c => c.close()); await app.server.shutdown(); });
  async function request(path, token, data, method = data === undefined ? 'GET' : 'POST', extra = {}) {
    const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: res.status, data: await res.json() };
  }
  const created = await request('/api/rooms', null, {}); assert.equal(created.status, 201);
  const room = created.data;
  const path = endpoint => `/api/rooms/${room.roomId}/${endpoint}`;
  function client(token) {
    const c = {
      token, state: null, states: [], controller: null, listeners: new Set(),
      action: data => request(path('action'), token, data),
      snapshot: () => request(path('state'), token),
      async connect() {
        this.controller = new AbortController();
        const res = await fetch(base + path('events'), { headers: { Authorization: `Bearer ${token}` }, signal: this.controller.signal });
        assert.equal(res.status, 200);
        this.readerTask = (async () => {
          const decoder = new TextDecoder(); let buffer = '';
          for await (const chunk of res.body) {
            buffer += decoder.decode(chunk, { stream: true }); let index;
            while ((index = buffer.indexOf('\n\n')) !== -1) {
              const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
              if (!frame.startsWith('event: state\n')) continue;
              this.state = JSON.parse(frame.split('\ndata: ')[1]); this.states.push(this.state);
              for (const listener of this.listeners) listener();
            }
          }
        })().catch(error => { if (!this.controller.signal.aborted) this.streamError = error; });
        await this.wait(s => Boolean(s)); return this;
      },
      wait(predicate) {
        if (predicate(this.state)) return Promise.resolve(this.state);
        return new Promise((resolve, reject) => {
          const done = () => {
            if (predicate(this.state)) { clearTimeout(timer); this.listeners.delete(done); resolve(this.state); }
          };
          const timer = setTimeout(() => { this.listeners.delete(done); reject(new Error(`State not received: ${JSON.stringify(this.state)}`)); }, 5000);
          this.listeners.add(done);
        });
      },
      close() { this.controller?.abort(); }
    };
    clients.push(c); return c;
  }
  async function join(alias) {
    const res = await request(path('join'), null, { invite: room.invite, alias });
    assert.equal(res.status, 201); return client(res.data.token);
  }
  const host = client(room.token); await host.connect();
  return { ...app, base, room, path, request, host, join, client };
}
async function pair(t, options) {
  const f = await fixture(t, options);
  const customer = await f.join('Test Customer'); await customer.connect();
  const cashier = await f.join('Test Cashier'); await cashier.connect();
  await f.host.wait(s => s.waiting?.length === 2 && s.waiting.every(p => p.connected));
  for (const [c, role] of [[customer, 'customer'], [cashier, 'cashier']]) {
    const pending = f.host.state.waiting.find(p => p.alias === (role === 'customer' ? 'Test Customer' : 'Test Cashier'));
    assert.equal((await f.host.action({ action: 'admit', memberId: pending.id, role })).status, 200);
    await c.wait(s => s.self.role === role);
  }
  return { ...f, customer, cashier };
}
async function start(f) {
  for (const c of [f.customer, f.cashier]) assert.equal((await c.action({ action: 'ready', value: true })).status, 200);
  assert.equal((await f.host.action({ action: 'start' })).status, 200);
  await Promise.all([f.host, f.customer, f.cashier].map(c => c.wait(s => s.phase === 'active')));
}

test('real clients receive independent time requests; no actor can clear another person’s request', async t => {
  const f = await pair(t); await start(f);
  assert.equal((await f.customer.action({ action: 'moment', value: true })).status, 200);
  await Promise.all([f.host, f.cashier].map(c => c.wait(s => s.members.some(p => p.role === 'customer' && p.moment))));
  await f.cashier.action({ action: 'moment', value: true });
  await f.customer.wait(s => s.members.every(p => p.moment));
  await f.customer.action({ action: 'moment', value: false, memberId: f.cashier.state.self.id });
  await f.host.wait(s => !s.members.find(p => p.role === 'customer').moment && s.members.find(p => p.role === 'cashier').moment);
  assert.equal((await f.host.action({ action: 'moment', value: false })).status, 400);
  assert.equal((await f.cashier.snapshot()).data.self.moment, true);
});

test('admission, role assignment, start, and ending require host authority', async t => {
  const f = await fixture(t); const guest = await f.join('Waiting'); await guest.connect();
  assert.equal((await guest.action({ action: 'ready', value: true })).status, 403);
  assert.equal((await guest.action({ action: 'admit', memberId: guest.state.self.id, role: 'host' })).status, 403);
  assert.equal((await guest.action({ action: 'start' })).status, 403);
  assert.equal((await guest.action({ action: 'end' })).status, 403);
  assert.equal((await f.host.action({ action: 'start' })).status, 409);
  const waiting = (await guest.snapshot()).data;
  assert.deepEqual(waiting.members, []); assert.equal(waiting.invite, undefined); assert.equal(waiting.waiting, undefined);
  assert.equal(JSON.stringify(waiting).includes(f.room.token), false);
  assert.equal((await f.request(f.path('state'), 'not-the-secret')).status, 403);
});

test('occupied roles cannot be overwritten and pending requests can be declined', async t => {
  const f = await pair(t); const third = await f.join('Third'); await third.connect();
  assert.equal((await f.host.action({ action: 'admit', memberId: third.state.self.id, role: 'customer' })).status, 409);
  assert.equal((await f.host.action({ action: 'admit', memberId: third.state.self.id, role: 'host' })).status, 400);
  assert.equal((await f.host.action({ action: 'decline', memberId: third.state.self.id })).status, 200);
  assert.equal((await third.snapshot()).status, 403);
});

test('pause and retry require fresh readiness and preserve participant-owned requests', async t => {
  const f = await pair(t); await start(f);
  await f.customer.action({ action: 'moment', value: true });
  await f.cashier.action({ action: 'pause' });
  await f.host.wait(s => s.phase === 'paused' && s.members.every(p => !p.ready));
  assert.equal((await f.host.action({ action: 'start' })).status, 409);
  assert.equal((await f.customer.action({ action: 'ready', value: true })).status, 409);
  await f.cashier.action({ action: 'retry' });
  await f.customer.wait(s => s.phase === 'prepare' && s.attempt === 2 && s.self.moment);
  await f.customer.action({ action: 'moment', value: false }); await start(f);
  assert.equal(f.host.state.attempt, 2);
});

test('stream loss pauses the attempt; rejoin does not silently restart it', async t => {
  const f = await pair(t); await start(f);
  await f.customer.action({ action: 'moment', value: true }); f.customer.close();
  await f.host.wait(s => s.phase === 'paused' && s.members.some(p => p.role === 'customer' && !p.connected && !p.moment));
  const rejoined = f.client(f.customer.token); await rejoined.connect();
  await rejoined.wait(s => s.self.role === 'customer' && !s.self.ready);
  assert.equal((await f.host.action({ action: 'start' })).status, 409);
  await rejoined.action({ action: 'ready', value: true }); await f.cashier.action({ action: 'ready', value: true });
  await f.host.action({ action: 'start' }); await rejoined.wait(s => s.phase === 'active');
  f.host.close(); await rejoined.wait(s => s.phase === 'paused' && !s.hostConnected);
});

test('unresponsive clients expire their presence lease even if a socket stays open', async t => {
  let now = 1000;
  const rooms = new Rooms({ now: () => now, leaseMs: 1000 });
  const f = await pair(t, { rooms }); await start(f);
  await f.customer.action({ action: 'moment', value: true }); now += 1001;
  await f.request(f.path('heartbeat'), f.host.token, {}, 'POST');
  await f.request(f.path('heartbeat'), f.cashier.token, {}, 'POST');
  rooms.sweep();
  await f.host.wait(s => s.phase === 'paused' && s.members.some(p => p.role === 'customer' && !p.connected && !p.moment));
});

test('leave frees the seat; end removes the room and rejects stale clients', async t => {
  const f = await pair(t); await start(f);
  assert.equal((await f.customer.action({ action: 'leave' })).status, 200);
  await f.host.wait(s => s.phase === 'paused' && s.members.length === 1);
  assert.equal((await f.customer.action({ action: 'moment', value: true })).status, 403);
  const replacement = await f.join('Replacement'); await replacement.connect();
  assert.equal((await f.host.action({ action: 'admit', memberId: replacement.state.self.id, role: 'customer' })).status, 200);
  await replacement.wait(s => s.self.role === 'customer');
  assert.equal((await f.host.action({ action: 'end' })).status, 200);
  await f.cashier.wait(s => s.phase === 'ended');
  assert.equal(f.rooms.rooms.size, 0);
  assert.equal((await f.cashier.action({ action: 'ready', value: true })).status, 404);
  assert.equal((await f.request(f.path('join'), null, { alias: 'Late', invite: f.room.invite })).status, 404);
});

test('one-hour expiry removes temporary room data', async t => {
  let now = 0;
  const rooms = new Rooms({ now: () => now, lifetimeMs: 1000 });
  const f = await fixture(t, { rooms }); now = 1001; rooms.sweep();
  await f.host.wait(s => s.phase === 'ended'); assert.equal(rooms.rooms.size, 0);
  assert.equal((await f.host.snapshot()).status, 404);
});

test('invalid aliases/invites/origins and project-file requests are rejected', async t => {
  const f = await fixture(t);
  assert.equal((await f.request(f.path('join'), null, { alias: '', invite: f.room.invite })).status, 400);
  assert.equal((await f.request(f.path('join'), null, { alias: 'x'.repeat(25), invite: f.room.invite })).status, 400);
  assert.equal((await f.request(f.path('join'), null, { alias: 'Test', invite: 'wrong' })).status, 403);
  assert.equal((await f.request('/api/rooms', null, {}, 'POST', { Origin: 'https://elsewhere.example' })).status, 403);
  assert.equal((await f.request('/PROJECT.md')).status, 404);
  assert.equal((await f.request('/app/rooms.mjs')).status, 404);
});

test('a brief stream replacement preserves the active hold instead of creating a disconnect', async t => {
  const f = await pair(t, { disconnectGraceMs: 200 }); await start(f);
  await f.customer.action({ action: 'moment', value: true });
  f.customer.close();
  const rejoined = f.client(f.customer.token); await rejoined.connect();
  await new Promise(resolve => setTimeout(resolve, 300));
  const snapshot = (await rejoined.snapshot()).data;
  assert.equal(snapshot.phase, 'active'); assert.equal(snapshot.self.moment, true);
  assert.equal(snapshot.self.ready, true);
});

test('closing one of multiple role streams does not disconnect the role; stream limit is enforced', async t => {
  const f = await pair(t); await start(f);
  const extra = f.client(f.customer.token); await extra.connect();
  const third = f.client(f.customer.token); await third.connect();
  assert.equal((await f.request(f.path('events'), f.customer.token)).status, 409);
  f.customer.close();
  await extra.action({ action: 'moment', value: true });
  await f.host.wait(s => s.phase === 'active' && s.members.some(p => p.role === 'customer' && p.connected && p.moment));
});

test('bounded waiting requests, oversized bodies and nonlocal Host headers are rejected', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 6; i++) await f.join(`Pending ${i}`);
  assert.equal((await f.request(f.path('join'), null, { alias:'Extra', invite:f.room.invite })).status, 409);
  assert.equal((await f.request('/api/rooms', null, { excess: 'x'.repeat(5000) })).status, 413);
  const status = await new Promise((resolve, reject) => {
    const req = rawRequest(f.base, { headers: { Host:'elsewhere.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(status, 403);
});

test('expiry during an active attempt closes streams and rejects retry from stale clients', async t => {
  let now = 0;
  const rooms = new Rooms({ now: () => now, lifetimeMs: 1000 });
  const f = await pair(t, { rooms }); await start(f); now = 1001; rooms.sweep();
  await f.customer.wait(s => s.phase === 'ended');
  assert.equal(rooms.rooms.size, 0);
  assert.equal((await f.cashier.action({ action:'retry' })).status, 404);
});

test('a reconnect after the normal retry delay still fits inside the grace period', async t => {
  const f = await pair(t); await start(f);
  await f.customer.action({ action:'moment', value:true }); f.customer.close();
  await new Promise(resolve => setTimeout(resolve, 1250));
  const recovered = f.client(f.customer.token); await recovered.connect();
  assert.equal(recovered.state.phase, 'active'); assert.equal(recovered.state.self.moment, true);
});

test('host can free a disconnected seat, but cannot remove a connected participant or dismiss an active hold', async t => {
  const f = await pair(t, { disconnectGraceMs: 20 }); await start(f);
  const id = f.customer.state.self.id;
  await f.customer.action({ action:'moment', value:true });
  assert.equal((await f.host.action({ action:'remove', memberId:id })).status, 409);
  assert.equal((await f.cashier.action({ action:'remove', memberId:id })).status, 403);
  f.customer.close(); await f.host.wait(s => s.phase==='paused' && s.members.some(p=>p.id===id && !p.connected));
  assert.equal((await f.host.action({ action:'remove', memberId:id })).status, 200);
  assert.equal((await f.customer.snapshot()).status, 403);
  const replacement = await f.join('New Customer'); await replacement.connect();
  assert.equal((await f.host.action({ action:'admit', memberId:replacement.state.self.id, role:'customer' })).status, 200);
});

test('LAN preview is opt-in, selects only an owned private interface, and refuses ambiguous addresses', () => {
  const interfaces = { en0: [{ address:'192.168.1.20', family:'IPv4', internal:false }] };
  assert.equal(previewSettings([], interfaces).address, '127.0.0.1');
  assert.deepEqual(previewSettings(['--lan'], interfaces), {address:'192.168.1.20', port:8788, allowedHosts:['192.168.1.20']});
  for (const address of ['0.0.0.0','8.8.8.8','192.168.1.99']) assert.throws(() => previewSettings(['--lan',address], interfaces));
  const multiple = {...interfaces, en1:[{address:'10.1.1.2',family:'IPv4',internal:false}]};
  assert.throws(() => previewSettings(['--lan'],multiple));
  assert.equal(previewSettings(['--lan','10.1.1.2'],multiple).address,'10.1.1.2');
});

test('LAN Host allowlist remains explicit and rejects foreign origins', async t => {
  const {server} = createApp({allowedHosts:['192.168.1.20']});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => server.shutdown());
  const base = `http://127.0.0.1:${server.address().port}`;
  async function send(headers) {
    return new Promise((resolve,reject) => {
      const req = rawRequest(base,{headers},res => {res.resume();resolve(res.statusCode);});
      req.on('error',reject); req.end();
    });
  }
  assert.equal(await send({Host:'192.168.1.20:8788'}),200);
  assert.equal(await send({Host:'localhost:8788'}),403);
  assert.equal(await send({Host:'elsewhere.example'}),403);
  assert.equal(await send({Host:'192.168.1.20:8788',Origin:'https://elsewhere.example'}),403);
  assert.equal(await send({Host:'192.168.1.20:8788',Origin:'http://192.168.1.20:8788'}),200);
});

test('HTTPS preview restricts the temporary public hostname and remains loopback bound', () => {
  const config=previewSettings(['--https-preview','https://example.lhr.life']);
  assert.equal(config.address,'127.0.0.1');
  assert.deepEqual(config.allowedHosts,['example.lhr.life','127.0.0.1','localhost']);
  assert.equal(config.port,8789);
  for (const url of ['http://example.lhr.life','https://example.com','https://example.lhr.life/path','https://user@example.lhr.life','https://example.lhr.life?x=y']) {
    assert.throws(() => previewSettings(['--https-preview',url]));
  }
});

test('public preview requires a host setup key for creation, while participant invitations remain independent', async t => {
  const creationSecret='synthetic-preview-key';
  const app=createApp({creationSecret,previewOrigin:'https://example.run.pinggy-free.link'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.server.shutdown());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const html=await (await fetch(base)).text();
  assert.match(html,/preview-host-key-required/);
  assert.match(html,/preview-public-origin/);
  assert.ok(!html.includes(creationSecret));
  async function post(path,data,key) {
    return fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(key?{'X-Preview-Key':key}:{})},body:JSON.stringify(data)});
  }
  assert.equal((await post('/api/rooms',{})).status,403);
  assert.equal((await post('/api/rooms',{},'wrong')).status,403);
  const created=await post('/api/rooms',{},creationSecret);assert.equal(created.status,201);
  const room=await created.json();
  assert.equal((await post(`/api/rooms/${room.roomId}/join`,{alias:'Test Phone',invite:room.invite})).status,201);
});

test('hosted mode validates Render origin, port and persistent host secret before listening', () => {
  const env = { RENDER: 'true', RENDER_EXTERNAL_URL: 'https://demo-rehearsal.onrender.com', PORT: '10000', HOST_SETUP_KEY: 'A'.repeat(43) + '=' };
  const config = hostedSettings(env);
  assert.equal(config.address, '0.0.0.0');
  assert.deepEqual(config.allowedHosts, ['demo-rehearsal.onrender.com']);
  assert.equal(config.creationSecret, env.HOST_SETUP_KEY);
  assert.equal(config.port, 10000);
  for (const value of [undefined, '', 'not a URL']) assert.throws(() => hostedSettings({ ...env, RENDER_EXTERNAL_URL: value }), /Hosted mode needs Render and its exact HTTPS RENDER_EXTERNAL_URL/);
  for (const change of [{ RENDER: 'false' }, { RENDER_EXTERNAL_URL: 'http://demo-rehearsal.onrender.com' }, { RENDER_EXTERNAL_URL: 'https://demo-rehearsal.onrender.com.evil.test' }, { RENDER_EXTERNAL_URL: 'https://demo-rehearsal.onrender.com/path' }, { HOST_SETUP_KEY: '' }, { HOST_SETUP_KEY: 'a-short-password' }, { PORT: 'NaN' }, { PORT: '65536' }]) assert.throws(() => hostedSettings({ ...env, ...change }));
  assert.equal(previewSettings([]).address, '127.0.0.1', 'default still binds only loopback');
});

test('hosted Host and Origin checks ignore forwarded headers; health reveals no room data', async t => {
  const origin = 'https://demo-rehearsal.onrender.com';
  const { server } = createApp({ hosted: true, previewOrigin: origin, creationSecret: 'A'.repeat(43) + '=', allowedHosts: ['demo-rehearsal.onrender.com'] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.shutdown());
  async function get(headers, path = '/healthz') {
    return new Promise((resolve, reject) => {
      const req = rawRequest(`http://127.0.0.1:${server.address().port}${path}`, { headers }, res => {
        let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, text }));
      });
      req.on('error', reject); req.end();
    });
  }
  const health = await get({ Host: 'demo-rehearsal.onrender.com' });
  assert.equal(health.status, 200); assert.deepEqual(JSON.parse(health.text), { ok: true });
  assert.equal((await get({ Host: 'demo-rehearsal.onrender.com', Origin: origin })).status, 200);
  assert.equal((await get({ Host: 'demo-rehearsal.onrender.com', Origin: 'http://demo-rehearsal.onrender.com' })).status, 403);
  assert.equal((await get({ Host: 'evil.test', 'X-Forwarded-Host': 'demo-rehearsal.onrender.com', 'X-Forwarded-Proto': 'https' })).status, 403);
  assert.equal((await get({ Host: 'demo-rehearsal.onrender.com' }, '/PROJECT.md')).status, 404);
});

test('repeatable deployment check exercises protected creation, live synchronization and cleanup', async t => {
  const key = 'A'.repeat(43) + '=';
  const app = createApp({ creationSecret: key, previewOrigin: 'https://demo-rehearsal.onrender.com', hosted: true });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.server.shutdown());
  const reports = [];
  await checkHosted(`http://127.0.0.1:${app.server.address().port}`, key, message => reports.push(message));
  assert.equal(reports.length, 3);
  assert.equal(app.rooms.rooms.size, 0, 'synthetic rooms are removed');
});

test('deployment check CLI identifies wrong keys and malformed responses without printing secrets', async t => {
  const suppliedKey = 'B'.repeat(43) + '='; // Synthetic; never a deployed key.
  const app = createApp({ creationSecret: 'A'.repeat(43) + '=' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const malformed = createServer((req, res) => { res.end(`not JSON: ${suppliedKey}`); });
  await new Promise(resolve => malformed.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.server.shutdown(); await new Promise(resolve => malformed.close(resolve)); });
  for (const [server, expected] of [[app.server, /Failed while creating a room with the host key\. Received HTTP 403; expected 201/], [malformed, /Failed while checking health\. The server did not return valid JSON/]]) {
    let failure;
    try {
      await promisify(execFile)(process.execPath, ['scripts/check-hosted.mjs', `http://127.0.0.1:${server.address().port}`], { env: { ...process.env, HOST_SETUP_KEY: suppliedKey }, timeout: 15_000 });
    } catch (error) { failure = error; }
    assert.equal(failure?.code, 1);
    assert.match(failure.stderr, expected);
    assert.ok(!failure.stderr.includes(suppliedKey));
    assert.ok(!failure.stdout.includes(suppliedKey));
  }
  assert.equal(app.rooms.rooms.size, 0);
});
