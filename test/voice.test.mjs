import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceCall } from '../public/voice.js';
import { iceProvider } from '../app/voice-config.mjs';

// Fake media/peers test lifecycle and negotiation messages, not real sound or Safari.
function fixture({ mediaDevices, send } = {}) {
  const track = { enabled: true, stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const session = '11111111-1111-4111-8111-111111111111';
  const room = { roomId: 'test-room', revision: 1, phase: 'prepare', self: { id: 'a', role: 'customer' }, audio: [] };
  const messages = [];
  class Peer {
    connectionState = 'new'; remoteDescription = null;
    addTrack() {}
    async createOffer() { return { type: 'offer', sdp: 'v=0' }; }
    async createAnswer() { return { type: 'answer', sdp: 'v=0' }; }
    async setLocalDescription(value) { this.localDescription = { ...value, toJSON: () => value }; }
    async setRemoteDescription(value) { this.remoteDescription = value; }
    async addIceCandidate() {}
    close() { this.connectionState = 'closed'; }
  }
  const call = new VoiceCall({ changed: () => {}, newSession: () => session,
    mediaDevices: mediaDevices || { getUserMedia: async () => stream }, PeerConnection: Peer,
    makeAudio: () => ({ setAttribute() {}, play: async () => {}, remove() {} }), mount: () => {},
    send: send || (async (access, endpoint, data) => {
      messages.push({ endpoint, data });
      if (endpoint === 'audio-config') return { iceServers: [], relay: false };
      if (data?.action === 'join') return { state: { ...room, revision: 2, audio: [{ id: 'a', session, muted: true }] } };
      return { ok: true };
    })
  });
  call.sync(room, true, { roomId: room.roomId, token: 'synthetic-role' });
  return { call, track, stream, room, session, messages };
}

test('joining is explicit, starts muted, own mute works and end stops capture', async () => {
  const f = fixture(); assert.equal(f.track.enabled, true); assert.equal(f.call.stream, null);
  await f.call.join(); assert.equal(f.track.enabled, false); assert.equal(f.call.muted, true);
  await f.call.toggleMute(); assert.equal(f.track.enabled, true);
  await f.call.toggleMute(); assert.equal(f.track.enabled, false);
  f.call.sync({ ...f.room, revision: 3, phase: 'ended' }, false, null);
  assert.equal(f.track.stopped, true); assert.equal(f.call.stream, null);
});

test('cancelling while the permission prompt is pending stops late media and never registers audio', async () => {
  let resolve;
  const f = fixture({ mediaDevices: { getUserMedia: () => new Promise(r => { resolve = r; }) } });
  const pending = f.call.join(); f.call.leave(); resolve(f.stream); await pending;
  assert.equal(f.track.stopped, true); assert.equal(f.call.session, null);
  assert.equal(f.messages.length, 0);
});

test('permission denial gives a recoverable message without joining; a mute failure keeps mic off', async () => {
  const denied = fixture({ mediaDevices: { getUserMedia: async () => { const error = new Error(); error.name = 'NotAllowedError'; throw error; } } });
  await denied.call.join(); assert.match(denied.call.message, /site settings/); assert.equal(denied.messages.length, 0);
  const f = fixture(); await f.call.join(); await f.call.toggleMute();
  f.call.send = async () => { throw new Error('offline'); };
  await f.call.toggleMute(); assert.equal(f.track.enabled, false); assert.equal(f.call.muted, true);
  f.call.leave(); assert.equal(f.track.stopped, true);
});

test('three-role mesh targets each peer session; rehearsal updates preserve existing peers', async () => {
  const f = fixture(); await f.call.join();
  const audio = [{ id: 'a', session: f.session }, { id: 'b', session: 'remote-b' }, { id: 'host', session: 'remote-host' }];
  f.call.sync({ ...f.room, revision: 3, phase: 'active', audio }, true, f.call.access);
  await Promise.all([...f.call.peers.values()].map(p => p.chain));
  assert.equal(f.call.peers.size, 2);
  assert.deepEqual(f.messages.filter(m => m.endpoint === 'audio-signal').map(m => m.data.to).sort(), ['b', 'host']);
  const first = f.call.peers.get('b');
  f.call.sync({ ...f.room, revision: 4, phase: 'paused', audio }, true, f.call.access);
  assert.equal(f.call.peers.get('b'), first); assert.equal(f.track.stopped, false);
  f.call.receive({ from: 'b', session: 'stale-b', toSession: f.session, message: { description: { type: 'offer', sdp: 'v=0' } } });
  assert.equal(first.pc.remoteDescription, null);
  f.call.sync(null, false, null); assert.equal(first.pc.connectionState, 'closed'); assert.equal(f.track.stopped, true);
});

test('TURN provider keeps long-lived token server-side and passes only allowed short-lived credentials', async () => {
  const env = { TURN_KEY_ID: 'a'.repeat(32), TURN_KEY_API_TOKEN: 'synthetic-server-secret' };
  let request;
  const provider = iceProvider(env, async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ iceServers: [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'https://untrusted.invalid'], username: 'temporary-user', credential: 'temporary-secret', ignored: env.TURN_KEY_API_TOKEN }] }) };
  });
  const config = await provider();
  assert.equal(config.relay, true); assert.equal(JSON.stringify(config).includes(env.TURN_KEY_API_TOKEN), false);
  assert.equal(config.iceServers[0].urls.length, 1);
  assert.equal(JSON.parse(request.options.body).ttl, 3600);
  assert.equal(request.options.headers.Authorization, `Bearer ${env.TURN_KEY_API_TOKEN}`);
  assert.equal((await iceProvider({})()).relay, false);
  assert.throws(() => iceProvider({ TURN_KEY_ID: 'a'.repeat(32) }));
});

test('a cancelled old permission request cannot unlock a newer pending audio join', async () => {
  const resolvers = [];
  const f = fixture({ mediaDevices: { getUserMedia: () => new Promise(resolve => resolvers.push(resolve)) } });
  const old = f.call.join(); f.call.leave();
  const current = f.call.join(); assert.equal(f.call.busy, true);
  resolvers[0](f.stream); await old;
  assert.equal(f.call.busy, true);
  const secondTrack = { enabled: true, stop() {} };
  resolvers[1]({ getTracks: () => [secondTrack], getAudioTracks: () => [secondTrack] });
  await current; assert.equal(f.call.busy, false); f.call.leave();
});

test('blocked playback is recoverable by explicit play and leaving removes media elements', async () => {
  const f = fixture(); await f.call.join();
  const audio = [{ id: 'a', session: f.session }, { id: 'b', session: 'remote-b' }];
  f.call.sync({ ...f.room, revision: 3, audio }, true, f.call.access);
  const peer = f.call.peers.get('b'); await peer.chain;
  let removed = false;
  peer.audio.play = async () => { throw new Error('autoplay blocked'); };
  peer.audio.remove = () => { removed = true; };
  await f.call.play(peer); assert.equal(f.call.blocked, true);
  peer.audio.play = async () => {};
  await f.call.enablePlayback(); assert.equal(f.call.blocked, false);
  f.call.leave(); assert.equal(removed, true); assert.equal(peer.audio.srcObject, null);
});
