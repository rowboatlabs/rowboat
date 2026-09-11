# OpenCode accounts and free access

The coding-model picker follows Rowboat's saved OpenCode connections:

| Connection | Visible coding models |
| --- | --- |
| Neither account connected | Public OpenCode models with zero input and output cost in native metadata |
| Go only | Go models only, including hiding public Zen models |
| Zen only | Zen models only |
| Both | A Go/Zen switch, showing one service's models at a time |

The switch browses a service; selecting a model commits the choice. Connection IDs describe the service configured in Rowboat, not a verified subscription entitlement. Model access is enforced during discovery, selection validation and before coding. A disconnected or otherwise unavailable explicit selection reports an error instead of silently switching services. Disconnecting both accounts restores the free list. Unknown pricing is not classified as free, and model names are not used to infer cost.

Enable the managed engine, open a Code session, choose a native model, and start coding. Public free models require no account key. Availability and rate limits are controlled by OpenCode; Rowboat does not hardcode a free-model catalog or promise permanent availability.

Settings - Code Mode - OpenCode offers **Connect Go / Zen (optional)**. Open the OpenCode account page, choose Go (subscription) or Zen (pay as you go), paste the account API key and save. The key connects only the selected service; Rowboat never switches from Go to Zen automatically. Select models in the Code session header, not Settings. The installed engine uses only the OpenCode and OpenCode Go providers.

Saving means **account key saved**, not verified access. The actual coding request checks credentials and model entitlement. Invalid credentials produce a recoverable error, not a Ready badge. Disconnecting an account removes its managed credential; public free models remain selectable. A session pointing to an unavailable paid model requires choosing another model explicitly.

Keys travel through typed IPC to the private backend-owned setup service. The password field clears immediately, and secrets never enter chat, renderer persistence, or diagnostics. The backend opens a fixed HTTPS account URL. Closing setup or quitting stops owned processes. Keys and conversations survive engine removal/reinstallation. Global OpenCode credentials are not imported.

The generic provider/OAuth/verification backend helpers remain covered for compatibility, but those flows are not offered in Settings. Old Settings model selections are no longer used to seed or override Code sessions.

OpenCode uses the same two-model flow as Codex. The Rowboat chat model selected in the composer delegates to `code_agent_run`; the coding model selected in the Code header runs inside native OpenCode. Rowboat handles the surrounding chat and normal title generation. Free OpenCode models need no OpenCode account, but this flow requires a configured Rowboat chat model. Existing native sessions retain their context. Already-persisted direct-dispatch turns remain resumable for compatibility; new turns use normal delegation.

Validation includes renderer key clearing and account switching, Rowboat-model delegation and legacy direct-turn compatibility, native public access against a local fake model endpoint, native account-key rejection, disconnect and process cleanup. Real Go/Zen account entitlement, public service availability, packaged Electron, macOS and Linux remain manual release checks.
