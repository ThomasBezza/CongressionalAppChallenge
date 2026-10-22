import { norms, briefs } from './content.js';

const app = document.getElementById('app');
const errorBox = document.getElementById('error');
const connection = document.getElementById('connection');
const announcement = document.getElementById('announcement');
const publicPreviewOrigin = document.querySelector('meta[name="preview-public-origin"]')?.content;
const requiresHostKey = Boolean(document.querySelector('meta[name="preview-host-key-required"]'));
const safeTransport = location.protocol === 'https:' || /^(localhost|127\.0\.0\.1|10\.(\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(location.hostname);
let previewHostKey = null;
try { previewHostKey = sessionStorage.getItem('rehearsal-preview-host'); } catch { /* Setup link can still be used in this tab. */ }
let credentials = null, invitation = null, state = null, online = false, busy = false, stopped = false;
let controller = null, heartbeat = null, generation = 0, lastFrame = 0, ending = false;
let joinAlias = '';
let pendingLabel = '';
const dockObserver = new ResizeObserver(entries => {
  const dock = entries[0]?.target;
  if (dock) document.documentElement.style.setProperty('--dock-height', `${dock.getBoundingClientRect().height}px`);
});
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const roleName = role => ({ customer: 'Customer', cashier: 'Cashier', host: 'Host' }[role] || 'Waiting for admission');
function error(message = '') { errorBox.textContent = message; errorBox.hidden = !message; }
function button(id, text, action, { disabled = false, cls = '', pressed, ...data } = {}) {
  return `<button id="${id}" type="button" class="${cls}" data-action="${action}" ${Object.entries(data).map(([k,v]) => `data-${k}="${escape(v)}"`).join(' ')} ${disabled || busy ? 'disabled' : ''} ${pressed === undefined ? '' : `aria-pressed="${pressed}"`}>${escape(text)}</button>`;
}
async function request(path, data, signal) {
  if (!safeTransport) throw new Error('Open the HTTPS preview before using a room.');
  const res = await fetch(path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { ...(path === '/api/rooms' && previewHostKey ? { 'X-Preview-Key': previewHostKey } : {}), ...(credentials ? { Authorization: `Bearer ${credentials.token}` } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: signal || AbortSignal.timeout(8000), cache: 'no-store'
  });
  const result = await res.json();
  if (!res.ok) { const err = new Error(result.error || 'The request failed.'); err.status = res.status; throw err; }
  return result;
}
const endpoint = name => `/api/rooms/${credentials.roomId}/${name}`;
function apply(next) {
  if (state && next.revision < state.revision) return;
  const oldSummary = summary(); state = next;
  if (next.phase === 'ended') {
    stopStream(); online = false; forgetAccess();
    connection.textContent = 'Room ended'; connection.className = 'connection';
  }
  render();
  const nextSummary = summary();
  if (nextSummary !== oldSummary || announcement.textContent !== nextSummary) announcement.textContent = nextSummary;
}
function summary() {
  if (state?.phase === 'ended') return 'This room has ended.';
  if (credentials && !online) return 'Reconnecting. Waiting for confirmed room state.';
  if (!state) return '';
  const holds = state.members?.filter(p => p.connected && p.moment).map(p => p.alias) || [];
  if (holds.length) return `${holds.join(' and ')} ${holds.length === 1 ? 'needs' : 'need'} a moment.`;
  return { waiting:'Waiting for the host.', prepare:'Prepare for the conversation.', active:'Conversation is active.', paused:'Conversation paused. Check readiness before resuming.', ended:'This room has ended.' }[state.phase] || '';
}
function setConnection(value, rerender = true) {
  const wasOffline = !online;
  online = value;
  if (value && wasOffline) error();
  if (!value) announcement.textContent = summary();
  connection.textContent = value ? 'Connected · room updates live' : credentials && !stopped ? 'Reconnecting · controls unavailable' : 'Preview · room not connected';
  connection.className = `connection ${value ? 'live' : credentials && !stopped ? 'lost' : ''}`;
  if (rerender) render();
}
function forgetAccess() {
  if (credentials) { try { sessionStorage.removeItem(`rehearsal:${credentials.roomId}`); } catch { /* No persistent fallback. */ } }
  history.replaceState(null, '', location.pathname);
}
function stopStream() {
  stopped = true; generation++; controller?.abort(); clearInterval(heartbeat); heartbeat = null;
}
function finishLocal(message) {
  forgetAccess(); pendingLabel = '';
  document.getElementById('pending').hidden = true;
  document.getElementById('pending').textContent = '';
  announcement.textContent = message;
  stopStream(); online = false; credentials = null; state = null; invitation = null;
  history.replaceState(null, '', location.pathname);
  connection.textContent = 'Room closed'; connection.className = 'connection';
  document.body.classList.remove('in-room');
  document.documentElement.classList.remove('has-room-controls');
  dockObserver.disconnect();
  document.querySelector('.wordmark').setAttribute('href', '/');
  app.innerHTML = `<section class="panel hero"><div class="eyebrow">Finished</div><h1>Rehearsal finished.</h1><p>${escape(message)}</p></section><section class="panel"><h2>Optional reflection</h2><p>Did you get across what you wanted? What helped, or got in the way? You can skip this.</p><p class="small">No answers or speech scores are stored.</p><a class="button" href="/">Back to home</a></section>`;
}
async function connectStream() {
  if (!safeTransport) { error('Open the HTTPS preview before using a room.'); return; }
  const current = ++generation; stopped = false;
  let failures = 0;
  while (!stopped && generation === current && credentials) {
    controller = new AbortController();
    let pulse = null;
    try {
      const res = await fetch(endpoint('events'), { headers: { Authorization: `Bearer ${credentials.token}` }, signal: controller.signal, cache: 'no-store' });
      if (!res.ok) {
        const data = await res.json(); const err = new Error(data.error || 'The room could not be opened.'); err.status = res.status; throw err;
      }
      const decoder = new TextDecoder(); let buffer = ''; lastFrame = Date.now();
      clearInterval(heartbeat);
      pulse = setInterval(async () => {
        if (generation !== current || stopped) return;
        if (Date.now() - lastFrame > 15_000) { setConnection(false); controller.abort(); return; }
        try { await request(endpoint('heartbeat'), {}); }
        catch { setConnection(false); controller.abort(); }
      }, 4000);
      heartbeat = pulse;
      const reader = res.body.getReader();
      while (!stopped && generation === current) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        if (generation !== current || stopped) break;
        lastFrame = Date.now(); buffer += decoder.decode(chunk, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
          const event = frame.match(/^event: (.+)$/m)?.[1];
          const data = frame.match(/^data: (.+)$/m)?.[1];
          if (event === 'state' && data) {
            failures = 0;
            const next = JSON.parse(data);
            if (next.phase !== 'ended') setConnection(true, false);
            apply(next);
          } else if (event === 'exit' && data) { finishLocal(JSON.parse(data).message); return; }
        }
      }
    } catch (err) {
      if (stopped || generation !== current) return;
      if ([403, 404].includes(err.status)) { error(err.message); finishLocal(err.message); return; }
      error(err.status === 409 ? err.message : 'Connection lost. Keep this page open to reconnect. No actions are confirmed while offline.');
    } finally { clearInterval(pulse); if (heartbeat === pulse) heartbeat = null; }
    if (stopped || generation !== current) return;
    setConnection(false);
    const delay = failures++ === 0 ? 0 : 1200;
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  }
}
function openRoom(roomId, token) {
  credentials = { roomId, token }; invitation = null; state = null; online = false;
  // Keep role authority out of the visible address bar, including during screen sharing.
  try { sessionStorage.setItem(`rehearsal:${roomId}`, token); }
  catch { error('This browser cannot retain your room access for a refresh. Keep this tab open.'); }
  history.replaceState(null, '', `/#room=${roomId}`);
  error(); render(); connectStream();
}
async function command(data) {
  if (busy) return;
  if (!online) { error('Reconnect before sending a room action. You can close this view at any time.'); return; }
  busy = true; pendingLabel = data.action === 'moment' ? 'Sending your time request…' : 'Sending the room action…'; error(); render();
  try {
    const result = await request(endpoint('action'), data);
    if (result.left) finishLocal('You left the room.');
    else if (result.ended) finishLocal('You ended the room for everyone.');
    else if (result.state) apply(result.state);
  } catch (err) { error(`${err.message} The action was not confirmed here.`); }
  finally { busy = false; pendingLabel = ''; render(); }
}
function render() {
  // Retain local focus and disclosures when a remote event updates the screen.
  if (stopped && !state && !credentials) return;
  const hasControls = Boolean(credentials && state && !['waiting', 'ended'].includes(state.phase));
  document.body.classList.toggle('in-room', hasControls);
  document.documentElement.classList.toggle('has-room-controls', hasControls);
  const wordmark = document.querySelector('.wordmark');
  if (credentials && state?.phase !== 'ended') wordmark.removeAttribute('href');
  else wordmark.setAttribute('href', '/');
  const pending = document.getElementById('pending');
  pending.textContent = pendingLabel; pending.hidden = !pendingLabel;
  const focusId = app.contains(document.activeElement) ? document.activeElement.id : null;
  const openDetails = [...app.querySelectorAll('details[open]')].map(d => d.id);
  if (!credentials) {
    app.innerHTML = invitation
      ? `<section class="intro"><div class="eyebrow">Your host invited you</div><h1>Ordering food</h1><p class="lede">One partner. An everyday conversation. Time to finish.</p></section><section class="panel entry"><h2>Join the rehearsal</h2><form id="join-form"><label for="alias">Display name</label><input id="alias" name="alias" value="${escape(joinAlias)}" autocomplete="off" maxlength="24" required placeholder="A nickname is fine"><p class="small">Your host and partner will see this name.</p><button class="primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Requesting…' : 'Ask the host to join'}</button></form><p class="small">Your host assigns the roles. Both people choose Ready before starting. Keep your existing audio call connected.</p></section>`
      : `<section class="intro"><div class="eyebrow">Human conversation practice</div><h1>Ordering food</h1><p class="lede">Rehearse with a partner, at your own pace.</p></section><section class="entry panel"><h2>Have an invitation?</h2><p>Open the link your host shared to join your rehearsal.</p><ol class="journey"><li><strong>Join your host</strong><span>Use a nickname. Wait for your role.</span></li><li><strong>Choose your order</strong><span>You’ll see the menu before you start.</span></li><li><strong>Have the conversation</strong><span>Ask for time or pause whenever you need.</span></li></ol><p class="small">You’ll need a willing partner and an existing audio call. This preview does not find partners.</p></section><section class="hosting"><h2>Hosting a rehearsal?</h2><p>Invite two people and assign customer and cashier.</p>${requiresHostKey && !previewHostKey ? '<form id="host-key-form"><label for="host-key">Private host key</label><input id="host-key" name="hostKey" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" minlength="32" maxlength="128" required aria-describedby="host-key-help"><p class="small" id="host-key-help">Only the preview owner needs this key. Participants use their invitation instead.</p><button class="primary" type="submit" ' + (!safeTransport || busy ? 'disabled' : '') + '>Create a room</button></form>' : button('create','Create a room','create',{cls:'primary',disabled:!safeTransport})}</section>`;
  } else if (!state) {
    app.innerHTML = '<section class="panel hero"><h1>Opening the room…</h1><p>Checking your link and connecting to the live state.</p></section>';
  } else if (state.phase === 'ended') {
    app.innerHTML = `<section class="panel hero"><h1>Room ended.</h1><p>${escape(state.notice)}</p></section><section class="panel"><h2>Optional reflection</h2><p>Did you communicate what you wanted? You can skip this; no answer is saved.</p><a class="button" href="/">Back to home</a></section>`;
  } else if (state.phase === 'waiting') {
    app.innerHTML = `<section class="panel hero"><div class="eyebrow">${escape(state.self.alias)}</div><h1>Waiting for your host.</h1><p>Your request is pending. You are not paired with anyone yet.</p><p class="small">Host ${state.hostConnected ? 'connected' : 'not connected'}.</p></section><section class="panel"><h2>How this works</h2><p>The host assigns two roles. Both people choose Ready before starting.</p><p>${escape(norms)}</p></section>${button('leave','Cancel request','leave',{cls:'quiet',disabled:!online})}`;
  } else {
    const isHost = state.self.role === 'host';
    const pair = state.members || [], holds = online ? pair.filter(p => p.connected && p.moment) : [];
    const canStart = online && state.hostConnected && pair.length === 2 && pair.every(p => p.connected && p.ready && !p.moment && !p.paused);
    const headline = holds.length ? holds.map(p => p.id === state.self.id ? 'You need a moment' : `${p.alias} needs a moment`).join('. ') : {prepare:'Get ready to try.',active:'Your conversation.',paused:'Take a pause.'}[state.phase];
    let controls = '';
    if (isHost) {
      if (state.phase === 'prepare' || state.phase === 'paused') controls += button('start',state.phase === 'paused' ? 'Resume when both are ready' : 'Start when both are ready','start',{cls:'primary',disabled:!canStart});
      if (state.phase === 'active') controls += button('pause','Pause conversation','pause',{disabled:!online});
    } else {
      if (state.phase !== 'prepare' || state.self.moment) controls += button('moment-control',!online ? 'Waiting to reconnect' : state.self.moment ? 'Clear my time request' : 'Give me a moment','moment',{cls:'signal',pressed:online && state.self.moment,disabled:!online,value:!state.self.moment});
      if (state.phase === 'prepare' || state.phase === 'paused') controls += button('ready-control',state.self.ready ? 'Not ready yet' : state.phase === 'prepare' && state.attempt === 1 ? 'Ready to begin' : 'Ready to continue','ready',{cls:'primary',pressed:online && state.self.ready,disabled:!online || state.self.moment,value:!state.self.ready});
      if (state.phase === 'active') controls += button('pause','Pause conversation','pause',{disabled:!online});
    }
    const retry = state.phase !== 'prepare' ? button('retry','Request another attempt','retry',{disabled:!online || !state.hostConnected || pair.length !== 2 || pair.some(p => !p.connected)}) : '';
    app.innerHTML = `<section class="room-heading ${holds.length ? 'needs-time' : ''}"><div class="eyebrow">${escape(roleName(state.self.role))} / attempt ${state.attempt} / ${!online ? 'Last known state' : escape({prepare:'Preparation',active:'In conversation',paused:'Paused'}[state.phase])}</div><h1>${escape(!online ? 'Reconnecting…' : holds.length ? headline : state.phase === 'active' ? 'Ordering food' : headline)}</h1><p>${!online ? 'Waiting for live room state. Your requests are not confirmed while offline.' : holds.length ? holds.some(p => p.id === state.self.id) ? 'Your request stays visible until you clear it. Let others finish, too.' : 'Give them time. They will clear their own request.' : escape(state.notice)}</p></section>
      ${isHost ? hostPanel(state) : ''}
      ${state.phase !== 'active' ? `<section class="brief"><h2>Your role: ${escape(roleName(state.self.role))}</h2><p>${escape(briefs[state.self.role])}</p></section>` : ''}
      <section class="menu-sheet" aria-labelledby="menu-title"><div class="menu-caption"><span>Practice menu</span><span>01</span></div><h2 id="menu-title">Tea &amp; coffee</h2><dl class="menu-options"><div><dt>Drink</dt><dd>Iced tea or coffee</dd></div><div><dt>Size</dt><dd>Small or large</dd></div><div><dt>Ice</dt><dd>With or without</dd></div><div><dt>Service</dt><dd>For here or takeaway</dd></div></dl><p class="small">Fictional menu. Keep your order in your own notes.</p></section>
      <section class="people"><h2>${online ? 'In the room' : 'Last known participants'}</h2><p class="small">Host ${state.hostConnected ? 'connected' : 'disconnected — wait to continue'}.</p><ul class="pair">${pair.map(p => `<li><strong>${escape(p.alias)}<span class="role-name">${escape(roleName(p.role))}</span></strong><span>${!p.connected ? 'Disconnected' : p.moment ? 'Needs a moment' : p.ready ? 'Ready' : state.phase === 'active' ? 'Connected' : 'Not ready yet'}</span>${isHost && !p.connected ? button(`remove-${p.id}`,'Release disconnected seat','remove',{member:p.id,disabled:!online || state.phase==='active'}) : ''}</li>`).join('') || '<li>Waiting for the host to admit a pair.</li>'}</ul></section>
      <details class="room-details" id="guidance"><summary>Role &amp; listening guide</summary>${state.phase === 'active' ? `<h2>Your role: ${escape(roleName(state.self.role))}</h2><p>${escape(briefs[state.self.role])}</p>` : ''}<p>${escape(norms)}</p></details>
      <details class="room-details" id="session-options"><summary>Session options</summary>${retry}<p class="small">Room closes at ${escape(new Date(state.expiresAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}))} in your current time zone.</p>
      <div class="end-row">${isHost ? (ending ? `<p>End this room for everyone? It cannot be reopened.</p><div class="buttons">${button('end-confirm','End room for everyone','end',{cls:'danger',disabled:!online})}${button('cancel-end','Keep room open','cancel-end')}</div>` : button('end-prompt','End room','end-prompt',{cls:'danger',disabled:!online})) : button('leave','Leave room','leave',{cls:'quiet',disabled:!online})}</div></details>
      <section class="control-dock" aria-label="Conversation controls">${!online || holds.length ? `<p class="dock-status ${!online ? 'offline' : 'needs-time'}">${!online ? 'Reconnecting · requests unconfirmed' : escape(holds.map(p => p.id === state.self.id ? 'You asked for a moment' : `${p.alias} needs a moment`).join('. '))}</p>` : ''}<div class="buttons">${controls}</div>${!isHost ? `<p class="dock-hint">${state.phase === 'active' ? 'A time request asks everyone to wait until you clear it.' : 'Both people choose Ready before the host can start.'}</p>` : ''}</section>`;
  }
  if (credentials && state && state.phase !== 'ended' && !online) {
    app.insertAdjacentHTML('beforeend', `<div class="end-row">${button('close-offline','Close this view','close-offline',{cls:'quiet'})}<p class="small">The room cannot confirm a leave while offline. The host will see a disconnection.</p></div>`);
  }
  dockObserver.disconnect();
  const dock = app.querySelector('.control-dock');
  if (dock) {
    document.documentElement.style.setProperty('--dock-height', `${dock.getBoundingClientRect().height}px`);
    dockObserver.observe(dock);
  }
  for (const id of openDetails) { const node = document.getElementById(id); if (node) node.open = true; }
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}
function hostPanel(room) {
  const url = `${publicPreviewOrigin || location.origin}/#join=${room.roomId}.${room.invite}`;
  return `<section class="panel"><h2>Invite the pair</h2><p class="small">Share this invitation through your group’s existing channel. Keep this host tab for yourself.</p><label class="sr-only" for="invite-link">Participant invitation</label><input class="invite" id="invite-link" readonly value="${escape(url)}">${button('copy','Copy participant invitation','copy')}<h3>Waiting requests</h3>${room.waiting.length ? room.waiting.map(p => `<div class="waiting-card"><strong>${escape(p.alias)}</strong><p class="small">${p.connected ? 'Connected · awaiting admission' : 'Disconnected · wait before admitting'}</p><div class="buttons">${button(`admit-customer-${p.id}`,'Customer','admit',{member:p.id,role:'customer',disabled:!online || !p.connected || room.members.some(m=>m.role==='customer') || room.phase==='active'})}${button(`admit-cashier-${p.id}`,'Cashier','admit',{member:p.id,role:'cashier',disabled:!online || !p.connected || room.members.some(m=>m.role==='cashier') || room.phase==='active'})}${button(`decline-${p.id}`,'Decline','decline',{member:p.id,disabled:!online})}</div></div>`).join('') : '<p class="small">No requests yet. Share the invitation to bring people in.</p>'}</section>`;
}
async function createRoom() {
  busy = true; error(); render();
  try {
    const room = await request('/api/rooms', {});
    if (previewHostKey) { try { sessionStorage.setItem('rehearsal-preview-host', previewHostKey); } catch { /* Memory only is sufficient. */ } }
    openRoom(room.roomId, room.token);
  } catch (err) {
    if (err.status === 403 && requiresHostKey) {
      previewHostKey = null;
      try { sessionStorage.removeItem('rehearsal-preview-host'); } catch { /* No stored fallback. */ }
    }
    error(err.message);
  } finally { busy = false; render(); }
}
app.addEventListener('submit', async event => {
  if (event.target.id === 'host-key-form') {
    event.preventDefault(); if (busy) return;
    previewHostKey = String(new FormData(event.target).get('hostKey') || '').trim();
    await createRoom(); return;
  }
  if (event.target.id !== 'join-form') return;
  event.preventDefault(); if (busy) return;
  const alias = new FormData(event.target).get('alias'); joinAlias = alias; busy = true; error(); render();
  try {
    const result = await request(`/api/rooms/${invitation.roomId}/join`, { invite: invitation.token, alias });
    openRoom(invitation.roomId, result.token);
  } catch (err) { error(err.message); }
  finally { busy = false; render(); }
});
app.addEventListener('click', async event => {
  const node = event.target.closest('button[data-action]'); if (!node || node.disabled) return;
  const action = node.dataset.action;
  if (action === 'close-offline') { finishLocal('You closed this view while offline. Your leave could not be confirmed; the host will see your disconnection.'); return; }
  if (action === 'create') {
    await createRoom();
  } else if (action === 'copy') {
    const input = document.getElementById('invite-link');
    try { await navigator.clipboard.writeText(input.value); announcement.textContent = 'Participant invitation copied.'; }
    catch { input.focus(); input.select(); error('Copy the selected participant invitation manually.'); }
  } else if (action === 'end-prompt' || action === 'cancel-end') { ending = action === 'end-prompt'; render(); }
  else {
    const data = { action };
    if (node.dataset.value !== undefined) data.value = node.dataset.value === 'true';
    if (node.dataset.member) data.memberId = node.dataset.member;
    if (node.dataset.role) data.role = node.dataset.role;
    await command(data);
  }
});
window.addEventListener('pagehide', () => {
  // Closing a stream triggers a server-side pause; presence leases cover abrupt loss.
  stopStream();
});
function reconnectVisibleRoom() {
  if (!credentials || state?.phase === 'ended') return;
  if (!stopped && online && Date.now() - lastFrame < 10_000) return;
  stopStream(); stopped = false; online = false; setConnection(false); connectStream();
}
window.addEventListener('pageshow', event => { if (event.persisted) reconnectVisibleRoom(); });
// Invitations can open in an existing phone tab. A new fragment is a new room entry,
// not a continuation of that tab's previous role or finished screen.
window.addEventListener('hashchange', () => location.reload());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') reconnectVisibleRoom();
});
const fragment = new URLSearchParams(location.hash.slice(1));
if (safeTransport && /^[A-Za-z0-9_-]{32}$/.test(fragment.get('setup') || '')) {
  previewHostKey = fragment.get('setup');
  try { sessionStorage.setItem('rehearsal-preview-host', previewHostKey); } catch { /* Retain in memory only. */ }
  history.replaceState(null, '', '/');
}
const kind = fragment.has('room') ? 'room' : fragment.has('join') ? 'join' : null;
if (kind && safeTransport) {
  const parts = fragment.get(kind).split('.');
  let savedToken = null;
  if (kind === 'room' && parts.length === 1 && /^[A-Za-z0-9_-]{32}$/.test(parts[0])) {
    try { savedToken = sessionStorage.getItem(`rehearsal:${parts[0]}`); } catch { /* Explain missing access below. */ }
  }
  if (savedToken) openRoom(parts[0], savedToken);
  else if (parts.length === 2 && parts.every(p => /^[A-Za-z0-9_-]{32}$/.test(p))) {
    if (kind === 'room') openRoom(parts[0],parts[1]);
    else invitation = {roomId:parts[0],token:parts[1]};
  } else if (kind === 'room' && parts.length === 1) {
    error('Room access belongs to the original tab. Ask the host for a participant invitation, or create a new room.');
  } else error('This room link is incomplete. Ask the host for a fresh participant invitation.');
}
if (!safeTransport) {
  error('Use HTTPS for this preview. Room access is disabled on this address.');
  const secure = new URL(location.href); secure.protocol = 'https:';
  const link = document.createElement('a'); link.href = secure.href; link.textContent = ' Open the HTTPS preview.'; errorBox.append(link);
}
render();
