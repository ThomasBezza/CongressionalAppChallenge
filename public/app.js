import { norms, scenarios } from './content.js';
import { VoiceCall } from './voice.js';

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
let ticketDraft = null, ticketContext = '';
let selectedScenario = 'cafe';
const currentScene = () => scenarios[state?.scenarioId] || scenarios.cafe;
const voicePanel = document.getElementById('voice-panel');
const voice = new VoiceCall({
  send: (access, name, data) => request(`/api/rooms/${access.roomId}/${name}`, data, undefined, access),
  changed: renderVoice
});
const micIcon = off => `<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>${off ? '<path d="M4 4l16 16"/>' : ''}</svg>`;
const voiceTrouble = () => [...voice.peers.values()].filter(p => p.failed || p.pc.connectionState === 'failed').map(p => p.remote.alias);
// Audio status for one person. No speaking indicator: a silent block is still speaking.
function audioStatus(id) {
  const room = voice.room || state;
  if (!room) return '';
  if (id === room.self?.id) return voice.stream ? voice.muted ? 'Audio: muted' : 'Audio: mic on' : voice.busy ? 'Audio: starting' : 'Not in the audio';
  const entry = room.audio?.find(a => a.id === id);
  if (!entry) return 'Not in the audio';
  const peer = voice.peers.get(id);
  if (peer && (peer.failed || peer.pc.connectionState === 'failed')) return 'Audio: can’t connect';
  if (voice.stream && peer && peer.pc.connectionState !== 'connected') return 'Audio: connecting';
  return entry.muted ? 'Audio: muted' : 'Audio: mic on';
}
function micButton() {
  if (!voice.stream) return `<button id="voice-dock-toggle" type="button" class="mic" data-action="voice-join" aria-label="Join audio" ${voice.busy ? 'aria-disabled="true"' : ''}>${micIcon(true)}<span aria-hidden="true">${voice.busy ? 'Wait' : 'Join'}</span></button>`;
  return `<button id="voice-dock-toggle" type="button" class="mic ${voice.muted ? '' : 'live'}" data-action="voice-mute" aria-label="Microphone" aria-pressed="${!voice.muted}" ${voice.busy ? 'aria-disabled="true"' : ''}>${micIcon(voice.muted)}<span>${voice.muted ? 'Muted' : 'Mic on'}</span></button>`;
}
function renderVoice() {
  if (!voicePanel) return;
  const focusId = document.activeElement?.closest?.('#voice-panel, #voice-dock, [data-voice-options]') ? document.activeElement.id : null;
  const trouble = voiceTrouble();
  const problem = trouble.length ? `The audio can’t reach ${trouble.join(' and ')} yet. Leave the audio and join it again.${voice.relay ? '' : ' If that doesn’t work, the network may be blocking direct calls.'}` : voice.message;
  const pill = document.getElementById('voice-status');
  if (pill) {
    pill.hidden = !voice.room;
    pill.textContent = !voice.stream ? voice.busy ? 'Starting audio' : 'Audio is off' : trouble.length ? 'Audio has a problem' : voice.muted ? 'Your mic is muted' : 'Your mic is on';
    pill.className = `connection voice ${trouble.length ? 'lost' : voice.stream && !voice.muted ? 'live' : voice.stream ? 'joined' : ''}`;
  }
  for (const node of document.querySelectorAll('[data-audio-for]')) node.textContent = audioStatus(node.dataset.audioFor);
  for (const node of document.querySelectorAll('[data-self-mic]')) {
    node.textContent = !voice.stream ? '' : node.dataset.selfMic === 'paused' ? voice.muted ? '' : ' Your mic is still on.' : voice.muted ? ' Your mic is muted.' : ' Your mic is on.';
  }
  const slot = document.getElementById('voice-dock');
  if (slot) slot.innerHTML = voice.room ? micButton() : '';
  for (const node of document.querySelectorAll('[data-voice-options]')) node.innerHTML = voice.stream ? button('voice-options-leave','Leave audio','voice-leave',{independent:true,cls:'quiet'}) + '<p class="small">You’ll stay in the rehearsal after leaving the audio.</p>' : '';
  // The full card is for setup and problems; once the attempt starts the dock holds the mic.
  voicePanel.hidden = !voice.room || voice.room.phase !== 'prepare' && !problem && !voice.blocked;
  if (!voicePanel.hidden) {
    const text = problem || (!voice.stream ? 'You can talk to each other here instead of using a separate call. You’ll start muted, and nothing is recorded.'
      : `You’re connected. ${voice.muted ? 'Your mic is muted, so tap Unmute when you want to speak.' : 'Your mic is on.'}${voice.peers.size ? '' : ' Nobody else has joined the audio yet.'}`);
    voicePanel.innerHTML = `<h2>Room audio</h2><p role="status" class="${problem ? 'voice-alert' : ''}">${escape(text)}</p><div class="buttons">${voice.stream ? button('voice-mute',voice.muted ? 'Unmute' : 'Mute','voice-mute',{independent:true,waiting:voice.busy}) + button('voice-leave','Leave audio','voice-leave',{independent:true,cls:'quiet'}) : button('voice-join',voice.busy ? 'Opening microphone…' : 'Join audio','voice-join',{independent:true,cls:'primary',waiting:voice.busy})}${voice.busy && !voice.stream ? button('voice-cancel','Cancel','voice-cancel',{independent:true}) : ''}${voice.blocked ? button('voice-play','Tap to hear the room','voice-play',{independent:true}) : ''}</div><p class="small">${voice.stream ? 'Keep this page open. The audio may stop if you switch apps or lock your phone. If two of your devices are in the same room, use headphones so they don’t echo.' : 'Only the host and the two people practicing can join. Asking for time never mutes anyone.'}</p>`;
  }
  if (focusId) document.getElementById(focusId)?.focus({preventScroll:true});
}
function voiceAction(action) {
  if (action === 'voice-join') voice.join();
  if (action === 'voice-mute') voice.toggleMute();
  if (action === 'voice-leave' || action === 'voice-cancel') voice.leave('You left the audio. You’re still in the rehearsal.');
  if (action === 'voice-play') voice.enablePlayback();
  return action?.startsWith('voice-');
}
const dockObserver = new ResizeObserver(entries => {
  const dock = entries[0]?.target;
  if (dock) document.documentElement.style.setProperty('--dock-height', `${dock.getBoundingClientRect().height}px`);
});
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const roleName = role => currentScene().roles[role] || 'Waiting for admission';
function error(message = '') { errorBox.textContent = message; errorBox.hidden = !message; }
// `waiting` marks a button unavailable without disabling it, so keyboard focus survives a rerender.
function button(id, text, action, { disabled = false, waiting = false, cls = '', pressed, independent = false, ...data } = {}) {
  return `<button id="${id}" type="button" class="${cls}" data-action="${action}" ${Object.entries(data).map(([k,v]) => `data-${k}="${escape(v)}"`).join(' ')} ${disabled || busy && !independent ? 'disabled' : ''} ${waiting ? 'aria-disabled="true"' : ''} ${pressed === undefined ? '' : `aria-pressed="${pressed}"`}>${escape(text)}</button>`;
}
async function request(path, data, signal, access = credentials) {
  if (!safeTransport) throw new Error('Open the HTTPS preview before using a room.');
  const res = await fetch(path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { ...(path === '/api/rooms' && previewHostKey ? { 'X-Preview-Key': previewHostKey } : {}), ...(access ? { Authorization: `Bearer ${access.token}` } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
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
    ticketDraft = null; ticketContext = '';
    stopStream(); online = false; forgetAccess();
    connection.textContent = 'Room closed'; connection.className = 'connection';
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
  // Server wording combines current presence with any remaining manual/seat-change cause.
  const paused = state.phase === 'paused' ? `Conversation paused. ${state.notice || 'Check readiness before resuming.'}` : '';
  const phase = { waiting:'Waiting for the host.', prepare:`Prepare for the conversation. ${state.notice || ''}`.trim(), active:'Conversation is active.', paused, ended:'This room has ended.' }[state.phase] || '';
  if (holds.length) {
    const status = ['prepare', 'paused'].includes(state.phase) ? phase : '';
    return `${holds.join(' and ')} ${holds.length === 1 ? 'needs' : 'need'} a moment.${status ? ` ${status}` : ''}${momentTicketNote() ? ` ${momentTicketNote()}` : ''}`;
  }
  return state.ticket ? `${phase} ${ticketStatus(state.ticket, state.self.role)}` : phase;
}
function setConnection(value, rerender = true) {
  const wasOffline = !online;
  online = value;
  if (value && wasOffline) error();
  if (!value) announcement.textContent = summary();
  connection.textContent = value ? 'Connected to the room' : credentials && !stopped ? 'Reconnecting to the room' : 'Not connected';
  connection.className = `connection ${value ? 'live' : credentials && !stopped ? 'lost' : ''}`;
  connection.hidden = !credentials && !value;
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
  ticketDraft = null; ticketContext = '';
  voice.sync(null, false, null);
  document.body.classList.remove('taking-moment', 'listener-hold');
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
  app.innerHTML = closedScreen(message);
}
function closedScreen(message) {
  return `<section class="panel hero"><h1>This room has closed</h1><p>${escape(message)}</p><p class="small">The room’s audio has ended and your microphone is off.</p></section><section class="panel"><h2>If you’d like to think it over</h2><ul class="prompts"><li>Did you get across what you wanted to say?</li><li>What helped, and what got in the way?</li><li>What would you try differently next time?</li></ul><p class="small">These questions are just for you. Nothing here is saved.</p><a class="button" href="/">Go to the home page</a></section>`;
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
          } else if (event === 'audio-signal' && data) voice.receive(JSON.parse(data));
          else if (event === 'exit' && data) { finishLocal(JSON.parse(data).message); return; }
        }
      }
    } catch (err) {
      if (stopped || generation !== current) return;
      if ([403, 404].includes(err.status)) {
        const message = err.status !== 404 ? err.message : state?.self.role === 'host'
          ? 'This room is no longer available. Return home and create a new room, then share its fresh participant invitation.'
          : state
            ? 'This room is no longer available. Ask the host for a fresh participant invitation.'
            : 'This room is no longer available. If you are hosting, return home and create a new room. Otherwise, ask your host for a fresh invitation.';
        error(err.status === 403 ? message : ''); finishLocal(message); return;
      }
      error(err.status === 409 ? err.message : 'Connection lost. Keep this page open to reconnect. No actions are confirmed while offline.');
    } finally { clearInterval(pulse); if (heartbeat === pulse) heartbeat = null; }
    if (stopped || generation !== current) return;
    setConnection(false);
    const delay = failures++ === 0 ? 0 : 1200;
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  }
}
function openRoom(roomId, token) {
  ticketDraft = null; ticketContext = '';
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
    else if (result.state) { if (data.action === 'ticket-share') ticketDraft = null; apply(result.state); }
  } catch (err) { error(`${err.message} The action was not confirmed here.`); }
  finally { busy = false; pendingLabel = ''; render(); }
}
function ticketStatus(ticket, role) {
  const scene = currentScene(), listener = scene.roles.cashier.toLowerCase(), speaker = scene.roles.customer.toLowerCase(), noun = scene.ticketNoun;
  if (ticket.response === 'confirmed') return role === 'customer' ? 'You confirmed: that’s what you wanted.' : `The ${speaker} confirmed: that’s what they wanted.`;
  if (ticket.response === 'correction') return role === 'customer' ? 'Talk through what you’d like changed.' : `The ${speaker} would like a change. Ask them what to change.`;
  if (ticket.response === 'skipped') return role === 'customer' ? ticket.edition > 1 ? `The ${listener} updated the ${noun}.` : `You skipped the ${noun} review.` : `The ${speaker} skipped the ${noun} review. You can keep talking.`;
  return role === 'customer' ? ticket.revealed ? `Check what the ${listener} understood. You can confirm or ask for a change.` : ticket.edition > 1 ? `The ${listener} updated the ${noun}. You can review the changes or skip them.` : `The ${listener} shared a ${noun}. You can review it or skip it.` : ticket.revealed ? `The ${speaker} is reviewing the ${noun}.` : `The ${noun} is shared. Reviewing it is the ${speaker}’s choice.`;
}
// The speaker's time request keeps any incoming review offer in the pinned dock.
function momentTicketNote() {
  const ticket = state?.ticket, scene = currentScene(), listener = scene.roles.cashier.toLowerCase(), noun = scene.ticketNoun;
  if (state?.self?.role !== 'customer' || !state.self.moment || !ticket) return '';
  if (!ticket.revealed) return `${ticket.edition > 1 ? `The ${listener} updated the ${noun}.` : `${scene.listenerAddress} sent a ${noun}.`} You can review it after you tap I’m ready to go on.`;
  return ticket.response === 'confirmed' ? '' : `The ${listener}’s ${noun} will be here after you tap I’m ready to go on.`;
}
function ticketPanel() {
  if (!['active', 'paused'].includes(state.phase)) { ticketDraft = null; ticketContext = ''; return ''; }
  const scene = currentScene(), ticketFields = scene.ticketFields;
  const listener = scene.roles.cashier.toLowerCase(), speaker = scene.roles.customer.toLowerCase(), noun = scene.ticketNoun;
  const role = state.self.role, ticket = state.ticket;
  const action = (id, text, name, cls = '') => button(id, text, name, { cls, disabled: !online, waiting: busy, independent: true, version: state.ticketVersion, attempt: state.attempt });
  const status = ticket ? `<p>${escape(ticketStatus(ticket, role))}</p>` : '';
  if (role === 'host') return ticket ? `<section class="panel"><h2>${escape(scene.ticketTitle)}</h2>${status}<p class="small">The details are for the ${escape(speaker)} and ${escape(listener)}.</p></section>` : '';
  if (role === 'cashier') {
    const context = `${state.roomId}:${state.scenarioId}:${state.attempt}:${state.members.map(p => p.id).join(':')}`;
    if (context !== ticketContext || !ticketDraft || !ticketDraft.dirty && ticketDraft.version !== state.ticketVersion) {
      ticketContext = context;
      ticketDraft = { version: state.ticketVersion, dirty: false, fields: Object.fromEntries(ticketFields.map(f => [f.name, ticket?.fields?.[f.name] || ''])) };
    }
    const stale = ticketDraft.version !== state.ticketVersion;
    return `<section class="ticket-sheet" aria-labelledby="ticket-title"><h2 id="ticket-title" tabindex="-1">Write the ${escape(scene.ticketTitle.toLowerCase())}</h2><p id="ticket-choice-help">Choose what you understood. Tap a selected choice again to leave it unanswered.</p>${status}${stale ? `<p class="voice-alert">The shared ${escape(noun)} changed in another view. Load it before editing again.</p>${button('ticket-reload', `Load the shared ${noun}`, 'ticket-reload')}` : ''}<form id="ticket-form"><div class="ticket-fields">${ticketFields.map(f => `<fieldset aria-describedby="ticket-choice-help"><legend>${escape(f.label)}</legend><div class="ticket-choices">${f.options.map((value, i) => button(`ticket-${f.name}-${i}`, value, 'ticket-choice', { pressed: ticketDraft.fields[f.name] === value, disabled: !online || stale, waiting: busy, independent: true, field: f.name, choice: value })).join('')}</div></fieldset>`).join('')}</div><button id="ticket-share" class="primary" type="submit" ${busy ? 'aria-disabled="true"' : ''} ${!online || stale || !Object.values(ticketDraft.fields).some(Boolean) ? 'disabled' : ''}>${busy ? 'Sharing…' : ticket ? `Share revised ${escape(noun)}` : `Share ${escape(noun)}`}</button></form><p class="small">Unshared edits stay in this tab. Sharing offers an optional review; it doesn’t end the conversation. The ${escape(noun)} disappears when you retry or the room closes.</p></section>`;
  }
  if (!ticket || state.self.moment) return '';
  if (!ticket.revealed) {
    const skipped = ticket.response === 'skipped', updated = ticket.edition > 1;
    const offer = skipped ? '' : `<p>${updated ? 'You can review the changes or skip them.' : 'You can review it or skip it.'}</p>`;
    return `<section class="ticket-offer" aria-labelledby="ticket-title"><h2 id="ticket-title" tabindex="-1">${escape(updated ? `The ${listener} updated the ${noun}` : skipped ? scene.ticketTitle : `${scene.listenerAddress} has a ${noun} ready`)}</h2>${offer}<div class="buttons">${action('ticket-review', `Review ${noun}`, 'ticket-review', skipped ? '' : 'primary')}${skipped ? '' : action('ticket-skip', 'Skip review', 'ticket-skip', 'quiet')}</div></section>`;
  }
  const details = `<dl class="menu-options">${ticketFields.map(f => `<div><dt>${escape(f.label)}</dt><dd>${escape(ticket.fields[f.name] || 'Not heard yet')}</dd></div>`).join('')}</dl><p class="small">This is what the ${escape(listener)} understood. You can clarify anything, including an unanswered detail.</p>`;
  const controls = `${ticket.response !== 'confirmed' ? action('ticket-confirm', 'That’s what I wanted', 'ticket-confirm', 'primary') : ''}${ticket.response !== 'correction' ? action('ticket-correction', 'I’d like a change', 'ticket-correction') : ''}${action('ticket-skip', 'Skip review', 'ticket-skip', 'quiet')}`;
  return `<section class="ticket-sheet" aria-labelledby="ticket-title"><h2 id="ticket-title" tabindex="-1">The ${escape(listener)}’s ${escape(noun)}</h2>${status}${details}<div class="buttons">${controls}</div><p class="small">Reviewing is optional. Nothing is scored or saved after the room closes.</p></section>`;
}
function sceneChooser() {
  return `<fieldset class="scene-chooser"><legend>What would you like to rehearse?</legend>${Object.values(scenarios).map(scene => `<label class="scene-option"><input type="radio" name="scenario" value="${scene.id}" ${selectedScenario === scene.id ? 'checked' : ''} ${busy ? 'disabled' : ''}><span><strong>${escape(scene.title)}</strong><span>${escape(scene.description)}</span></span></label>`).join('')}</fieldset><p class="small">The scene stays the same for everyone in this room, including on retries.</p>`;
}
function referenceSheet(scene) {
  return `<section class="menu-sheet" aria-labelledby="menu-title"><h2 id="menu-title">${escape(scene.referenceTitle)}</h2><dl class="menu-options">${scene.facts.map(f => `<div><dt>${escape(f.label)}</dt><dd>${escape(f.value)}</dd></div>`).join('')}</dl><p class="menu-note">${escape(scene.referenceNote)}</p></section>`;
}
function render() {
  voice.sync(state, online, credentials);
  // Retain local focus and disclosures when a remote event updates the screen.
  if (stopped && !state && !credentials) return;
  const takingMoment = Boolean(online && state?.phase !== 'ended' && state?.members?.some(p => p.connected && p.moment));
  document.body.classList.toggle('taking-moment', takingMoment);
  document.body.classList.toggle('listener-hold', takingMoment && !state.self.moment);
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
      ? `<section class="intro"><h1>You’re invited to rehearse a conversation</h1><p class="lede">You’ll practice with one partner while a host keeps things running. You can ask for more time, pause, or leave whenever you want.</p></section><section class="panel entry"><form id="join-form"><label for="alias">What name should the others see?</label><input id="alias" name="alias" value="${escape(joinAlias)}" autocomplete="off" maxlength="24" required placeholder="A nickname is fine"><button class="primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Asking…' : 'Ask to join'}</button></form><p class="small">Once your host lets you in, you can join the room’s audio. Your browser will ask to use your microphone, and you’ll start muted. Nothing is recorded.</p></section>`
      : `<section class="intro"><h1>Practice a conversation with a partner</h1><p class="lede">Choose a scene and talk it through with a partner. Either of you can ask for more time, and the other person waits until you’re ready to go on.</p></section><section class="entry panel"><h2>Joining someone’s room?</h2><p>Open the invitation link your host sent you. From there:</p><ol class="journey"><li><strong>Choose a name</strong><span>A nickname is fine. Your host lets you in and assigns your role.</span></li><li><strong>Look over the scene</strong><span>Read your role before you begin. The scene details stay on screen while you talk.</span></li><li><strong>Talk it through</strong><span>Tap Give me a moment whenever you need more time.</span></li></ol><p class="small">You’ll need a host and a partner who has agreed to practice. This preview doesn’t match you with partners.</p></section><section class="hosting"><h2>Hosting a rehearsal?</h2><p>Choose a scene, create a room and invite two people. You’ll assign their roles before starting.</p>${sceneChooser()}${requiresHostKey && !previewHostKey ? '<form id="host-key-form"><label for="host-key">Private host key</label><input id="host-key" name="hostKey" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" minlength="32" maxlength="128" required aria-describedby="host-key-help"><p class="small" id="host-key-help">Only the preview owner needs this key. Participants use their invitation instead.</p><button class="primary" type="submit" ' + (!safeTransport || busy ? 'disabled' : '') + '>Create a room</button></form>' : button('create','Create a room','create',{cls:'primary',disabled:!safeTransport})}</section>`;
  } else if (!state) {
    app.innerHTML = '<section class="panel hero"><h1>Opening the room</h1><p>Checking your link and connecting.</p></section>';
  } else if (state.phase === 'ended') {
    app.innerHTML = closedScreen(state.notice);
  } else if (state.phase === 'waiting') {
    app.innerHTML = `<section class="panel hero"><h1>Waiting for your host</h1><p>You’ve asked to join as ${escape(state.self.alias)}. Your host will let you in and tell you which role you have.</p><p class="small">${state.hostConnected ? 'Your host is connected.' : 'Your host isn’t connected right now.'}</p></section><section class="panel"><h2>How the practice works</h2><p>Your host will give you a scene and role when you’re admitted. Once you’re both ready, the host starts the conversation.</p><p>${escape(norms)}</p></section>${button('leave','Cancel request','leave',{cls:'quiet',disabled:!online})}`;
  } else {
    const isHost = state.self.role === 'host', scene = currentScene();
    const pair = state.members || [], holds = online ? pair.filter(p => p.connected && p.moment) : [];
    const canStart = online && state.hostConnected && pair.length === 2 && pair.every(p => p.connected && p.ready && !p.moment && !p.paused);
    const headline = holds.length ? holds.map(p => p.id === state.self.id ? 'You’re taking a moment' : `${p.alias} is taking a moment`).join('. ') : {prepare:'Get ready to try.',active:'Your conversation.',paused:'Take a pause.'}[state.phase];
    // One primary action sits beside the microphone; anything else is a smaller second row.
    let primary = '', secondary = '';
    const momentButton = cls => button('moment-control',!online ? 'Waiting to reconnect' : state.self.moment ? 'I’m ready to go on' : 'Give me a moment','moment',{cls,pressed:online && state.self.moment,disabled:!online,value:!state.self.moment});
    const readyButton = cls => button('ready-control',state.self.ready ? 'Not ready yet' : 'I’m ready','ready',{cls,pressed:online && state.self.ready,disabled:!online || state.self.moment,value:!state.self.ready});
    if (isHost) {
      if (state.phase === 'prepare' || state.phase === 'paused') primary = button('start',state.phase === 'paused' ? 'Resume' : 'Start','start',{cls:'primary',disabled:!canStart});
      if (state.phase === 'active') primary = button('pause','Pause','pause',{disabled:!online});
    } else if (state.phase === 'active') {
      primary = momentButton('signal'); secondary = button('pause','Pause','pause',{disabled:!online});
    } else if (state.self.moment) {
      primary = momentButton('signal'); secondary = readyButton('');
    } else {
      primary = readyButton('primary'); if (state.phase === 'paused') secondary = momentButton('');
    }
    const hint = isHost ? state.phase === 'active' ? '' : canStart ? 'Both people are ready.' : 'You can start once both people have tapped I’m ready.'
      : state.self.moment ? ['prepare', 'paused'].includes(state.phase) ? 'Tap I’m ready to go on before choosing I’m ready.' : ''
      : state.phase === 'active' ? 'Asking for time keeps your turn and leaves your microphone as it is.' : state.phase === 'paused' ? 'The host can continue once you’ve both tapped I’m ready.' : 'The host can start once you’ve both tapped I’m ready.';
    const others = holds.filter(p => p.id !== state.self.id);
    const stillSpeaking = others.some(p => state.audio?.some(a => a.id === p.id && !a.muted));
    const retry = state.phase !== 'prepare' ? button('retry','Ask to try again from the start','retry',{disabled:!online || !state.hostConnected || pair.length !== 2 || pair.some(p => !p.connected)}) : '';
    const pauseReason = online && ['prepare', 'paused'].includes(state.phase) && state.notice ? `<p class="pause-reason">${escape(state.notice)}</p>` : '';
    app.innerHTML = `<section class="room-heading ${holds.length ? 'needs-time' : ''}"><h1>${escape(!online ? 'Reconnecting to the room' : holds.length ? headline : state.phase === 'paused' ? 'The conversation is paused' : isHost ? state.phase === 'active' ? 'The conversation has started' : 'Set up the room' : state.phase === 'active' ? scene.activeTitle : `You’re the ${roleName(state.self.role).toLowerCase()}`)}</h1><p class="scene-context">${escape(scene.title)}</p><p>${!online ? 'Your taps won’t reach the others until the connection comes back.' : holds.some(p => p.id === state.self.id) ? 'Take as long as you need. The others have been asked to wait. Tap I’m ready to go on when you want to continue.<span data-self-mic="moment"></span>' : holds.length ? `Please wait and let them finish. They’ll tap to continue when they’re ready.${stillSpeaking ? ' Their microphone is on, so they may still be talking.' : ''}` : state.phase === 'paused' ? `Take your time. The conversation stays paused until the host resumes.<span data-self-mic="paused"></span>` : isHost ? state.phase === 'active' ? 'Let them talk without stepping in. You can pause if either of them needs it.' : 'Invite two people, let them in, and start once they’re both ready.' : state.phase === 'active' ? escape(`You’re the ${roleName(state.self.role).toLowerCase()}. Keep the ${scene.referenceName} nearby as you talk.`) : escape(scene.preparation[state.self.role])}</p>${pauseReason}</section>
      ${isHost ? hostPanel(state) : ''}
      <div id="voice-panel-slot"></div>
      ${referenceSheet(scene)}
      ${ticketPanel()}
      <section class="people"><h2>${online ? 'Who’s here' : 'Who was here before the connection dropped'}</h2><p class="small">${isHost ? 'You’re the host.' : state.hostConnected ? 'The host is here.' : 'The host has disconnected. Wait for them to come back.'} <span data-audio-for="host"></span></p><ul class="pair">${pair.map(p => `<li><span class="person-initial" aria-hidden="true">${escape([...p.alias][0]?.toLocaleUpperCase())}</span><strong>${escape(p.id === state.self.id ? p.alias + ' (you)' : p.alias)}<span class="role-name">${escape(roleName(p.role))}</span></strong><span class="person-state ${p.moment ? 'moment' : ''}">${!p.connected ? 'Disconnected' : p.moment ? 'Taking a moment' : p.ready ? 'Ready' : state.phase === 'active' ? 'Here' : 'Getting ready'}</span><span class="audio-line" data-audio-for="${escape(p.id)}"></span>${isHost && !p.connected ? button(`remove-${p.id}`,'Release disconnected seat','remove',{member:p.id,disabled:!online || state.phase==='active'}) : ''}</li>`).join('') || '<li>Nobody has been let in yet.</li>'}</ul></section>
      <details class="room-details" id="guidance"><summary>Your role and how to listen</summary><p>${escape(scene.briefs[state.self.role])}</p><p>${escape(norms)}</p></details>
      <details class="room-details" id="session-options"><summary>More options</summary><div data-voice-options></div>${retry}<p class="small">This is attempt ${state.attempt}. The room closes at ${escape(new Date(state.expiresAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}))}.</p>
      <div class="end-row">${isHost ? (ending ? `<p>End this room for everyone? It cannot be reopened.</p><div class="buttons">${button('end-confirm','End room for everyone','end',{cls:'danger',disabled:!online})}${button('cancel-end','Keep room open','cancel-end')}</div>` : button('end-prompt','End room','end-prompt',{cls:'danger',disabled:!online})) : button('leave','Leave room','leave',{cls:'quiet',disabled:!online})}</div></details>
      <section class="control-dock" aria-label="Conversation controls">${!online || holds.length ? `<div class="dock-status ${!online ? 'offline' : 'needs-time'}"><p>${!online ? 'Reconnecting. Your taps won’t reach the others yet.' : escape(holds.map(p => p.id === state.self.id ? 'You’re taking a moment' : `${p.alias} is taking a moment`).join('. '))}</p>${online && momentTicketNote() ? `<p class="dock-ticket">${escape(momentTicketNote())}</p>` : ''}</div>` : ''}<div class="dock-main"><div id="voice-dock" class="mic-slot"></div>${primary}</div>${secondary ? `<div class="dock-secondary">${secondary}</div>` : ''}${hint ? `<p class="dock-hint">${hint}</p>` : ''}</section>`;
  }
  // The audio card moves into the room layout; its node (not its media) survives rerenders.
  const voiceSlot = document.getElementById('voice-panel-slot');
  if (voiceSlot) voiceSlot.replaceWith(voicePanel);
  else if (voicePanel.parentElement !== app.parentElement) app.before(voicePanel);
  if (credentials && state && state.phase !== 'ended' && !online) {
    app.insertAdjacentHTML('beforeend', `<div class="end-row">${button('close-offline','Close this view','close-offline',{cls:'quiet'})}<p class="small">While you’re offline the room can’t confirm that you left, so the host will see you as disconnected.</p></div>`);
  }
  dockObserver.disconnect();
  const dock = app.querySelector('.control-dock');
  if (dock) {
    document.documentElement.style.setProperty('--dock-height', `${dock.getBoundingClientRect().height}px`);
    dockObserver.observe(dock);
  }
  for (const id of openDetails) { const node = document.getElementById(id); if (node) node.open = true; }
  renderVoice();
  if (focusId) (document.getElementById(focusId) || (focusId.startsWith('ticket-') ? document.getElementById('ticket-title') : null))?.focus({ preventScroll: true });
}
function hostPanel(room) {
  const url = `${publicPreviewOrigin || location.origin}/#join=${room.roomId}.${room.invite}`;
  return `<section class="panel"><h2>Invite two people</h2><p class="small">Send this link to the two people practicing, by text or however your group usually talks. Keep this tab open; it’s your host view.</p><label class="sr-only" for="invite-link">Invitation link</label><input class="invite" id="invite-link" readonly value="${escape(url)}">${button('copy','Copy invitation link','copy')}<h3>Waiting to join</h3>${room.waiting.length ? room.waiting.map(p => `<div class="waiting-card"><strong>${escape(p.alias)}</strong><p class="small">${p.connected ? 'Waiting for you to let them in.' : 'Disconnected. Wait for them to reconnect.'}</p><div class="buttons">${button(`admit-customer-${p.id}`,`Let in as ${roleName('customer').toLowerCase()}`,'admit',{member:p.id,role:'customer',disabled:!online || !p.connected || room.members.some(m=>m.role==='customer') || room.phase==='active'})}${button(`admit-cashier-${p.id}`,`Let in as ${roleName('cashier').toLowerCase()}`,'admit',{member:p.id,role:'cashier',disabled:!online || !p.connected || room.members.some(m=>m.role==='cashier') || room.phase==='active'})}${button(`decline-${p.id}`,'Decline','decline',{member:p.id,disabled:!online})}</div></div>`).join('') : '<p class="small">Nobody has asked to join yet.</p>'}</section>`;
}
async function createRoom() {
  busy = true; error(); render();
  try {
    const room = await request('/api/rooms', { scenarioId: selectedScenario });
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
app.addEventListener('change', event => {
  if (event.target.name === 'scenario' && Object.hasOwn(scenarios, event.target.value)) selectedScenario = event.target.value;
});
app.addEventListener('submit', async event => {
  if (event.target.id === 'ticket-form') {
    event.preventDefault(); if (busy || !ticketDraft) return;
    await command({ action: 'ticket-share', attempt: state.attempt, version: ticketDraft.version, fields: { ...ticketDraft.fields } });
    return;
  }
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
  const node = event.target.closest('button[data-action]'); if (!node || node.disabled || node.getAttribute('aria-disabled') === 'true') return;
  const action = node.dataset.action;
  if (voiceAction(action)) return;
  if (action === 'close-offline') { finishLocal('You closed this view while offline. Your leave could not be confirmed; the host will see your disconnection.'); return; }
  if (action === 'create') {
    await createRoom();
  } else if (action === 'copy') {
    const input = document.getElementById('invite-link');
    try { await navigator.clipboard.writeText(input.value); announcement.textContent = 'Invitation link copied.'; }
    catch { input.focus(); input.select(); error('Copy the selected participant invitation manually.'); }
  } else if (action === 'ticket-choice') {
    if (!ticketDraft || !online || busy || ticketDraft.version !== state.ticketVersion) return;
    const field = currentScene().ticketFields.find(f => f.name === node.dataset.field);
    if (!field?.options.includes(node.dataset.choice)) return;
    ticketDraft.fields[field.name] = ticketDraft.fields[field.name] === node.dataset.choice ? '' : node.dataset.choice;
    ticketDraft.dirty = true; render();
  } else if (action === 'ticket-reload') { ticketDraft = null; render(); }
  else if (action === 'end-prompt' || action === 'cancel-end') { ending = action === 'end-prompt'; render(); }
  else {
    const data = { action };
    if (node.dataset.value !== undefined) data.value = node.dataset.value === 'true';
    if (node.dataset.member) data.memberId = node.dataset.member;
    if (node.dataset.role) data.role = node.dataset.role;
    if (node.dataset.version) data.version = Number(node.dataset.version);
    if (node.dataset.attempt) data.attempt = Number(node.dataset.attempt);
    await command(data);
  }
});
window.addEventListener('pagehide', () => {
  voice.leave('', false);
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
