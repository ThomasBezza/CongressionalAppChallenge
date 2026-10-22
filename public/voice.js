// Three-person audio mesh. Rehearsal state and microphone ownership stay separate.
// Media elements live outside the room renderer so a time request cannot cut audio.
export class VoiceCall {
  constructor({ send, changed, mediaDevices = globalThis.navigator?.mediaDevices,
    PeerConnection = globalThis.RTCPeerConnection, makeAudio = () => document.createElement('audio'),
    mount = audio => document.getElementById('remote-audio').append(audio), newSession = () => crypto.randomUUID() }) {
    Object.assign(this, { send, changed, mediaDevices, PeerConnection, makeAudio, mount, newSession });
    this.peers = new Map(); this.retired = new Set(); this.epoch = 0;
    this.stream = null; this.session = null; this.room = null; this.access = null;
    this.busy = false; this.muted = true; this.message = ''; this.relay = false; this.blocked = false;
  }
  sync(room, online, access) {
    if (room && this.room?.roomId === room.roomId && this.room.revision > room.revision) room = this.room;
    const eligible = online && room?.self.role && room.phase !== 'ended';
    if (!eligible || this.room && this.room.roomId !== room?.roomId) {
      this.leave(this.stream || this.busy ? 'Audio left. Join again when the room is connected.' : '', true);
    }
    this.room = eligible ? room : null; this.access = eligible ? { ...access } : null;
    const own = room?.audio?.find(p => p.id === room.self.id);
    if (this.stream && this.registered && own?.session !== this.session) this.leave('Audio connection ended. Join again when you are ready.');
    if (this.session && own?.session === this.session) this.registered = true;
    if (eligible && own && this.retired.has(own.session) && !this.cleaning) {
      this.cleaning = true;
      this.send(this.access, 'audio', { action: 'leave', session: own.session }).catch(() => {}).finally(() => { this.cleaning = false; });
    }
    if (!eligible || !this.stream || !this.session || own?.session !== this.session) { this.changed(); return; }
    const others = room.audio.filter(p => p.id !== room.self.id);
    for (const [id, peer] of this.peers) if (!others.some(p => p.id === id && p.session === peer.remote.session)) this.drop(id);
    for (const remote of others) if (!this.peers.has(remote.id)) {
      const peer = this.peer(remote);
      // Only one side offers. Mute changes track.enabled and needs no renegotiation.
      if (room.self.id < remote.id) this.queue(peer, async () => {
        await peer.pc.setLocalDescription(await peer.pc.createOffer());
        await this.signal(peer, { description: peer.pc.localDescription.toJSON() });
      });
    }
    this.changed();
  }
  async join() {
    if (this.busy || this.stream || !this.room) return;
    if (!this.mediaDevices?.getUserMedia || !this.PeerConnection) {
      this.message = 'This browser cannot open audio here. Use Safari or Chrome over HTTPS.'; this.changed(); return;
    }
    const epoch = ++this.epoch, access = { ...this.access };
    this.busy = true; this.message = 'Allow microphone access to join. You will start muted.'; this.changed();
    let captured;
    try {
      // This runs only in response to Join audio, never on admission or readiness.
      captured = await this.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      for (const track of captured.getTracks()) track.enabled = false;
      if (epoch !== this.epoch) { captured.getTracks().forEach(t => t.stop()); return; }
      const config = await this.send(access, 'audio-config');
      if (epoch !== this.epoch) { captured.getTracks().forEach(t => t.stop()); return; }
      this.stream = captured; this.config = { iceServers: config.iceServers }; this.relay = config.relay;
      this.session = this.newSession(); this.muted = true;
      for (const track of captured.getAudioTracks()) track.onended = () => this.leave('Microphone stopped. Join audio again when you are ready.');
      const session = this.session;
      const result = await this.send(access, 'audio', { action: 'join', session });
      if (epoch !== this.epoch) {
        this.send(access, 'audio', { action: 'leave', session }).catch(() => {}); return;
      }
      this.message = ''; this.sync(result.state, true, access);
    } catch (error) {
      captured?.getTracks().forEach(t => t.stop());
      if (epoch !== this.epoch) return;
      this.leave('', true);
      this.message = error.name === 'NotAllowedError' ? 'Microphone access was not allowed. Enable it in your browser’s site settings, then try Join audio again.'
        : error.name === 'NotFoundError' ? 'No microphone was found. Connect one and try again.'
          : error.name === 'NotReadableError' ? 'The microphone is busy. Leave Meet or another call, then try again.'
            : error.message || 'Audio could not start. Try joining again.';
    } finally { if (epoch === this.epoch) this.busy = false; this.changed(); }
  }
  peer(remote) {
    const pc = new this.PeerConnection(this.config);
    const audio = this.makeAudio(); audio.autoplay = true; audio.setAttribute('playsinline', '');
    this.mount(audio);
    const peer = { remote, pc, audio, chain: Promise.resolve(), candidates: [], session: this.session, access: { ...this.access } };
    this.peers.set(remote.id, peer);
    for (const track of this.stream.getAudioTracks()) pc.addTrack(track, this.stream);
    pc.onicecandidate = event => { if (event.candidate) this.signal(peer, { candidate: event.candidate.toJSON() }).catch(() => this.peerError(peer)); };
    pc.ontrack = event => { audio.srcObject = event.streams[0]; this.play(peer); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.peerError(peer);
      this.changed();
    };
    peer.timer = setTimeout(() => { if (pc.connectionState !== 'connected') { this.peerError(peer); this.changed(); } }, 20000);
    return peer;
  }
  current(peer) { return this.session === peer.session && this.peers.get(peer.remote.id) === peer; }
  async signal(peer, message) {
    if (!this.current(peer)) return;
    await this.send(peer.access, 'audio-signal', { session: peer.session, to: peer.remote.id, toSession: peer.remote.session, message });
  }
  queue(peer, operation) {
    peer.chain = peer.chain.then(() => this.current(peer) && operation()).catch(() => this.peerError(peer));
    return peer.chain;
  }
  receive(signal) {
    if (!this.stream || signal.toSession !== this.session) return;
    const remote = this.room?.audio?.find(p => p.id === signal.from && p.session === signal.session);
    if (!remote) return;
    const peer = this.peers.get(remote.id) || this.peer(remote);
    this.queue(peer, async () => {
      if (signal.message.description) {
        await peer.pc.setRemoteDescription(signal.message.description);
        for (const candidate of peer.candidates.splice(0)) await peer.pc.addIceCandidate(candidate);
        if (signal.message.description.type === 'offer') {
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          await this.signal(peer, { description: peer.pc.localDescription.toJSON() });
        }
      } else if (signal.message.candidate) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(signal.message.candidate);
        else if (peer.candidates.length < 100) peer.candidates.push(signal.message.candidate);
      }
    });
  }
  peerError(peer) {
    if (!this.current(peer)) return;
    peer.failed = true;
    this.message = 'A call connection failed. Leave audio and rejoin. If it still fails, a network relay may be needed.';
    this.changed();
  }
  async play(peer) {
    try { await peer.audio.play(); }
    catch { if (this.current(peer)) { this.blocked = true; this.changed(); } }
  }
  async enablePlayback() {
    this.blocked = false;
    await Promise.all([...this.peers.values()].map(peer => this.play(peer))); this.changed();
  }
  async toggleMute() {
    if (!this.stream || this.busy) return;
    const stream = this.stream, session = this.session, access = { ...this.access }, epoch = this.epoch;
    const muted = !this.muted; this.busy = true;
    // Muting is immediate; unmuting waits for the acknowledged room update.
    if (muted) { stream.getAudioTracks().forEach(t => { t.enabled = false; }); this.muted = true; }
    this.changed();
    try {
      await this.send(access, 'audio', { action: 'mute', session, muted });
      if (this.stream === stream && this.session === session) {
        stream.getAudioTracks().forEach(t => { t.enabled = !muted; }); this.muted = muted; this.message = '';
      }
    } catch {
      stream.getAudioTracks().forEach(t => { t.enabled = false; });
      if (this.stream === stream) { this.message = 'Microphone status could not update. Your microphone stays off until you rejoin audio.'; this.muted = true; }
    }
    finally { if (epoch === this.epoch) this.busy = false; this.changed(); }
  }
  drop(id) {
    const peer = this.peers.get(id); if (!peer) return;
    this.peers.delete(id); clearTimeout(peer.timer); peer.pc.onicecandidate = null; peer.pc.ontrack = null; peer.pc.onconnectionstatechange = null;
    peer.pc.close(); peer.audio.srcObject = null; peer.audio.remove();
  }
  leave(message = '', notify = true) {
    const session = this.session, access = this.access;
    this.epoch++; this.session = null; this.registered = false; this.busy = false; this.muted = true; this.blocked = false;
    const stream = this.stream; this.stream = null;
    stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    for (const id of [...this.peers.keys()]) this.drop(id);
    if (session) {
      this.retired.add(session);
      if (this.retired.size > 20) this.retired.delete(this.retired.values().next().value);
      if (notify && access) this.send(access, 'audio', { action: 'leave', session }).catch(() => {});
    }
    this.message = message; this.changed();
  }
}
