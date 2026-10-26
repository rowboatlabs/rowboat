# Greptile Spaces bot manual testing

Use this guide to set up Rowboat and Harbor from source, test the Greptile bot without an account, and then verify it against real Greptile. Fixture checks establish application behavior; only live checks establish authentication and actual review delivery.

Product rules belong to [Harbor SPEC §8](../apps/harbor/SPEC.md#8-agents-in-spaces), command and failure semantics to [CONTRACT.md](../apps/harbor/CONTRACT.md), and implementation choices to the [integration plan](greptile-spaces-integration-plan.md). This guide owns setup and test procedures. Put execution results in the PR, not in this file.

## Choose a test path

| Path | Needs | Proves |
| --- | --- | --- |
| Local fixture | Source checkout, Node, pnpm; no Greptile account | Bot setup, commands, rendering, membership, key replacement, error handling, request counts |
| Live service | The same source plus a supported Greptile organization API key and disposable connected repository/PR | Actual authentication, supported response shapes, request acceptance, review completion |
| Durable restart | Either path plus a disposable Postgres database | Recovery across process restarts without losing bot records |

**Live authentication is a release gate.** This connector sends an organization key as `Authorization: Bearer …` to `https://api.greptile.com/mcp`, requires `get_me` to identify `API_KEY` and exactly one organization, and reads the repository catalog before saving. Greptile's [setup guide](https://www.greptile.com/docs/mcp-v2/setup) emphasizes OAuth, while its [tools reference](https://www.greptile.com/docs/mcp-v2/tools) describes organization keys. A successful fixture run does not resolve that discrepancy. Confirm API-key availability and compatibility with Greptile; if only OAuth is available, record live setup as blocked. Do not paste a browser access token into the key field or count MCP discovery as authenticated access.

## Prepare a source checkout

The checkout must contain the Greptile implementation, including `test/manual-greptile.ts`. A fresh clone only contains published commits; if the feature branch exists only locally, use that working checkout or transfer the implementation before following these commands. Do not discard existing local changes to switch branches.

For a new checkout after the feature branch is available on the remote:

```sh
git clone https://github.com/rowboatlabs/rowboat.git
cd rowboat
git switch feat/greptile-spaces-integration
```

For the existing workspace, start at its repository root:

```sh
cd /mnt/Games-and-Work/Harshvardhan/Coding/work/rowboat/rowboat
git branch --show-current
git status --short
```

Use Node **24.15.0**, matching the desktop release workflow. If you use nvm:

```sh
nvm install 24.15.0
nvm use 24.15.0
npm install -g pnpm@10.20.0
node --version
pnpm --version
```

Use the same Node version in every terminal. Linux desktop builds also need a compiler, Python, and the system libraries required by Electron/native modules. The web path avoids launching Electron and is the quickest way to test the shared bot UI.

Build the two workspaces in order, from the repository root:

```sh
pnpm --dir apps/harbor install --frozen-lockfile
pnpm --dir apps/harbor -r build
pnpm --dir apps/x install --frozen-lockfile
npm --prefix apps/x run deps
```

Harbor must build first because x uses `link:` dependencies. Keep the pinned Zod versions and lockfiles unchanged. Do not run another dependency build while test suites are importing generated output.

## Configure Harbor

Open a dedicated Harbor terminal at the repository root. Create a local sealing key once and keep it for the lifetime of the test database:

```sh
mkdir -p "$HOME/.config/rowboat-greptile-qa"
chmod 700 "$HOME/.config/rowboat-greptile-qa"
if [ ! -f "$HOME/.config/rowboat-greptile-qa/sealing-key" ]; then
  (umask 077; node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))' > "$HOME/.config/rowboat-greptile-qa/sealing-key")
fi
chmod 600 "$HOME/.config/rowboat-greptile-qa/sealing-key"
export HARBOR_INTEGRATION_KEY="$(cat "$HOME/.config/rowboat-greptile-qa/sealing-key")"
export PORT=4272
unset HARBOR_MODE AUTH_ISSUER AUTH_PUBLISHABLE_KEY HARBOR_JEV_OPENROUTER_KEY
```

`HARBOR_INTEGRATION_KEY` is Harbor's 64-character hexadecimal encryption key, **not** the Greptile key. Do not regenerate it between durable restarts. Keep the dev server local: dev tokens allow impersonating seeded members and are unsuitable for a public deployment.

For a clean in-memory run:

```sh
unset DATABASE_URL
```

In-memory data disappears when Harbor stops. For persistence tests instead set `DATABASE_URL` to a dedicated disposable database before starting Harbor. If you have Docker, this is one way to create it:

```sh
docker run --name rowboat-greptile-qa-pg \
  -e POSTGRES_PASSWORD=local-qa-only \
  -e POSTGRES_DB=greptile_qa \
  -p 127.0.0.1:55432:5432 \
  -v rowboat-greptile-qa-pg:/var/lib/postgresql/data \
  -d postgres:17
docker exec rowboat-greptile-qa-pg pg_isready -U postgres -d greptile_qa
export DATABASE_URL='postgres://postgres:local-qa-only@127.0.0.1:55432/greptile_qa'
```

Wait for `pg_isready` to report accepting connections. On a later run use `docker start rowboat-greptile-qa-pg`; do not run a second container with the same name. The password above is for this local disposable database only.

### Start with the fixture

Create a mutable scenario file, then launch the manual harness:

```sh
printf '{}\n' > /tmp/rowboat-greptile-scenario.json
pnpm --dir apps/harbor/packages/server exec tsx test/manual-greptile.ts /tmp/rowboat-greptile-scenario.json
```

The launcher replaces Greptile only inside this process and then starts the normal seeded dev Harbor. It does not edit the production registry. The fixture runs on an ephemeral local port; Harbor remains on 4272. Its accepted fake keys are `good` and `other`; all other strings are rejected. It prints tool names and arguments, never the authorization header. Baseline data is `owner/repo`, default branch `develop`, PR 42, and a completed review with one comment.

Leave this terminal running. Reset the scenario file to `{}` before creating/replacing a bot unless you are deliberately testing setup failures. Changes to the JSON take effect on the next tool call without restarting Harbor. Use only synthetic data in this fixture.

### Start against real Greptile

Stop the fixture launcher first. In the same configured terminal, with no fixture process on 4272:

```sh
pnpm --dir apps/harbor/packages/server dev
```

Obtain a supported organization key through Greptile's available account controls or support. Prepare a connected GitHub.com repository and disposable PR; also prepare a GitLab.com MR if validating that provider. Record the default branch, PR/MR URL, baseline review count, and known findings. Do not assume the fixture's `owner/repo` exists in the live account.

Enter the key only in the bot setup or replacement field. Creation verifies it before saving. If creation fails, capture the sanitized error and confirm the credential contract; do not change the client to accept arbitrary identity responses just to pass setup. A failed live check is not evidence that all keys are invalid.

## Start the app and test identities

The simplest local UI is the shared Spaces web app. In a second terminal at the repository root:

```sh
VITE_SPACES_DEV_HARBOR=http://localhost:4272 \
VITE_SPACES_DEV_MEMBER=harsh \
pnpm --dir apps/x/apps/renderer dev:web
```

Open `http://localhost:5174`. Harbor's dev configuration allows this origin. See [WEB.md](../apps/x/apps/renderer/WEB.md) for the web host and deployed sign-in behavior.

Use these seeded identities:

| Role | Member | Purpose |
| --- | --- | --- |
| A, bot owner | `harsh` | Ordinary member creates and manages the bot |
| B, teammate | `arjun` | Invokes a bot they do not own |
| C, admin | `ramnique` | Seeded Roadboard creator/admin; must not gain owner-only replacement rights |
| D, observer | `gagan` | Kept outside the private QA space; tests visibility and invocation boundaries |

To switch the dev web identity, stop Vite and restart the same command with another `VITE_SPACES_DEV_MEMBER`, then reload the page. The identity is chosen by the Vite environment, so another browser profile on the same server does not by itself switch identities. Sequential sessions suffice for these tests. For simultaneous UI sessions, use separate Vite ports and explicitly add each origin to `HARBOR_WEB_ORIGINS`, then restart Harbor with the same database.

For desktop coverage, use a third terminal:

```sh
npm --prefix apps/x run dev
```

Open Spaces → **Add a dev server**, URL `http://localhost:4272`, member ID `harsh`. Use a dev build from this source; an earlier installed 1.10.1 package does not gain the new bot entry merely because the manifest version matches. Starting desktop builds dependencies; let that finish before running automated suites.

### Create the test spaces and bot

1. As A, create private `QA Greptile Private` and open `QA Greptile Open` spaces. Add B and C to the private space; keep D out. Keep at least two shared spaces in the org so workspace/DM behavior is available.
2. Open the org's agents/bots dialog and choose **Add bot → Greptile**.
3. Confirm the key field, shared-access explanation, and review-allowance wording. Use `good` for fixture testing or the verified organization key for live testing.
4. Add the bot with its default name. Add it to the private QA space using the ordinary member picker. Add it to the open space only when the test calls for that.
5. Send a real mention selected from the mention picker. Text that only looks like `@Greptile` is not a substitute for a stored member mention.
6. Record the bot member ID, space IDs, source commit, and client/server build. Keep unrelated agents out of the test spaces to make replies and request counts easy to attribute.

Baseline fixture messages:

```text
@Greptile help
@Greptile repos
@Greptile prs https://github.com/owner/repo
@Greptile review https://github.com/owner/repo/pull/42
@Greptile status https://github.com/owner/repo/pull/42
@Greptile comments https://github.com/owner/repo/pull/42
```

## P0 setup and core behavior

Run all P0 cases before edge cases. “Either” means both fixture and live are useful; record which you used.

| ID | Mode | Steps | Expected result |
| --- | --- | --- | --- |
| GP-01 | Either | Open Add agent, then Add bot | Greptile is a bot choice, not a general-agent choice; default name is Greptile |
| GP-02 | Either | Leave key empty; try Add | Add is disabled or validation prevents creation; no bot is created |
| GP-03 | Fixture | Enter `bad`; then correct it to `good` | First attempt fails without a bot or secret echo; form stays editable; second succeeds |
| GP-04 | Either | Add with a valid key and inspect setup | Correct kind/connection; commands shown; no alert setup; key not displayed afterward |
| GP-05 | Either | Ask `help`, an unknown command, and malformed `review http://localhost/x` | Help/usage reply in the invoking thread; done state; no Greptile tool request for these commands |
| GP-06 | Either | Ask `repos`, then `prs <repository-url>` | Correct repositories and open PRs with working provider links; fixture shows owner/repo and PR 42 |
| GP-07 | Either | Ask `review <pr-url>` once | One trigger request; reply says queued/requested, never completed; invocation ends without waiting for analysis |
| GP-08 | Either | Ask `status <pr-url>` after GP-07 | Latest visible state, review ID/time/commit; completed summary only for a completed run; no additional trigger |
| GP-09 | Either | Ask `comments <pr-url>` | Unaddressed Greptile findings with file/line where available; PR-level wording; no claim they all belong to the latest run |
| GP-10 | Either | As B, invoke the bot in the shared QA space | Allowed under existing membership rules; answer attributed to the bot in B's thread |
| GP-11 | Either | As A, replace the key with another valid key (`other` in fixture), then ask `repos` | Replacement succeeds; subsequent commands use the new credential; no old-session data reused |
| GP-12 | Either | Try an invalid replacement, then a lookup | Replacement fails; previous valid credential remains usable |
| GP-13 | Either | As B and C, attempt credential replacement through UI and REST | UI hides unavailable controls; server returns forbidden for both non-owner and admin |
| GP-14 | Either | Rename bot to Reviewer; invoke it again | Help uses current name; answers still route correctly; no duplicate bot needed |
| GP-15 | Either | Ask in two different threads | Each reply stays in its own thread and appears once; no cross-thread result |
| GP-16 | Live | Finish real authentication and review checks for GitHub and advertised GitLab support | Actual protected reads and review request succeed; a completed run is visible separately; fixture success is not substituted |

Count fixture calls by tool name. Setup legitimately calls `get_me` and `list_repositories`; repository resolution legitimately adds catalog calls before PR commands. Only `review` may call `trigger_code_review`. The baseline fixture always returns a completed review for `status`, independent of whether you triggered one; it cannot prove real queue-to-completion behavior.

## P1 permissions and lifecycle

| ID | Mode | Steps | Expected result |
| --- | --- | --- | --- |
| GP-17 | Either | As D, attempt to read/post to the private QA space | Membership boundary enforced; no private review text or work leaked |
| GP-18 | Either | Add bot to open QA space; post a synthetic finding; inspect as D before joining | Open-space visibility follows existing rules; setup accurately warned that space readers can see replies; preview alone does not grant invocation |
| GP-19 | Either | As B with shared membership, open a DM with the bot and send `help` without a mention | DM invokes it and returns a thread reply under existing DM rules |
| GP-20 | Either | Use an agent member in the shared space to mention Greptile | Same command contract and attribution; existing hop limit applies; upstream findings create no new member mentions |
| GP-21 | Fixture | Create two bots on different fake keys; route catalog replies to distinctive test data in a custom fixture if needed | No credential/session/catalog reuse between bots; existing automated isolation test supplies exact outgoing-header evidence |
| GP-22 | Either | Repeat setup in a second disposable Harbor org with different credentials | No cross-org bot listing, credential replacement, or replies; an agent ID from the first org is not a usable target in the second |
| GP-23 | Fixture | Configure a delayed trigger; submit one review and briefly disconnect the UI; reconnect | One trigger remains one request; reconnect does not reissue it; inspect invocation/thread after reconnect |
| GP-24 | Fixture + durable DB | Configure a delayed trigger, submit review, wait until its trigger appears in Harbor logs, terminate Harbor, and restart with same database/key | Acknowledged unfinished work fails with restart uncertainty; no automatic trigger replay; status can be requested separately |
| GP-25 | Fixture | Send two separate review mentions | Two distinct requests are allowed; this is not duplicate delivery and is not expected to deduplicate |
| GP-26 | Either | Restart Harbor after a completed command using durable DB | Bot, membership, history and sealed credential survive; completed commands are not replayed |
| GP-27 | Either | Remove bot from the test space, then mention it | Existing membership policy prevents new work; no connector bypass |
| GP-28 | Fixture | Verify duplicate delivery through the focused automated test | One acknowledged invocation is executed once; UI double-send is not a valid simulation of duplicate delivery |

For GP-24, note that the fixture itself restarts and cannot prove whether external Greptile accepted a request. Its log proves whether Harbor attempted another trigger. Use a disposable database only; do not interpret a normal in-memory restart, which deletes all test data, as recovery coverage.

## P1 command boundaries and display

Each listed input is a separate subcase. Use real mention tokens when sending these commands.

| ID | Steps | Expected result |
| --- | --- | --- |
| GP-29 | Use `prs https://github.com/owner/repo`; GitLab nested-group URL; PR URL with query/fragment/trailing slash | Correct provider/path; query/fragment omitted from canonical reply; discovered default branch used |
| GP-30 | Try HTTP, unsupported host, embedded credentials, explicit port, encoded slash, `..` segment, PR 0, unsafe large PR number, wrong PR path | Usage failure before MCP session creation; user-supplied URL never fetched |
| GP-31 | Try missing URL, surplus arguments, pages 0, -1, 1.5, text, and 101 | Usage reply; no tool calls |
| GP-32 | Configure 11+ results; request pages 1 and 2; request a page beyond results | At most 10 items per page; continuation guidance; empty page is a normal answer |
| GP-33 | Configure an empty catalog, missing target, duplicate matching target, or disabled review target | Empty catalog accepted at setup; missing/ambiguous repository fails clearly; disabled target does not trigger |
| GP-34 | Configure catalog match with default branch `develop` | Outgoing PR/review calls use `develop`, never hardcoded `main` |
| GP-35 | Configure older completed review and newer pending review | Pending state is shown; older completed summary is not attached to the new run |
| GP-36 | Configure no reviews, failed, skipped, and unknown future status | No-result or distinct status; unknown state does not become success |
| GP-37 | Configure truncated review list or mismatched detail review ID | Explicit failure; no falsely authoritative latest run/summary |
| GP-38 | Return HTML, Markdown links/images, table pipes, member mention syntax, and long comment bodies | Display text is escaped and bounded; no active member mention, image fetch, or formatting injection; excerpts marked |
| GP-39 | Return a response larger than 2 MiB | Explicit bounded-response failure; no enormous chat post |
| GP-40 | Return human comments and addressed comments alongside unaddressed Greptile findings | Only unaddressed Greptile findings are displayed |

The default fixture only knows one GitHub repository. For GitLab command tests, override `list_repositories` with a matching GitLab catalog entry; changing only the typed URL should correctly produce “not available.”

## Inject fixture scenarios

Edit `/tmp/rowboat-greptile-scenario.json` while the fixture launcher runs. Each key is a tool name; absent tools retain the baseline behavior. Overrides replace the whole tool response, not individual fields. Restore `{}` between cases.

A queued review state:

```json
{
  "list_code_reviews": {
    "data": {
      "codeReviews": [{
        "id": "queued-2",
        "status": "PENDING",
        "createdAt": "2026-10-22T12:00:00Z",
        "commitSha": "abc123"
      }]
    }
  }
}
```

A GitLab repository for nested-group tests:

```json
{
  "list_repositories": {
    "data": {
      "repositories": [{
        "name": "group/sub/project",
        "remote": "gitlab",
        "defaultBranch": "develop",
        "reviewsEnabled": true
      }],
      "total": 1
    }
  }
}
```

Then use `https://gitlab.com/group/sub/project/-/merge_requests/42`. Other baseline tools are synthetic and accept the supplied arguments; inspect the log to verify provider, name, branch and PR number. The fixture does not prove provider-side filtering or repository permissions.

For the following table, replace the scenario file with the shown object. Create the bot first unless testing setup rejection. Error body `SECRET_SENTINEL` must never appear in the UI or normal Harbor error logs.

| ID | Scenario JSON | Action and expected result |
| --- | --- | --- |
| GP-41 | `{"list_repositories":{"status":401,"raw":"SECRET_SENTINEL"}}` | Ask repos; invocation fails and key is marked rejected. Restore `{}`, replace key, retry successfully |
| GP-42 | `{"list_repositories":{"status":403,"raw":"SECRET_SENTINEL"}}` | Ask repos; access failure, no rejected-key flag; restoring `{}` makes the same key usable |
| GP-43 | `{"list_repositories":{"status":429,"raw":"SECRET_SENTINEL"}}` | Rate-limit message; no credential rejection |
| GP-44 | `{"list_repositories":{"toolError":true,"data":{"error":"SECRET_SENTINEL"}}}` | HTTP 200 MCP error still fails; raw body not displayed |
| GP-45 | `{"list_repositories":{"raw":"not-json"}}` | Invalid-response failure; no misleading empty list |
| GP-46 | `{"trigger_code_review":{"delay":25000,"data":{"success":true}}}` | Ask review; uncertain-outcome error after timeout; exactly one trigger; status advised before another review |
| GP-47 | `{"trigger_code_review":{"status":500,"raw":"SECRET_SENTINEL"}}` | Uncertain outcome; no retry or credential rejection |
| GP-48 | `{"trigger_code_review":{"status":401,"raw":"SECRET_SENTINEL"}}` | Known authentication rejection; key rejected; one trigger attempt |
| GP-49 | `{"list_repositories":{"redirect":"http://127.0.0.1:4299/observer"}}` | Request fails without following redirect. A local HTTP observer on 4299 should receive nothing |
| GP-50 | `{"get_me":{"data":{"principal":{"type":"USER"},"organizations":[{"id":"org","handle":"qa"}]}}}` | New-bot setup rejects this identity; no conversion of OAuth credentials into shared key storage |
| GP-51 | `{"list_repositories":{"data":{"repositories":[],"total":0}}}` | New-bot setup succeeds; repos explains empty catalog; review lookup does not trigger |

Generate a repeatable pagination and hostile-text response for GP-32, GP-38 and GP-40:

```sh
python3 - <<'PYTHON'
import json
comments = [
    {"body": f"Finding {i}: <b>bold</b> [@Reviewer](#member:fake) ![image](https://example.invalid/image)",
     "isGreptileComment": True, "addressed": False, "filePath": "src/example.ts", "lineStart": i}
    for i in range(1, 12)
]
comments += [
    {"body": "Human note must be filtered", "isGreptileComment": False, "addressed": False},
    {"body": "Resolved note must be filtered", "isGreptileComment": True, "addressed": True}
]
with open('/tmp/rowboat-greptile-scenario.json', 'w') as f:
    json.dump({"list_merge_request_comments": {"data": {"comments": comments}}}, f)
PYTHON
```

For GP-39, generate an oversized response, send `repos`, then reset the file:

```sh
python3 - <<'PYTHON'
import json
with open('/tmp/rowboat-greptile-scenario.json', 'w') as f:
    json.dump({"list_repositories": {"raw": "x" * (2 * 1024 * 1024 + 1)}}, f)
PYTHON
```

After observing the failure:

```sh
printf '{}\n' > /tmp/rowboat-greptile-scenario.json
```

To test text-wrapped results or SSE, stop Harbor and relaunch with the respective flag. Use durable storage if retaining the same bot:

```sh
GREPTILE_QA_TEXT=1 pnpm --dir apps/harbor/packages/server exec tsx test/manual-greptile.ts /tmp/rowboat-greptile-scenario.json
```

```sh
GREPTILE_QA_SSE=1 pnpm --dir apps/harbor/packages/server exec tsx test/manual-greptile.ts /tmp/rowboat-greptile-scenario.json
```

Run help, repos, review, status, and comments under each transport mode. Stop the previous process before restarting; flags apply at startup, not through the JSON file.

## Inspect server enforcement and invocation results

Use this only against local dev Harbor. Replace the two IDs with values from the bot/space UI or the read responses. These examples use fake keys; do not put a live Greptile key in shell history.

```sh
export QA_HARBOR_URL=http://localhost:4272
curl -fsS -H 'Authorization: Bearer dev-harsh' "$QA_HARBOR_URL/v1/agents"
curl -fsS -H 'Authorization: Bearer dev-harsh' "$QA_HARBOR_URL/v1/spaces"
export QA_BOT_ID='<bot-member-id>'
export QA_SPACE_ID='<space-id>'
curl -fsS -H 'Authorization: Bearer dev-harsh' "$QA_HARBOR_URL/v1/spaces/$QA_SPACE_ID/invocations"
```

A non-owner replacement request, expected HTTP 403:

```sh
curl -sS -o /tmp/greptile-replacement-response.json -w '%{http_code}\n' \
  -X PUT -H 'Authorization: Bearer dev-arjun' -H 'Content-Type: application/json' \
  --data '{"secret":"other"}' \
  "$QA_HARBOR_URL/v1/agents/$QA_BOT_ID/credential"
```

Repeat with `dev-ramnique` for the admin case. Inspect listing metadata as the owner: a hint, setter, timestamp and optional rejection metadata are expected; the original key must not be returned. The agent key returned once during bot creation is a different secret from the Greptile credential.

For delayed/error cases record invocation ID, final state, thread root, reply count, and fixture trigger count. Upstream failures may appear as failed invocation UI rather than a normal bot reply. Do not fail a test merely because an error produced no chat message.

## P2 client and regression checks

| ID | Steps | Expected result |
| --- | --- | --- |
| GP-52 | Run bot setup and command cases in desktop and web | Same command and permission behavior; correct loading/error UI |
| GP-53 | Narrow window, keyboard navigation, light/dark theme, long repository names | Form controls usable; text wraps; code examples and errors readable |
| GP-54 | New app against an older Harbor that lacks Greptile | Creation rejected clearly; form remains editable; no ghost bot |
| GP-55 | Older app against new Harbor | Existing spaces, agents and bots continue working; no assumption that old app offers Greptile creation |
| GP-56 | Supported mobile client reads space replies and invocation state | Compatible rendering and navigation; record creation support separately rather than assuming a mobile Add bot flow |
| GP-57 | PostHog/Cal setup and help; ordinary agent listing | Existing integrations remain available and correctly separated from bots |
| GP-58 | Package a desktop from this source and repeat setup/help/review/status against fixture | Packaged build uses the new metadata and compatible Harbor; record exact build and commit |

For GP-58, after the normal dependency build, run from the repository root:

```sh
ROWBOAT_SKIP_CODE_SIGNING=1 npm --prefix apps/x/apps/main run package -- --platform=linux --arch=x64
```

This creates an unpacked Linux application under `apps/x/apps/main/out/Rowboat-linux-x64`. Use the architecture appropriate to your machine. Launch the new build and connect it to the local QA Harbor. Packaging alone does not establish a live Greptile pass. See the repository's packaging configuration for installer targets and platform prerequisites.

## Automated checks alongside manual tests

From the repository root, after dependencies finish building:

```sh
pnpm --dir apps/harbor/packages/server exec vitest run test/greptile-client.test.ts test/greptile-connection.test.ts --maxWorkers=2
pnpm --dir apps/x/apps/renderer exec vitest run src/components/spaces/agents-dialog.test.tsx --maxWorkers=2
pnpm --dir apps/harbor -r typecheck
```

For full regression coverage, follow the implementation plan. Limit workers on machines where concurrent Postgres fixtures cause timeouts. Do not run a build that removes `dist` while another test suite reads it. A unit/fixture pass does not replace live authentication, real provider behavior, visual QA, or multi-account manual tests.

## Evidence and release decision

Use one record per failed, blocked, or important passed case:

```text
Case and subcase:
Result: PASS / FAIL / BLOCKED / NOT RUN
Mode: fixture / live / durable restart
Source commit and local modifications:
Harbor and app build; Node version; OS; desktop/web/mobile:
Actor; bot ID; space/thread/invocation IDs:
Input or scenario file (synthetic data only):
Expected result:
Observed result and final invocation state:
Trigger count and any other request assertions:
Sanitized screenshot/log reference:
Reproduction steps and follow-up:
```

Release requires P0 passing against a real supported Greptile key, no unresolved secret/permission/thread-isolation failures, and no automatic duplicate review requests. Treat incomplete live authentication as blocked, not passed. Track separately whether GitLab, persistence, mobile, and packaging cases were exercised. Keep credentials, authorization headers, account dumps, and private repository content out of shared evidence.

## Cleanup

Stop the app and QA Harbor terminals. The fixture override disappears with its process; no production registry edit needs reverting. Stop the disposable database with `docker stop rowboat-greptile-qa-pg` if you created it. Keep the volume and sealing key together if you plan to resume; removing either can make retained test credentials unusable.

Revoke disposable live Greptile keys through Greptile and close or delete only the test PRs you created. Remove the temporary scenario and response files when no longer needed. Remove the dedicated container, volume, and sealing-key directory only when you intentionally discard this QA database. Do not remove unrelated Rowboat data or assume a bot-delete UI exists.
