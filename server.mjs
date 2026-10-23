import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { Rooms, RoomError } from './app/rooms.mjs';
import { iceProvider } from './app/voice-config.mjs';

const files = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/content.js', ['public/content.js', 'text/javascript; charset=utf-8']],
  ['/voice.js', ['public/voice.js', 'text/javascript; charset=utf-8']],
  // Self-hosted OFL fonts; the content security policy allows no third-party font hosts.
  ['/fonts/atkinson-400.woff2', ['public/fonts/atkinson-400.woff2', 'font/woff2']],
  ['/fonts/atkinson-700.woff2', ['public/fonts/atkinson-700.woff2', 'font/woff2']],
  ['/fonts/newsreader.woff2', ['public/fonts/newsreader.woff2', 'font/woff2']]
]);
const headers = {
  'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()'
};
async function body(req, limit = 4096) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new RoomError(415, 'Send a JSON request.');
  const text = await new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) { tooLarge = true; reject(new RoomError(413, 'This request is too large.')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw new RoomError(400, 'The request could not be read. Refresh and try again.'); }
}
const json = (res, status, data) => {
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(data));
};
export function createApp({ rooms = new Rooms(), sweepMs = 1000, pingMs = 5000, disconnectGraceMs = 3000, allowedHosts = ['127.0.0.1', 'localhost'], creationSecret = null, previewOrigin = null, hosted = false, getIceConfig = iceProvider() } = {}) {
  const hosts = new Set(allowedHosts);
  const streams = new Set();
  const disconnects = new Map();
  const send = (stream, event, data) => {
    if (!stream.res.destroyed && !stream.res.writableEnded) stream.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const changed = room => {
    for (const stream of streams) if (stream.room === room) {
      try { send(stream, 'state', rooms.view(room, stream.token)); } catch { /* A removed member receives an exit event instead. */ }
    }
  };
  const closeRoom = room => {
    for (const [key, timer] of disconnects) if (key.startsWith(`${room.id}:`)) { clearTimeout(timer); disconnects.delete(key); }
    for (const stream of [...streams]) if (stream.room === room) { streams.delete(stream); stream.res.end(); }
  };
  const remove = (room, token, message) => {
    for (const stream of [...streams]) if (stream.room === room && stream.token === token) {
      send(stream, 'exit', { message }); streams.delete(stream); stream.res.end();
    }
  };
  const leaseExpired = (room, token) => {
    for (const stream of [...streams]) if (stream.room === room && stream.token === token) { streams.delete(stream); stream.res.end(); }
  };
  rooms.on('change', changed); rooms.on('closeRoom', closeRoom); rooms.on('remove', remove); rooms.on('leaseExpired', leaseExpired);
  const timer = setInterval(() => rooms.sweep(), sweepMs); timer.unref();
  const ping = setInterval(() => { for (const stream of streams) send(stream, 'ping', {}); }, pingMs); ping.unref();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const hostname = new URL(`http://${req.headers.host || 'invalid'}`).hostname;
      if (!hosts.has(hostname)) throw new RoomError(403, 'Open the preview using its printed address.');
      const origins = hosted ? [previewOrigin] : [`http://${req.headers.host}`, `https://${req.headers.host}`];
      if (req.headers.origin && !origins.includes(req.headers.origin)) throw new RoomError(403, 'Open this app directly to use the room.');
      if (req.method === 'GET' && url.pathname === '/healthz') { json(res, 200, { ok: true }); return; }
      if (req.method === 'GET' && files.has(url.pathname)) {
        const [path, type] = files.get(url.pathname);
        let data = await readFile(new URL(path, import.meta.url));
        if (path === 'public/index.html' && creationSecret) data = Buffer.from(data.toString().replace('</head>', `<meta name="preview-host-key-required" content="true"><meta name="preview-public-origin" content="${previewOrigin || ''}"></head>`));
        res.writeHead(200, { ...headers, 'Content-Type': type }); res.end(data); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/rooms') {
        if (creationSecret) {
          const supplied = Buffer.from(req.headers['x-preview-key'] || '');
          const expected = Buffer.from(creationSecret);
          if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new RoomError(403, 'The host key was not accepted. Enter the private host key to create a room. Participant invitations still work.');
        }
        const data = await body(req); json(res, 201, rooms.create(data.scenarioId)); return;
      }
      const match = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9_-]{32})\/(join|state|events|action|heartbeat|audio|audio-signal|audio-config)$/);
      if (!match) throw new RoomError(404, 'Page not found. Open the app home page or your room invitation.');
      const room = rooms.get(match[1]); const endpoint = match[2];
      if (req.method === 'POST' && endpoint === 'join') {
        const data = await body(req); json(res, 201, rooms.join(room, data.invite, data.alias)); return;
      }
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      rooms.actor(room, token);
      if (req.method === 'GET' && endpoint === 'audio-config') {
        const actor = rooms.audioActor(room, token);
        if (!actor.iceConfig) {
          actor.iceConfig = getIceConfig();
          actor.iceConfig.catch(() => { setTimeout(() => { actor.iceConfig = null; }, 5000).unref(); });
        }
        try { json(res, 200, await actor.iceConfig); }
        catch { throw new RoomError(503, 'Audio relay setup is unavailable. You can keep using rehearsal controls and try audio again shortly.'); }
        return;
      }
      if (req.method === 'POST' && endpoint === 'audio') {
        json(res, 200, rooms.audioCommand(room, token, await body(req))); return;
      }
      if (req.method === 'POST' && endpoint === 'audio-signal') {
        const { targetToken, signal } = rooms.audioSignal(room, token, await body(req, 20000));
        for (const stream of streams) if (stream.room === room && stream.token === targetToken) send(stream, 'audio-signal', signal);
        json(res, 200, { ok: true }); return;
      }
      if (req.method === 'GET' && endpoint === 'state') { json(res, 200, rooms.view(room, token)); return; }
      if (req.method === 'POST' && endpoint === 'heartbeat') {
        rooms.heartbeat(room, token); json(res, 200, { ok: true }); return;
      }
      if (req.method === 'POST' && endpoint === 'action') {
        const result = rooms.command(room, token, await body(req)); json(res, 200, result); return;
      }
      if (req.method === 'GET' && endpoint === 'events') {
        // Multiple tabs can share a role, but unlimited streams cannot exhaust this local server.
        const count = [...streams].filter(s => s.room === room && s.token === token).length;
        if (count >= 3) throw new RoomError(409, 'This role is open in too many tabs. Close another room tab and reconnect.');
        res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
        const stream = { room, token, res }; streams.add(stream);
        const key = `${room.id}:${token}`;
        clearTimeout(disconnects.get(key)); disconnects.delete(key);
        rooms.connect(room, token, true); send(stream, 'state', rooms.view(room, token));
        res.on('close', () => {
          streams.delete(stream);
          if (!rooms.rooms.has(room.id) || [...streams].some(s => s.room === room && s.token === token)) return;
          // A brief refresh should not drop a person's request for time. A real loss
          // still pauses after this short grace, or when the heartbeat lease expires.
          if (!disconnects.has(key)) {
            const timeout = setTimeout(() => {
              disconnects.delete(key);
              if (!rooms.rooms.has(room.id) || [...streams].some(s => s.room === room && s.token === token)) return;
              try { rooms.connect(room, token, false); } catch { /* The member may have left. */ }
            }, disconnectGraceMs);
            timeout.unref(); disconnects.set(key, timeout);
          }
        });
        return;
      }
      throw new RoomError(405, 'This request method is not supported.');
    } catch (error) {
      if (!res.headersSent) {
        if (error.status === 413) res.once('finish', () => req.destroy());
        json(res, error instanceof RoomError ? error.status : 500, { error: error instanceof RoomError ? error.message : 'The server could not complete this request. Try again.' });
      }
      else res.end();
    }
  });
  server.on('close', () => {
    clearInterval(timer); clearInterval(ping);
    for (const timeout of disconnects.values()) clearTimeout(timeout);
    disconnects.clear();
    rooms.off('change', changed); rooms.off('closeRoom', closeRoom); rooms.off('remove', remove); rooms.off('leaseExpired', leaseExpired);
  });
  server.shutdown = () => { for (const stream of streams) stream.res.end(); streams.clear(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); };
  return { server, rooms };
}

