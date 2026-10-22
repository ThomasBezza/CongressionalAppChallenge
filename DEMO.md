# Repeatable phone demo

Stable service: https://rehearsal-demo.onrender.com/

The hosted workflow passed with three developer-controlled browser tabs. The owner also
repeated iPhone/Safari entry, readiness, a time request received by the Mac, and room
ending on this host. The earlier phone-to-Mac Meet coexistence check used the temporary
tunnel; audio was not repeated during this hosted check. Old tunnel links expired.

## Built-in voice preview — current development

Owner selected audio inside the app for all three roles. Use [VOICE.md](VOICE.md) for
the new microphone/call workflow and verification limits. Leave Meet before testing
native audio. The original separate-call walkthrough below remains a fallback and
a historical record. Do not repeat its baseline merely to prove the new voice code.

## Before a run

1. Open the home page on the Mac. If Render is waking, wait for the real Ordering food
   page before creating a room. Keep automatic deploys off during a session.
2. Enter the private host key to create a room. Keep this host tab open. Share only its
   participant invitation; never screen-record the host-key entry or environment dashboard.
3. Open that invitation in a new Mac tab as Demo Cashier and in iPhone Safari as Demo
   Customer. Admit them to the matching roles. This is synthetic test data and a one-person
   technical demonstration, unless another willing person actually participates.
4. If demonstrating audio, join the same existing Meet call from both devices. The tested
   setup is Mac headphones/Mac mic muted, phone speaker volume zero/phone mic transmitting.
   Check baseline audio before switching the phone to Safari. This setup tests one direction.

## Show the useful action

1. Both participants choose Ready to begin; the host starts.
2. Phone customer chooses Give me a moment. Show the receiving Mac cashier view: the
   named request appears in the fixed controls, including when the menu is scrolled.
3. Clear the request from the phone. The host cannot clear someone else's active request.
4. Optionally pause, ready both again, and resume. Use an actual spoken exchange only
   when a willing second person is present; don't present one operator as two people.
5. Host opens Session options and ends the room. Participants see the ending. Leave the
   separate Meet call on both devices when finished.

## Recovery

- If Session options does not open on a click, tap again or focus it and press Enter.
  One automation click failed; the issue has not been reproduced reliably.
- Reconnecting means actions are not confirmed. Wait for live state before sending again.
- After a detected disconnect, the room pauses and both people must become ready again.
- If the server restarted or the hour expired, the old room cannot be reopened. The host
  view tells you to return home and create a new room; participants are told to ask for a
  fresh invitation. After refreshing a stale tab, the app explains both options because
  its previous role may no longer be known.
- If a hosting key is rejected, retrieve the current value from Render Environment and
  re-enter it. Keep the secret out of chat and recording.

A successful demo establishes synchronized controls in the tested configuration. It does
not establish reduced stuttering, broad compatibility, or usefulness to unfamiliar teens.

## Explain the implementation in your own words

- A button sends a JSON action and role credential. Node checks authority and room phase,
  changes the room, then streams the permitted state to each role. The browser displays
  confirmed state; it does not decide who is ready or clear another person's request.
- The stable HTTPS address reaches one hosted Node process. Render handles TLS; Node
  validates the canonical hostname. The creation key and participant credentials have
  different jobs, so participants never need the private creation key.
- Server memory keeps the first version simple, but a restart loses all rooms. Waking
  the service and creating a fresh invitation make the demonstration repeatable.

## Before recording: open checks

Cold-start timing on the free host, longer screen lock, and Meet audio on this hosted
address still need checks; no measured wake time is available. Earlier audio worked
on the temporary tunnel only. A controlled local restart test now verifies the recovery
messages, but it is not a free-service sleep/wake measurement.

If a willing second person is available, demonstrate a short real food-order exchange
and the listener waiting after a time request. Otherwise, explain the intended situation
and label the video a technical demonstration. Do not present a single operator as two
people or claim that the app improves stuttering.
