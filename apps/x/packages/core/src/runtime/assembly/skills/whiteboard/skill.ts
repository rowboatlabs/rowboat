// The whiteboard skill (2026-09-12). Short on purpose, like the spaces skill:
// the two tools carry their own schemas, so this only has to give the mental
// model, map asks to operations, and state the drawing rules a tool
// description cannot.

const skill = `
# Whiteboards

A whiteboard is a shared drawing board inside a space — the "Board" button in
a space's header. Boards are files under \`whiteboards/\` (the default one is
\`whiteboards/board.excalidraw\`); a space can have several, each with a name.
Everyone with a board open sees your drawing appear live, attributed to your
person.

You never touch the file format. Two tools do everything:

| You need | Call |
|---|---|
| what is on a board, its ids and layout | \`whiteboard-read\` (omit \`board\` for the default one) |
| which boards a space has | \`whiteboard-read\` with a board name that does not exist — the error lists them |
| draw, label, connect, move, restyle, delete | \`whiteboard-draw\` with a list of \`ops\` |
| the spaceId for a space named in the ask | \`list_spaces\` — unless the context already gives it (a board picked from the @ menu, or the board open in Spaces) |

## Drawing

Think in elements, not pixels. Every op is one of:

- \`add\` — a \`rectangle\` / \`ellipse\` / \`diamond\` with a \`text\` label
  (the box sizes itself to the label), or free-standing \`text\`. Give it an
  \`id\` ("start", "db") so the ops that follow can point at it.
- \`connect\` — an arrow \`from\` one id \`to\` another, optional \`label\`.
  \`kind: "line"\` for a plain line.
- \`update\` — new \`text\`, \`x\`/\`y\`, \`width\`/\`height\`, or \`style\` on an
  existing id. Labels re-fit; arrows follow the box.
- \`delete\` — remove an element (its label and arrow bindings go with it).

Placement: put the first element with \`x\`/\`y\` (or let it flow to the right
of existing content), then place the rest **relative to it** — \`rightOf\`,
\`below\`, \`leftOf\`, \`above\` — which aligns centers and leaves arrow room.
Flowcharts read left→right or top→bottom; pick one and keep it. Only reach
for explicit coordinates when the layout is not a chain or a grid.

Style is optional and calm by default (black outline, no fill). Use fills
sparingly to mean something — \`fill: "blue"\` for one lane, \`"yellow"\` for a
note — from the named palette, so the board stays coherent. Keep labels
short: a box is a noun phrase, an arrow label is a verb.

A flow in one call:

\`\`\`
ops: [
  { op: "add", id: "signup", shape: "rectangle", text: "Sign up", x: 0, y: 0 },
  { op: "add", id: "verify", shape: "diamond", text: "Email verified?", rightOf: "signup" },
  { op: "add", id: "home", shape: "rectangle", text: "Home", rightOf: "verify" },
  { op: "add", id: "resend", shape: "rectangle", text: "Resend link", below: "verify" },
  { op: "connect", from: "signup", to: "verify" },
  { op: "connect", from: "verify", to: "home", label: "yes" },
  { op: "connect", from: "verify", to: "resend", label: "no" }
]
\`\`\`

## Rules

- **Read first when the board is not empty.** \`whiteboard-read\` gives the ids
  and the bounds; add beside what is there (to the right of \`bounds.maxX\`, or
  \`below\` an existing element). Never draw over existing content.
- **Add to, do not replace.** Teammates' elements stay unless the ask is to
  change or remove them. "Clear the board" / "start over" must be explicit.
- **One call per ask.** Build the whole diagram in one \`ops\` list — it is
  all-or-nothing, and one history entry. Use the \`reason\` for teammates
  ("sketched the onboarding flow"); from a thread, end it with
  \` · thread:<rootId>\`.
- **Freehand strokes and images are theirs.** The read lists them under
  \`other\`; leave them alone and place around them.
- **Say what you drew, briefly.** Name the board, count the elements, mention
  ids only if the person will refer to them. The board is the deliverable;
  do not narrate coordinates.
- A board that does not exist is created on the first draw. To draw on a
  named board, pass \`board: "<name>"\`.
`;

export default skill;