// Only this explicit mode listens on all interfaces, behind Render's HTTPS edge.
// Never infer authority from caller-controlled forwarded headers.
export function hostedSettings(env = process.env) {
  const originError = 'Hosted mode needs Render and its exact HTTPS RENDER_EXTERNAL_URL.';
  let url;
  try { url = new URL(env.RENDER_EXTERNAL_URL); }
  catch { throw new Error(originError); }
  if (env.RENDER !== 'true' || url.protocol !== 'https:' || !/^[a-z0-9-]+\.onrender\.com$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error(originError);
  if (!/^[A-Za-z0-9_+/=-]{32,128}$/.test(env.HOST_SETUP_KEY || '')) throw new Error('Set HOST_SETUP_KEY to a random secret of 32–128 base64 characters in Render Environment.');
  const port = Number(env.PORT || 10000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  return { address: '0.0.0.0', port, allowedHosts: [url.hostname], origin: url.origin, creationSecret: env.HOST_SETUP_KEY, hosted: true };
}

// LAN mode is explicit and binds one owned private address, never every interface.
export function previewSettings(args = [], interfaces = networkInterfaces()) {
  if (!args.length) return { address: '127.0.0.1', port: 8787, allowedHosts: ['127.0.0.1', 'localhost'] };
  if (args[0] === '--https-preview' && args.length === 2) {
    const url = new URL(args[1]);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.(lhr\.life|run\.pinggy-free\.link|free\.pinggy\.net)$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the exact HTTPS tunnel preview origin.');
    return { address: '127.0.0.1', port: 8789, allowedHosts: [url.hostname, '127.0.0.1', 'localhost'], origin: url.origin };
  }
  if (args[0] !== '--lan' || args.length > 2) throw new Error('Use ./dev or ./dev --lan [private IPv4 address].');
  const privateIPv4 = value => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
  const candidates = [...new Set(Object.entries(interfaces)
    .filter(([name]) => !/^(utun|tun|tap|lo)/.test(name))
    .flatMap(([, entries]) => entries || [])
    .filter(item => !item.internal && item.family === 'IPv4' && privateIPv4(item.address))
    .map(item => item.address))];
  const address = args[1] || (candidates.length === 1 ? candidates[0] : null);
  if (!address || !candidates.includes(address)) throw new Error(`Choose one private address on this Mac: ${candidates.join(', ') || 'none found; connect to Wi-Fi first'}. Run ./dev --lan ADDRESS.`);
  return { address, port: 8788, allowedHosts: [address] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let settings;
  const args = process.argv.slice(2);
  try { settings = args.length === 1 && args[0] === '--hosted' ? hostedSettings() : previewSettings(args); }
  catch (error) { console.error(error.message); process.exit(1); }
  const port = Number(process.env.PORT || settings.port);
  const creationSecret = settings.creationSecret || (settings.origin ? randomBytes(24).toString('base64url') : null);
  const { server } = createApp({ allowedHosts: settings.allowedHosts, creationSecret, previewOrigin: settings.origin, hosted: settings.hosted });
  server.listen(port, settings.address, () => console.log(`Rehearsal preview: ${settings.origin || `http://${settings.address}:${port}`}\n${settings.hosted ? 'Hosted demo. Enter the private host key on the home page; share only participant invitations.' : settings.origin ? 'Temporary public HTTPS tunnel. Test aliases only; keep Mac awake.' : settings.address === '127.0.0.1' ? 'This computer only.' : 'Same Wi-Fi preview; HTTP, no internet tunnel. Use test aliases only.'}\nRooms live in memory for at most one hour and disappear on restart. Stop with Ctrl+C.`));
  if (creationSecret && !settings.hosted) console.log(`Private host setup (keep to yourself): ${settings.origin}/#setup=${creationSecret}`);
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.shutdown().then(() => process.exit(0)));
  server.on('error', error => { console.error(`Could not start the local server: ${error.code || error.message}`); process.exitCode = 1; });
}
