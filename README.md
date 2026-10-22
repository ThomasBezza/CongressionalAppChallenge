# Rehearsal Room

A phone-first, invite-only ordering-food rehearsal with a host, customer and cashier.
A participant can request time without speaking; the partner and host see the request
until its owner clears it. No claim of clinical effectiveness or validated user demand.

## Run

Use Node.js24. Run `node server.mjs`, then open http://127.0.0.1:8787/.
Run `node --test` for integration, call-lifecycle and static-asset checks. No packages
or build step required.

## Voice preview

All three admitted roles can choose Join audio. Microphones start muted. Each person
controls their own microphone and can leave audio without leaving the rehearsal.
The app does not record or transcribe. Native WebRTC carries audio; Node relays
authenticated setup messages. STUN-only connections may fail on some networks.
Optional short-lived TURN configuration and real-device checks are in [VOICE.md](VOICE.md).
Automated media tests use fakes and do not prove actual sound delivery.

## Hosting and limits

See [HOSTING.md](HOSTING.md), [DEMO.md](DEMO.md) and render.yaml. Hosted mode requires
a private environment host key; participants use a separate invitation.
Rooms live in memory and disappear on end, restart or after one hour.
No recording, transcript, speech score, saved target order, matching or AI partner.

Fonts are self-hosted: Newsreader and Atkinson Hyperlegible Next. Their OFL licenses
are included in public/fonts/. This repository is an app-only deployment snapshot;
private planning, research and conversation history are excluded.
