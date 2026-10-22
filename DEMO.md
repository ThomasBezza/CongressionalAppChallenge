# Repeatable phone demo

Stable service: https://rehearsal-demo.onrender.com/

The hosted workflow passed with three developer-controlled browser tabs. The owner also
repeated iPhone/Safari entry, readiness, a time request received by the Mac, and room
ending on this host. The earlier phone-to-Mac Meet coexistence check used the temporary
tunnel; audio was not repeated during this hosted check. Old tunnel links expired.

## Built-in voice preview — current development

Owner selected audio inside the app for all three roles. Use [VOICE.md](VOICE.md) for
the new microphone/call workflow and verification limits. Leave Meet before testing
native audio. Owner-operated native sound now passed sequentially in both directions between an
iPhone13Pro/Safari Customer and Mac Cashier. A time request survived mic changes, and
room ending stopped sound/mic indicators on both. Host stayed outside audio. No actual
second person or three-voice check. The original separate-call walkthrough below remains a fallback and
a historical record. Do not repeat its baseline merely to prove the new voice code.

## Show the native audio version

1. Create a fresh room, admit the customer and cashier, and let each role optionally
   join audio. All microphones start muted. Use headphones for nearby devices.
2. Both participants tap I’m ready; host starts. Unmute the person speaking. If one
   operator is using nearby devices, keep only one microphone unmuted at a time.
3. Cashier says, “Hi, what would you like?” Customer begins a privately chosen menu
   order, taps Give me a moment, and shows the receiving view. Keep the request visible
   while explaining that mic mute is a separate control; no need to imitate stuttering.
4. Customer taps I’m ready to go on and finishes the order. Cashier reads it back;
   customer confirms or corrects it. Host ends the room. Confirm audio stops.

Owner completed this short scene on October22 and reported “Completed without
confusion.” Codex observed admission, readiness, start and ending; the order/readback
and request/clear completion are owner-reported. This was a one-operator technical check, not independent user research.

Label a one-operator walkthrough as a technical demonstration. The completed device
check supports functional claims; it does not show independent teen use or improvement
in stuttering. Cold-start and long-lock checks are deferred, not recording gates.

## Optional ticket walkthrough

1. Start a café scene as above. The customer keeps their
   intended order private. Cashier chooses what they heard on the order ticket; leaving
   a detail unanswered is allowed. Nothing reaches the customer before sharing.
2. Cashier selects Share ticket. Customer chooses Review ticket or Skip review.
   If reviewing, they can select I’d like a change and explain it in the conversation.
3. Cashier edits and shares the revised ticket. Customer opens the new version, then
   can select That’s what I wanted. This is the customer’s confirmation, not a score.
4. Show that the time request remains until its owner clears it and the mic is separate.
   Retry clears the ticket and requires readiness again. End the room when finished.

The cashier now uses paired tap choices; tap a selected choice again to leave it
unanswered. For the focused phone check, toggle the other device’s microphone while
the cashier selects details. During a customer time request, sharing should add a
readable ticket line to the green pinned time-status strip, with no review buttons.
Clear the moment, skip review, then revise: the customer should see the heading "The
cashier updated the ticket" and an outlined Review ticket button, nothing else. Pause/resume
announcements should name the phase explicitly.

Owner-operated iPhone/Mac checks passed for stable choices during mic toggles, reaching
Share, matching receipt/confirmation, quiet customer delivery, skip retained on revision,
and final ticket/microphone cleanup. Owner identified two notice/copy improvements for
later discussion. Rooms were seen paused during the checks; resumption worked, but the
pause cause remains unknown. This was one operator/two devices, not independent peer use.

## Earlier separate-call walkthrough (historical)

### Before a run

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
