import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';

const secret = () => randomBytes(24).toString('base64url');
export class RoomError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const requireThat = (condition, status, message) => {
  if (!condition) throw new RoomError(status, message);
};

// Only this object changes room state. Clients request actions, never upload state.
export class Rooms extends EventEmitter {
  constructor({ now = Date.now, lifetimeMs = 60 * 60_000, leaseMs = 15_000 } = {}) {
    super(); this.rooms = new Map(); this.now = now;
    this.lifetimeMs = lifetimeMs; this.leaseMs = leaseMs;
  }
  create() {
    requireThat(this.rooms.size < 100, 503, 'The server is full. Try again after a room ends.');
    const room = {
      id: secret(), invite: secret(), host: { id: 'host', token: secret(), role: 'host', alias: 'Host', connected: false, lastSeen: this.now() },
      members: new Map(), phase: 'prepare', attempt: 1, revision: 0,
      notice: 'Waiting for two participants and the host.', expiresAt: this.now() + this.lifetimeMs
    };
    this.rooms.set(room.id, room);
    return { roomId: room.id, token: room.host.token, invite: room.invite };
  }
  get(id) {
    const room = this.rooms.get(id);
    requireThat(room, 404, 'This room is unavailable, ended, or expired. Ask the host for a new invitation.');
    if (this.now() >= room.expiresAt) {
      this.close(room, 'This room reached its one-hour limit. Ask the host for a new room.');
      throw new RoomError(404, 'This room expired. Ask the host for a new invitation.');
    }
    return room;
  }
  actor(room, token) {
    const actor = token === room.host.token ? room.host : room.members.get(token);
    requireThat(actor, 403, 'This room link is not valid for this action. Reopen your own link.');
    return actor;
  }
  participants(room) { return [...room.members.values()].filter(p => p.role); }
  changed(room) { room.revision += 1; this.emit('change', room); }
  resetReadiness(room) { this.participants(room).forEach(p => { p.ready = false; }); }
  pauseRoom(room, notice) {
    this.resetReadiness(room);
    if (room.phase === 'active' || room.phase === 'paused') room.phase = 'paused';
    room.notice = notice;
  }
  join(room, invite, alias) {
    requireThat(invite === room.invite, 403, 'This invitation is invalid. Ask the host for the correct link.');
    requireThat(typeof alias === 'string', 400, 'Enter a display name.');
    alias = alias.trim().normalize('NFC');
    requireThat(alias.length > 0 && alias.length <= 24 && !/[\u0000-\u001f\u007f]/u.test(alias), 400, 'Use a display name of 1–24 characters without control characters.');
    requireThat(room.members.size < 6, 409, 'This room has enough requests. Ask the host to clear waiting requests or create another room.');
    const token = secret();
    room.members.set(token, { id: secret(), token, alias, role: null, connected: false, lastSeen: this.now(), ready: false, moment: false, paused: false });
    this.changed(room);
    return { token };
  }
  connect(room, token, connected) {
    if (!this.rooms.has(room.id)) return;
    const actor = this.actor(room, token);
    actor.lastSeen = this.now();
    if (actor.connected === connected) return;
    actor.connected = connected;
    if (!connected) {
      actor.audio = null;
      actor.ready = false; actor.moment = false; actor.paused = false;
      if (actor.role) this.pauseRoom(room, `${actor.role === 'host' ? 'Host' : actor.alias} disconnected. Reconnect and check readiness before continuing.`);
    } else if (actor.role && actor.role !== 'host') {
      actor.ready = false;
    }
    this.changed(room);
  }
  heartbeat(room, token) {
    const actor = this.actor(room, token);
    requireThat(actor.connected, 409, 'Reconnect to the live room before sending actions.');
    actor.lastSeen = this.now();
  }
  audioActor(room, token) {
    const actor = this.actor(room, token);
    requireThat(actor.role && actor.connected && room.phase !== 'ended', 403, 'Join the live room and wait for admission before using audio.');
    return actor;
  }
  audioCommand(room, token, data) {
    const actor = this.audioActor(room, token);
    requireThat(typeof data.session === 'string' && /^[a-zA-Z0-9-]{36}$/.test(data.session), 400, 'Rejoin audio to start a fresh call connection.');
    if (data.action === 'join') {
      requireThat(!actor.audio || actor.audio.session === data.session, 409, 'Audio is already open in another tab for this role. Leave audio there first.');
      actor.audio ||= { session: data.session, muted: true, window: this.now(), count: 0 };
    } else {
      // A late leave from a previous tab/session cannot clear a replacement call.
      if (data.action === 'leave' && !actor.audio) return { state: this.view(room, token) };
      requireThat(actor.audio?.session === data.session, 409, 'This audio connection is no longer current. Leave and rejoin audio.');
      if (data.action === 'leave') actor.audio = null;
      else if (data.action === 'mute' && typeof data.muted === 'boolean') actor.audio.muted = data.muted;
      else throw new RoomError(400, 'Choose join, mute or leave audio.');
    }
    actor.lastSeen = this.now(); this.changed(room);
    return { state: this.view(room, token) };
  }
  audioSignal(room, token, data) {
    const actor = this.audioActor(room, token);
    requireThat(actor.audio?.session === data.session, 409, 'Rejoin audio before connecting the call.');
    const target = [room.host, ...this.participants(room)].find(p => p.id === data.to);
    requireThat(target && target !== actor && target.connected && target.audio?.session === data.toSession, 409, 'That audio participant has left or rejoined.');
    const message = data.message;
    const description = message?.description;
    const candidate = message?.candidate;
    const validDescription = description && ['offer', 'answer'].includes(description.type) && typeof description.sdp === 'string' && description.sdp.length <= 16000 && description.sdp.startsWith('v=0');
    const validCandidate = candidate && typeof candidate.candidate === 'string' && candidate.candidate.length <= 2048 && (candidate.sdpMid === null || typeof candidate.sdpMid === 'string' && candidate.sdpMid.length <= 64) && (candidate.sdpMLineIndex === null || Number.isInteger(candidate.sdpMLineIndex) && candidate.sdpMLineIndex >= 0 && candidate.sdpMLineIndex < 16);
    requireThat(Boolean(validDescription) !== Boolean(validCandidate), 400, 'The call connection message is invalid. Rejoin audio.');
    if (this.now() - actor.audio.window >= 10000) { actor.audio.window = this.now(); actor.audio.count = 0; }
    requireThat(++actor.audio.count <= 120, 429, 'Too many call connection messages. Wait a moment and rejoin audio.');
    // Only selected fields reach the recipient; never broadcast SDP/candidates in snapshots.
    const clean = validDescription ? { description: { type: description.type, sdp: description.sdp } }
      : { candidate: { candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex } };
    return { targetToken: target.token, signal: { from: actor.id, session: actor.audio.session, toSession: target.audio.session, message: clean } };
  }
  view(room, token) {
    const actor = this.actor(room, token);
    const self = { id: actor.id, alias: actor.alias, role: actor.role, ready: Boolean(actor.ready), moment: Boolean(actor.moment), paused: Boolean(actor.paused) };
    const base = { roomId: room.id, revision: room.revision, expiresAt: room.expiresAt, self, hostConnected: room.host.connected };
    // Waiting users do not receive the group's aliases, roles, or invitation secret.
    if (actor !== room.host && !actor.role) return { ...base, phase: 'waiting', members: [] };
    return {
      ...base, phase: room.phase, attempt: room.attempt, notice: room.notice,
      audio: [room.host, ...this.participants(room)].filter(p => p.connected && p.audio).map(p => ({ id: p.id, alias: p.alias, role: p.role, session: p.audio.session, muted: p.audio.muted })),
      members: this.participants(room).map(p => ({ id: p.id, alias: p.alias, role: p.role, connected: p.connected, ready: p.ready, moment: p.moment, paused: p.paused })),
      ...(actor === room.host ? { invite: room.invite, waiting: [...room.members.values()].filter(p => !p.role).map(p => ({ id: p.id, alias: p.alias, connected: p.connected })) } : {})
    };
  }
  command(room, token, data) {
    const actor = this.actor(room, token);
    const isHost = actor === room.host;
    const { action } = data;
    if (action === 'end') {
      requireThat(isHost, 403, 'Only the host can end the whole room. You can leave at any time.');
      this.close(room, 'The host ended this room.'); return { ended: true };
    }
    if (action === 'leave') {
      requireThat(!isHost, 400, 'Use End room to close a hosted session.');
      room.members.delete(token);
      if (actor.role) this.pauseRoom(room, `${actor.alias} left. The host can arrange a new pair or end the room.`);
      this.emit('remove', room, token, 'You left the room.'); this.changed(room);
      return { left: true };
    }
    requireThat(actor.connected, 409, 'The live room is disconnected. Reconnect before continuing.');
    actor.lastSeen = this.now();
    if (action === 'admit' || action === 'decline' || action === 'remove') {
      requireThat(isHost, 403, 'Only the host can admit participants or assign roles.');
      const candidate = [...room.members.values()].find(p => p.id === data.memberId);
      requireThat(candidate, 409, 'That participant is no longer in this room.');
      if (action === 'remove') {
        requireThat(candidate.role && !candidate.connected && room.phase !== 'active', 409, 'Only a disconnected seat in a paused or preparing room can be released.');
        room.members.delete(candidate.token);
        this.pauseRoom(room, 'A disconnected seat was released. The host can admit a replacement.');
        this.emit('remove', room, candidate.token, 'The host released your disconnected seat. Ask for a new invitation.');
      } else if (action === 'decline') {
        requireThat(!candidate.role, 409, 'An admitted participant is not a waiting request.');
        room.members.delete(candidate.token);
        this.emit('remove', room, candidate.token, 'The host declined this request. Ask them about another session.');
      } else {
        requireThat(!candidate.role, 409, 'That person already has a role.');
        requireThat(['customer', 'cashier'].includes(data.role), 400, 'Choose customer or cashier.');
        requireThat(room.phase !== 'active', 409, 'Pause before changing the pair.');
        requireThat(candidate.connected, 409, 'This person is disconnected. Wait for them to reconnect.');
        requireThat(!this.participants(room).some(p => p.role === data.role), 409, 'That role is already occupied.');
        candidate.role = data.role;
        this.resetReadiness(room);
        room.notice = 'Read your role. Both participants choose Ready when they want to begin.';
      }
    } else if (action === 'start') {
      requireThat(isHost, 403, 'Only the host can start or resume the room.');
      requireThat(['prepare', 'paused'].includes(room.phase), 409, 'This attempt is already running.');
      const pair = this.participants(room);
      requireThat(pair.length === 2 && pair.every(p => p.connected && p.ready && !p.moment && !p.paused), 409, 'Both participants must be connected, clear their own time requests, and choose Ready.');
      room.phase = 'active'; room.notice = 'Take the time you need. The cashier responds to what they hear.';
    } else {
      requireThat(isHost || actor.role, 403, 'Wait for the host to admit you before using rehearsal controls.');
      if (action === 'ready') {
        requireThat(!isHost && typeof data.value === 'boolean', 400, 'Only a participant sets their own readiness.');
        requireThat(['prepare', 'paused'].includes(room.phase), 409, 'Readiness is set before starting or resuming.');
        requireThat(!actor.moment, 409, 'Clear your own time request before choosing Ready.');
        actor.ready = data.value;
        if (data.value) actor.paused = false;
      } else if (action === 'moment') {
        requireThat(!isHost && typeof data.value === 'boolean', 400, 'Participants control their own time request.');
        requireThat(data.value ? ['active', 'paused'].includes(room.phase) : true, 409, 'Start the conversation before requesting time.');
        actor.moment = data.value;
      } else if (action === 'pause') {
        requireThat(['active', 'paused'].includes(room.phase), 409, 'There is no active conversation to pause.');
        if (!isHost) actor.paused = true;
        this.pauseRoom(room, 'The conversation is paused. Both participants choose Ready again before the host resumes.');
      } else if (action === 'retry') {
        requireThat(['active', 'paused'].includes(room.phase), 409, 'Start the conversation before requesting a retry.');
        requireThat(room.host.connected && this.participants(room).length === 2 && this.participants(room).every(p => p.connected), 409, 'Wait until the host and both participants are connected.');
        room.phase = 'prepare'; room.attempt += 1; this.resetReadiness(room);
        // Time requests belong to their owners: retry must not clear another person's.
        room.notice = 'A new attempt was requested. Clear your own time request if needed, then choose Ready.';
      } else throw new RoomError(400, 'Unknown action. Refresh the room and try again.');
    }
    this.changed(room);
    return { state: this.view(room, token) };
  }
  close(room, notice) {
    if (!this.rooms.has(room.id)) return;
    room.phase = 'ended'; room.notice = notice;
    this.changed(room); this.emit('closeRoom', room);
    this.rooms.delete(room.id); room.members.clear(); room.invite = ''; room.host.token = '';
  }
  sweep() {
    for (const room of this.rooms.values()) {
      if (this.now() >= room.expiresAt) { this.close(room, 'This room expired after one hour.'); continue; }
      for (const actor of [room.host, ...room.members.values()]) {
        if (actor.connected && this.now() - actor.lastSeen > this.leaseMs) {
          this.connect(room, actor.token, false);
          this.emit('leaseExpired', room, actor.token);
        }
      }
    }
  }
}
