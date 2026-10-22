# Built-in room audio preview

Host, customer and cashier can explicitly join an audio-only WebRTC call. Waiting
participants cannot receive its roster or signaling. No video, recording or transcript.

## Use

1. Leave Meet or any other call first so its microphone does not compete with this one.
2. Create/join a rehearsal room. The host admits the pair normally.
3. Each person chooses **Join audio** and allows microphone access. Everyone starts muted.
4. Tap the round **Muted** microphone control (or **Unmute** in the audio card) to speak. Use headphones when devices are near each other.
5. **Leave audio** stops capture without leaving the rehearsal. Leaving/ending the room
   or losing its live connection also stops capture. Rejoining audio is explicit.

The host can join as a third voice; readiness still belongs to the two participants.
Time requests and rehearsal pauses leave microphone choices with each person. They do
not mute others. If Safari blocks playback, choose **Tap to hear the room**. If a connection
fails, leave audio/rejoin. Avoid duplicated tabs for the same role's call.

## Connectivity and relay setup

With no extra configuration, browsers use Cloudflare's public STUN service for direct
connections. Some networks require TURN relay; STUN-only success is not guaranteed.
The preview labels direct mode. It must be tested on actual devices before claiming audio
works. The automated media tests use fakes and do not prove sound delivery.

Optional Cloudflare TURN support is implemented. After the owner chooses and creates a
TURN key, set **TURN_KEY_ID** and **TURN_KEY_API_TOKEN** privately in Render Environment;
set both or neither, then deploy. Never paste these values into chat, source or a video.
No new account, billing agreement or relay service has been enabled by Codex. Check the
provider's current billing/account conditions before enabling it; no paid budget assumed.

Only connected admitted roles can request ICE configuration. Node uses the server-side
key to mint a cached per-role credential lasting at most 3600 seconds. Only the resulting
short-lived client credentials are returned; the long-lived key never reaches the page.
A provider failure gives a fixed retry message without logging provider bodies/tokens.

## Data flow and limits

Audio goes between browsers, directly or through TURN. Render relays only call setup
messages over the existing authenticated HTTP/event streams. SDP and ICE candidates
are forwarded only to their intended admitted recipient and are not put into room
snapshots or logs. They include connection metadata; the app cannot promise peers or
network providers see no network addresses. No audio reaches the Node server.

Each client has at most two peer connections. A session identifier distinguishes a new
call from stale offers/candidates; it is not a substitute for role authentication. Setup
messages are bounded by size and rate. A role cannot open concurrent audio sessions in
duplicate tabs. Media elements are outside the room renderer so menu/state updates do
not replace playback. Disconnect/expiry/end releases call membership and local capture.

Owner-operated two-device verification on October22 passed native audio from iPhone
Safari to Mac headphones and the reverse path to the phone speaker. A time request
stayed visible through mic changes; room ending stopped audio and mic indicators on
both. This was one person, sequential directions, not a real peer conversation. Three
simultaneous voices, TURN/network reachability, broader Safari behavior and interruption
recovery still need verification.
The old Meet coexistence check establishes only that earlier separate-call setup.

## Sources checked October 22, 2026

- [WebRTC peer connections and signaling](https://webrtc.org/getting-started/peer-connections)
- [Why TURN is needed](https://webrtc.org/getting-started/turn-server)
- [Microphone permissions and HTTPS](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [Playback can require a user gesture](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play)
- [Cloudflare short-lived credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
- [Cloudflare TURN pricing/FAQ](https://developers.cloudflare.com/realtime/turn/faq/)
