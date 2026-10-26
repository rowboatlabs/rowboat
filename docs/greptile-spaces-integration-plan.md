# Greptile Spaces bot implementation plan

Design proposal dated 2026-10-22 for `feat/greptile-spaces-integration`, based on main commit `c11e8845` and the Attio implementation at `3459f7b9` on `feat/attio-spaces-integration`.

Add Greptile to **Add bot** so people and agent members can request reviews and read review findings inside Spaces. Harbor runs a deterministic command connector, calls Greptile using the bot owner's stored credential, and replies in the invoking thread. A review request finishes when Greptile accepts it; a separate command reads progress and results.

This document owns the proposed implementation sequence and acceptance criteria. [SPEC §8](../apps/harbor/SPEC.md#8-agents-in-spaces) owns product rules, [CONTRACT.md](../apps/harbor/CONTRACT.md) owns wire semantics, and [the Harbor guide](../apps/harbor/AGENTS.md) owns implementation conventions. Amend those documents with the implementation; keep progress and execution results in the PR and git history.

## Scope and product behavior

The first release supports Greptile Cloud with repositories hosted on github.com and gitlab.com. An owner adds a bot with a Greptile organization API key, adds it to a shared space, and invokes explicit commands. Existing Spaces invocation, membership, agent handoff, thread queue, and credential ownership rules apply unchanged.

The release includes repository discovery, open pull request listing, review requests, review status, and review comments. No model interprets requests on Harbor. It does not edit code, mark findings addressed, change review rules, merge PRs, install GitHub apps, or onboard repositories into Greptile. Repositories must already be connected in Greptile. There is no completion webhook, polling worker, natural-language interface, or automatic review-on-link behavior in this slice. Do not add dormant routes or schema fields for those features.

Other agent members can use the same commands through normal mentions, subject to the existing hop limit. Review output must not create new mentions or instructions for those agents by itself.

## External contract and authentication gate

Greptile's [MCP tools reference](https://www.greptile.com/docs/mcp-v2/tools) documents `get_me`, `list_repositories`, `list_pull_requests`, `list_code_reviews`, `get_code_review`, `list_merge_request_comments`, and `trigger_code_review`. API keys belong to one organization. Repository operations use the discovered repository identity, including its default branch. A trigger acknowledgement means queued, returns no review ID, and supports GitHub and GitLab. These facts determine the adapter boundaries below.

The [current setup guide](https://www.greptile.com/docs/mcp-v2/setup) specifies `https://api.greptile.com/mcp` and emphasizes interactive OAuth. Therefore, before releasing the setup UI, verify the supported API-key header and headless handshake with an actual organization key. Do not treat tool discovery as proof of authentication or infer the header from the word “key.”

The first implementation step is a small authenticated compatibility check:

1. Confirm API-key issuance and its supported transport with current official documentation or Greptile support.
2. Initialize the MCP client and call `get_me` and `list_repositories` without opening a browser.
3. Check a known PR's read operations; capture redacted fixtures for the exact success and error envelopes.
4. Explicitly test one review request against a disposable PR, then inspect its status separately. This live check creates external review activity and must use an agreed test PR.
5. Record authentication, response envelope, timeout, and error-mapping evidence in the implementation PR without credentials or private source content.

If headless API keys do not work, stop that dependency of the implementation and revise the design for OAuth. Do not ship a key field that cannot authenticate, copy a developer's OAuth token, or silently build token refresh into the string-key flow. OAuth would require a separate connection lifecycle and an organization-selection decision, beyond this Attio-style slice. The user authorized completing the fixture-based implementation, including setup UI, without a live key on 2026-10-22. Live authentication and a real review remain release gates.

## Command contract

Use the bot's current display name in help and usage examples. The names below use the default name Greptile. All page numbers shown to users start at 1.

| Command | Proposed result | Effect |
| --- | --- | --- |
| `@Greptile help` | Command list and examples | Local only |
| `@Greptile repos [page]` | Up to 10 repositories with provider and review availability | Read |
| `@Greptile prs <repository-url> [page]` | Up to 10 open PRs or merge requests, with title, number, author, and link | Read |
| `@Greptile review <pr-url>` | Acknowledgement that Greptile queued a review, plus the status command | Requests a review |
| `@Greptile status <pr-url>` | Latest visible review state, review ID, commit, timestamp, and available summary | Read |
| `@Greptile comments <pr-url> [page]` | Up to 10 unaddressed Greptile comments with file and line information | Read |

Use explicit URLs to disambiguate the provider and repository. Examples:

```text
@Greptile repos
@Greptile prs https://github.com/rowboatlabs/rowboat
@Greptile review https://github.com/rowboatlabs/rowboat/pull/1234
@Greptile status https://github.com/rowboatlabs/rowboat/pull/1234
@Greptile comments https://github.com/rowboatlabs/rowboat/pull/1234 2
@Greptile status https://gitlab.com/group/project/-/merge_requests/42
```

Accept HTTPS cloud-provider URLs only. Support nested GitLab groups. Parse URLs with `URL`, reject embedded credentials, ports, unrecognized paths, encoded path separators, and non-positive or unsafe PR numbers. Ignore a query or fragment only after validating the origin and route, and use a canonical URL in replies. Permit a trailing slash. Reject extra arguments and invalid page numbers before opening an MCP session. Plain `owner/repo` shortcuts are excluded initially because they leave the provider ambiguous.

Empty input and unknown commands use the shared help behavior. Malformed known commands produce a usage reply and complete normally; they do not make an upstream request. An empty result is a successful answer, distinct from an unavailable repository or failed API call.

### Repository resolution and pagination

Resolve the exact provider and repository name against Greptile's repository catalog; use the returned default branch rather than assuming `main`. Never fetch a user-supplied PR URL or send credentials to its host. A PR URL is only structured input to calls at the fixed Greptile endpoint.

Use a bounded catalog lookup, with exact matching after any server filtering. Handle no match and ambiguous matches explicitly. Cap lookup work at 10 catalog pages of 100 entries per command; if exhausted, say the lookup could not be completed rather than claiming the repository does not exist. No repository cache is needed initially, avoiding stale identities after credential replacement.

Centralize conversion between the bot's page numbers and each tool's pagination format. Cap user page numbers at 100 initially. Do not treat the number returned on a page as an overall count or imply a complete list when the upstream response is truncated. For comments, if the live tool has no pagination, fetch once within a bounded response size and paginate the validated array locally. A response that exceeds the bound fails clearly rather than silently dropping bytes.

### Replies and review lifecycle

`review` validates and resolves the target, then issues exactly one trigger call. A successful reply says “Review requested for …” and provides `@Greptile status <pr-url>`. It must not say the review passed or finished. Do not fabricate a review ID or claim that a later run was necessarily caused by this request.

`status` sorts validated review records by their timestamps and reports the latest visible run with its ID and commit. Distinguish no review, queued, running, completed, failed, and skipped. Preserve unknown upstream states as a neutral status instead of mapping them to success. If a newer run is working, do not present an older completed summary as its result. Where data is delayed, say “No review visible yet.”

Comments are PR-level findings unless upstream data explicitly associates them with a run. Do not describe all PR comments as findings from the latest review. Render file, line, bounded comment text, and a canonical PR link; do not invent comment anchors. Show when content is shortened and how to request the next page.

Normalize upstream HTML to safe display text or existing supported Markdown. Escape table syntax, links, and Spaces mention-token syntax in upstream titles, paths, and comments. Do not allow external content to turn into actionable member mentions. Keep replies below the existing 60,000-character answer limit with a smaller explicit display budget, proposed at 12,000 characters, and cap individual comment excerpts at 800 characters.

## Harbor implementation

Use [commands.ts](../apps/harbor/packages/server/src/connectors/commands.ts) and `integrationPlatform()` for dispatch, help, invocation acknowledgement, thread answers, and restart behavior. The Greptile adapter owns its MCP session lifecycle and normalized errors. Do not refactor other integrations simply to add this one.

| File | Planned responsibility |
| --- | --- |
| `apps/harbor/packages/server/src/connectors/greptile/client.ts` | Fixed-endpoint MCP transport, session cleanup, authentication check, response validation, bounded calls, and local error messages |
| `apps/harbor/packages/server/src/connectors/greptile/index.ts` | Command grammar, repository resolution, formatting, and `greptilePlatform()` |
| `apps/harbor/packages/server/src/connectors/platforms.ts` | Register the Greptile platform |
| `apps/harbor/packages/protocol/src/core.ts` | Add the `greptile` kind/connection pair and hosted connection |
| `apps/harbor/packages/server/test/greptile-connection.test.ts` | Wire-level setup, credentials, invocation, and replies |
| `apps/harbor/packages/server/test/fake-greptile.ts` | Local MCP fixture with controllable responses and request accounting |
| `apps/harbor/packages/server/test/greptile-client.test.ts` | Transport envelopes, parsing, limits, and failure classification |

Harbor already depends on `@modelcontextprotocol/sdk`. Reuse its installed client and Streamable HTTP transport rather than adding a CLI process or writing a partial MCP implementation. Check the installed SDK APIs before choosing imports. Implement a `withClient`-style boundary per command and per verification operation, closing the client in `finally`. Do not retain credentials or sessions in a global singleton. Every command reads the current sealed credential through the existing connector environment.

Allowlist the tool names the commands need. Do not expose a generic “call any MCP tool” command. Validate the consumed response fields with the pinned Zod version, tolerate additive fields, and normalize structured or text-wrapped tool results only when their envelopes match a tested form. An MCP tool error must remain an error even when its HTTP response is 200.

Proposed bounds are a 20-second individual call timeout, a 45-second overall command deadline, a 2 MiB response budget, and the catalog limits above. Enforce the response budget while reading transport bodies, not after unlimited allocation. Session initialization and cleanup must also terminate. Verify the SDK does not automatically replay a trigger after connection loss or session expiration; explicitly disable any such path for the write call.

## Credentials and permissions

Reuse the existing platform credential flow in `core/agents.ts`, `connectors/host.ts`, and `connectors/sealing.ts`. The owner supplies a key, Harbor verifies before saving, and `HARBOR_INTEGRATION_KEY` seals it. A failed replacement leaves the previous valid credential intact. The existing hint, setter, rejection metadata, and owner-only replacement behavior remain the UI contract.

Authenticate with a protected identity call and validate the returned account shape. A valid organization with no repositories is acceptable setup; the bot can explain how to connect repositories later. Do not test setup by triggering a review.

The credential grants shared service access, not the invoking person's GitHub permissions. Anyone whom Spaces allows to invoke this bot can read data available to its credential and request reviews. Replies inherit the space's visibility, including the existing open-space reading rules. Explain this beside the key field and in setup instructions. Follow the established member and agent handoff policy; do not invent an owner-only review rule in the connector.

Use a Greptile-specific `IntegrationError` subclass, following Attio's distinction between invalid credentials and resource denial. Only a verified authentication rejection should mark the key rejected. A resource-level 403, missing repository, or plan restriction should fail that command without disabling the bot. The generic helper currently treats both 401 and 403 as key rejection, so inheriting it unchanged is insufficient.

Never relay raw upstream error bodies, authorization headers, transport exceptions, or account payloads into chat, setup errors, or logs. Convert known failures into local messages. Tests must include secret sentinels in HTTP and MCP error bodies. Restrict authenticated requests to the fixed Greptile origin and reject redirects. A fixture endpoint override belongs to test construction only, never bot setup input.

## Errors and delivery guarantees

| Condition | Bot behavior |
| --- | --- |
| Invalid arguments | Usage reply; no upstream call |
| Valid empty list | Explicit empty result; invocation done |
| Credential rejected | Existing rejected-key flow; invocation failed; owner replaces key |
| Resource forbidden or missing | Command fails with an access/not-available explanation; key stays usable |
| Rate limit | Command fails with a retry-later message; no automatic trigger retry |
| Read timeout, malformed JSON, tool error, or incompatible result | Bounded local error; invocation failed |
| Trigger timeout or connection loss after dispatch | Explain that the request may have been accepted; instruct `status` before another `review` |
| Harbor restarts after acknowledgement | Existing interrupted-command failure; never reissue the trigger automatically |
| Duplicate invocation delivery | Existing acknowledgement gate prevents executing that invocation twice |
| Two distinct review mentions | Two intentional requests; do not claim cross-invocation deduplication |

The shared command connector provides at-most-one dispatch attempt for an acknowledged invocation, not exactly-once effects across Harbor and Greptile. A successful trigger whose reply is lost remains uncertain. Do not persist a guessed review ID or reuse the invocation queue as a background review monitor. The connector keeps `stop: false` and no invocation options, matching the existing command-bot model.

## App integration

Add Greptile metadata to `KINDS`, `PLATFORMS`, and `AGENT_SETUPS` in [agent-kinds.ts](../apps/x/apps/renderer/src/lib/agent-kinds.ts). Set `bot: true` and use the existing generic bot mark. The shared Add bot flow should handle creation and credential submission; avoid a separate Greptile dialog.

Proposed description: “Request code reviews and read Greptile findings.” Key label: “Greptile organization API key,” contingent on the authentication check. Explain that repositories must already be connected in Greptile, that teammates can use the key through this bot, and that review requests can consume the organization's review allowance. Link to the verified key-creation instructions rather than an assumed dashboard path.

The setup screen should show help, repository listing, review, status, and comments examples and explain that results are read with `status`. Preserve rename behavior and credential replacement controls. Add renderer tests for discovery under Bots, validation, submitted kind/connection, rejected credentials, and examples. Check the shared web renderer. Inspect mobile's actual bot setup support before claiming it gains creation; at minimum verify it can display the bot, its replies, and invocation states.

## Test design

Use the production Harbor service and in-process Postgres for behavior tests, as required by the Harbor guide. The MCP fixture must exercise initialization, tool calls, and error envelopes rather than mocking only client methods.

| Area | Required cases |
| --- | --- |
| Registration | Valid Greptile kind/connection accepted; mismatched pair refused; hosted connector starts |
| Setup | Valid key, empty catalog, invalid key, unavailable service, malformed identity, missing sealing key |
| Credential ownership | Owner replacement; teammate/admin refusal under existing rules; failed replacement preserves old key; rejection clears after valid replacement |
| Isolation | Two Harbor orgs and two Greptile credentials never share sessions, catalogs, results, or stored secrets |
| Invocation | Real stored mention, DM with qualifying shared membership, no invocation without membership, thread reply, renamed bot, agent handoff depth |
| Parsing | GitHub URL, nested GitLab URL, invalid scheme/host/port/path, encoded separators, invalid PR number/page, surplus arguments |
| Commands | Every happy path, empty and truncated results, catalog exact matching, non-main default branch, paging, unknown review state |
| Review effects | Exactly one trigger per delivered invocation; no trigger on help/setup/status/comments; ambiguous timeout; restart without replay |
| Transport | JSON and supported SSE responses, structured/text results, HTTP 200 tool failure, 401 versus 403, 429, timeout, redirect, size limit, cleanup |
| Output | Secret sentinels, HTML, hostile Markdown, mention tokens, missing optional fields, oversized findings, correct PR and thread links |
| Compatibility | Existing PostHog/Cal command suites, agent lifecycle suites, protocol docs checks, renderer bot setup tests |

Manual acceptance uses one disposable GitHub PR and one GitLab MR if GitLab is advertised at launch. Exercise add bot, help, listing, trigger, status, comments, key replacement, and a server restart. Use a second person and an agent member for invocation tests. Confirm no review comments or source are exposed beyond the intended space audience. Verify a packaged desktop and the web app against the same Harbor build. Record real-service tests separately from fixture tests.

## Implementation sequence and validation

1. **Verify Greptile authentication and envelopes.** Resolve the headless credential gate and capture sanitized fixtures. This determines whether the existing platform-key flow is viable.
2. **Build the typed client and fixture.** Cover MCP transport, cleanup, fixed-origin requests, result parsing, error redaction, and no replay of review triggers.
3. **Implement commands and register the platform.** Add protocol identifiers, exact repository resolution, formatting, lifecycle behavior, and wire-level tests together.
4. **Expose the bot in the app.** Add setup metadata and renderer tests once Harbor accepts the new connection.
5. **Update the owning documents.** Add dated Greptile rules to SPEC §8, settled command/auth/failure semantics to CONTRACT.md, and module/test entries to the Harbor guide. Update structural docs tests only where required by their assertions.
6. **Run validation and real-service acceptance.** Fix failures, record evidence and limitations in the PR, and deploy Harbor before exposing the bot in released clients.

Suggested commands after implementation, run from the repository root:

```sh
pnpm --dir apps/harbor install --frozen-lockfile
pnpm --dir apps/harbor -r build
pnpm --dir apps/harbor/packages/server exec vitest run test/greptile-client.test.ts test/greptile-connection.test.ts
pnpm --dir apps/harbor -r typecheck
pnpm --dir apps/harbor -r test
pnpm --dir apps/x install --frozen-lockfile
npm --prefix apps/x test
npm --prefix apps/x run typecheck
npm --prefix apps/x run lint
```

Use the existing desktop packaging command with the project's supported Node version for the packaged-app acceptance check. Harbor must build before x because of the `link:` dependencies. Keep both workspaces on Zod 4.2.1. There is no expected database migration or new REST/MCP route: the feature uses existing agent creation, credentials, membership, and invocation operations. Verify that expectation against implementation instead of adding a migration preemptively.

## Branch boundaries and rollout

Implement independently on `feat/greptile-spaces-integration`. Read the Attio branch as a reference; do not merge its entire diff, which includes unrelated packaging changes. Reuse its client error and setup-copy patterns where appropriate. If Attio lands first, reconcile the shared registry and setup arrays without removing either integration.

The working tree already contains release-version edits, a dev-sandbox change, and manual-test documents from earlier work. Keep those out of the Greptile commit unless separately intended. Do not reset them while implementing this plan.

Deploy the additive Harbor connector before the client that advertises it. Test an older client against the new server and the new client against an older server; the latter must surface the server's unsupported-connection error without losing the form input. Avoid rolling Harbor back past Greptile support while active Greptile bots remain: old servers cannot run their connector. Any rollback must account for those bots and communicate their unavailability.

The release is acceptable when the authentication gate passes, every advertised command works against real Greptile, wire and renderer tests pass, credentials remain isolated and sealed, uncertain triggers are never replayed, and server/client documentation matches the shipped behavior. A successful package build alone is insufficient evidence of the live integration.
