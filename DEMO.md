# Repeatable phone demo

Use the stable service URL after its deployment is verified. The old tunnel links expired.
For now the working workflow is verified locally and on the earlier temporary phone preview.

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

- Reconnecting means actions are not confirmed. Wait for live state before sending again.
- After a detected disconnect, the room pauses and both people must become ready again.
- If the server restarted or the hour expired, the old room cannot be reopened. Return
  home, create a fresh room, and replace the participant invitation.
- If a hosting key is rejected, retrieve the current value from Render Environment and
  re-enter it. Keep the secret out of chat and recording.

A successful demo establishes synchronized controls in the tested configuration. It does
not establish reduced stuttering, broad compatibility, or usefulness to unfamiliar teens.
