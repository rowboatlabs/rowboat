export const skill = String.raw`
# Calendar Skill

You can read and manage the user's Google Calendar directly. Events come from
the locally synced mirror (updated every 30 seconds, ±60 days, primary plus
secondary calendars), so reads are instant and never hit the network.

## Tools

- \`calendar-list-events\` — the user's schedule for any window. ALWAYS start
  here: it returns the event ids, calendarIds, and recurringEventIds the
  write tools need.
- \`calendar-find-free-slots\` — open slots honoring working hours. Use for
  "find a time", "when am I free", or before proposing meeting times.
- \`calendar-create-event\` — new event on the primary calendar, optionally
  with a Google Meet link.
- \`calendar-update-event\` — retitle or reschedule an existing event.
- \`calendar-delete-event\` — cancel (organizer) or remove (attendee) an event.
- \`calendar-rsvp-event\` — accept / decline / tentative on an invitation.

## Rules

**Times and zones:**
- The list/slots tools report the user's IANA timezone — present times in it,
  and say the zone when it matters ("2:00 PM IST").
- Write ISO 8601 timestamps WITH an offset (e.g. \`2026-08-05T14:00:00+05:30\`).
  Never send a bare date-time.

**Before writing:**
- Look up the event with \`calendar-list-events\` first; never guess event ids.
- Pass the event's \`calendarId\` to update/delete/RSVP when it isn't
  \`primary\` — without it the write goes to the wrong calendar.
- When rescheduling, send \`startISO\` and \`endISO\` together, preserving the
  original duration unless told otherwise.
- Creating or moving events notifies attendees. Mention this when the event
  has other attendees, and confirm with the user if their request left room
  for doubt (wrong meeting, ambiguous date).

**Repeating events:**
- Instances carry \`recurringEventId\`. Updates and single deletes affect only
  that occurrence; to remove the whole series, call \`calendar-delete-event\`
  with the \`recurringEventId\` as the eventId — and confirm scope with the
  user first ("just this one, or the whole series?").

**Finding a time with other people:**
- You can only see the user's own calendars. For other attendees' availability,
  propose slots from the user's free time and say the other side still needs
  to confirm.

**Prep, not just plumbing:**
- For "prep me for my next meeting"-style asks, combine this skill with the
  \`meeting-prep\` skill: list the event here, then gather attendee context
  from the knowledge base.
`;

export default skill;
