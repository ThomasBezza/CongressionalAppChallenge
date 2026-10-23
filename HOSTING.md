# Hosting

The demo runs at https://rehearsal-demo.onrender.com/ using one Render Free Node service.

## Configuration

Use Node.js 24 (`.node-version` pins the tested version), branch `main`, build command
`node --test`, start command `node server.mjs --hosted`, health path `/healthz` and
manual deployments. `render.yaml` contains the equivalent service configuration.

Set `HOST_SETUP_KEY` privately in the service environment to 32–128 base64 characters.
Use the provider’s secret generator. Never commit or publish its value. The host enters
it on the app home screen; it is remembered in that tab’s session storage. Share only
the generated participant invitation. Participants do not need the host key.

The server uses Render’s `PORT` and `RENDER_EXTERNAL_URL` and permits its exact hostname.
Render terminates HTTPS. Local mode binds only to 127.0.0.1:8787 by default.

## Limits

All room state is temporary and held in one process. End, expiry, restart, redeployment
or free-service sleep removes rooms. Create a new room after an old invitation expires.
Do not scale to multiple instances without changing the state design. No database,
recording or persistent conversation storage is used.

## Verification

`GET /healthz` should return 200. Room creation without a host key should return 403.
Private source and project paths should return 404. The optional runner
`node scripts/check-hosted.mjs https://rehearsal-demo.onrender.com` uses the environment
variable `HOST_SETUP_KEY` to create synthetic participants, check the shared workflow,
and end the room. Enter the key privately; never put it in command arguments or logs.

See [VOICE.md](VOICE.md) for optional relay configuration and [DEMO.md](DEMO.md) for a
manual walkthrough.
