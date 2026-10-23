# Rehearsal Room

Practice an everyday conversation with a willing partner and a host. A participant can
ask for time without speaking; the partner and host see the request until its owner
clears it. Built-in voice is optional. Nothing is recorded or transcribed.

[Open the app](https://rehearsal-demo.onrender.com/)

## Run locally

Install Node.js 24, then run `node server.mjs` and open http://127.0.0.1:8787/.
Run `node --test` for the integration and audio lifecycle checks. No packages or build
step are required. `./dev` and `./dev --test` are convenience equivalents.

## Rehearsal scenes

- Order a drink at Noble Coffee & Tea, 933 Logan St., Noblesville.
- Ask about bowling at Pinheads, 13825 Britton Park Rd., Fishers.

Venue names and addresses are real. [Noble’s menu](https://www.toasttab.com/noblecoffee)
and [Pinheads’ venue page](https://bowlatpinheads.com/fishers/) supplied the reference
facts, checked October 23, 2026. The app labels simplified menu choices and simulated
reservation availability. It sends no order, call or booking and has no affiliation
with either business.

## How it works

The host chooses a scene, creates a room and shares an invitation. Participants join
with aliases; the host admits them and assigns roles. Both choose readiness before the
host starts. Either participant can request time, pause, retry or leave. The listener
can share an optional order ticket or reservation slip for confirmation or correction.
Intent stays private; nothing is scored. The scene stays fixed through retries.

Each admitted person can join audio, starting muted, and controls their own microphone.
Time requests do not mute anyone. Leaving audio stops capture. Room loss or ending
also stops capture; rejoining requires an explicit action.

## Structure

- `server.mjs`: HTTP endpoints, event streams, hosted access and static files.
- `app/rooms.mjs`: temporary room state, permissions and rehearsal rules.
- `app/voice-config.mjs`: direct connection and optional relay configuration.
- `public/`: interface, shared scene content, styling, audio client and fonts.
- `test/`: room, privacy, recovery and audio lifecycle checks.
- `scripts/check-hosted.mjs`: optional synthetic hosted workflow check.

## Deployment and limits

See [HOSTING.md](HOSTING.md), [VOICE.md](VOICE.md) and [DEMO.md](DEMO.md).
Hosted room creation requires a private environment key; participants use invitations.
Rooms live in memory for up to one hour and disappear on end or server restart.
Free hosting can sleep. Direct audio connections may fail on networks requiring a relay.
Automated media tests use fakes and do not establish sound delivery on every device.

The app does not find partners or provide treatment. Self-hosted Newsreader and
Atkinson Hyperlegible Next fonts include their required OFL notices in `public/fonts/`.
