# Replicas in Spaces

## Setup

Build and deploy Harbor before the updated Rowboat client. Migration `025-replicas-threads` adds connection and task storage; no existing messages or personal Replicas settings are migrated.

Set `HARBOR_INTEGRATION_KEY` on Harbor to a stable 32-byte random key encoded as 64 hexadecimal characters. Keep it in the deployment secret manager and back it up. `HARBOR_INTEGRATION_KEY_ID` identifies that wrapping key (default `primary`; letters, digits, underscores and hyphens). Credentials use a versioned AES-256-GCM envelope containing the key id, with the org id and agent member id as associated data. No credential is sent to the coding workspace or returned by the API.

To rotate the wrapping key, give the new key a new `HARBOR_INTEGRATION_KEY_ID` and set `HARBOR_INTEGRATION_KEY` to its value. Retain old keys in `HARBOR_INTEGRATION_PREVIOUS_KEYS`, a JSON object mapping old ids to their 64-character hex keys. Existing connections remain readable. Re-enter the Replicas org API key in Settings to seal it with the active wrapping key, retaining the same agent member and task history. Retire an old wrapping key only after every org connection using it has been re-sealed. Never change a wrapping key's value while reusing its id.

An organization admin opens a shared Space, chooses **Replicas → Settings** above the composer, and connects a Replicas **org API key**, not a personal key. There is one Replicas agent member per org, created through `createAgent`, with ordinary memberships in the Spaces it joins. The API key and default coding agent belong to that member; replacing either affects all its Spaces. Each (agent, Space) pair has its own default environment and enabled setting. Connecting another Space reuses the existing agent and key. Key entry and replacement are Settings-only: `configure_replicas` can update defaults and enable/disable an existing connection, but does not accept `apiKey`.

Everyone sharing a Space with the agent can invoke it, including through a DM. Usage is billed to the connected Replicas account. API-key workspaces have no attached requester identity: with an org key, commits, pushes and PRs are attributed to the Replicas bot. Harbor includes “Requested by <name>, <thread link>” instructions for PR descriptions on every request. A personal key can make teammates' PRs appear authored by the admin, so do not use one for this shared connection. Replicas orgs with **Require PR user attribution** enabled must allow bot-attributed API work, or workspace creation fails. Per-member credentials or account linking are needed for individual upstream attribution; neither is implemented here.

Choose **Ask Replicas** or select the Replicas member in the mention picker. Pick an environment, use `[env:name]`, or allow the configured default/single environment. When selection is ambiguous, the thread asks for an environment and waits. **Plan first** and `/plan` request a plan; a later addressed “proceed” continues the same conversation. Ask questions and request changes in the same thread. **Fork task** creates another feature thread with source context. A direct message to the agent works while the requester shares at least one shared Space with it. DMs have no inherited Space environment default: use the picker, `[env:name]`, the only available environment, or the prompt in the thread.

## Operation and recovery

The worker runs on Harbor every three seconds, with at most eight threads progressing concurrently and one active request per thread. Deployment startup restores org runtimes so pending results do not depend on a client reconnecting. Graceful shutdown waits for the current bounded API requests. The existing single-instance Harbor restriction applies.

State, queue, bindings, and delivery checkpoints are durable Postgres records. Results use ordinary message notifications. Repeated read failures leave the active task intact and visible as reconnecting. A definitively rejected request can be retried after correcting the cause. An interrupted write is **uncertain** because the upstream API does not document idempotent writes: inspect Replicas, then supply its workspace id and chat id with **Resume tracking**. This resumes observation without resending the request. Do not attach an unrelated conversation: the worker waits for the original request marker.

**Cancel queued request** removes your request from the queue without deleting the conversation. Running requests cannot be stopped through the public Replicas API; use **Open in Replicas** to manage them in the Replicas app. Deleting a queued source message also prevents dispatch.

**Disconnect** pauses future delivery and observation in that Space; it does not terminate or delete running Replicas workspaces. Results catch up when the Space connection is enabled again. Other connected Spaces and DMs are unaffected. To revoke a member’s DM invocation rights, they must no longer share any shared Space with the agent. Existing personal Rowboat Replicas tools continue to serve private chats; Spaces uses the shared Harbor path.

## Compatibility boundary

The integration uses Replicas' public workspace, send-message, environments, and persisted-history APIs. It matches the shared thread workflow, not the proprietary Slack Mothership service. Proactive channel triage and monitoring presets, semantic mute/unmute, Slack-style personal account linking, cross-channel forks, PR merge/close webhooks, custom emoji selection, and automation suggestions are not provided by this bridge. Spaces currently has two-person DMs rather than Slack group DMs.

Images in the same Space (PNG/JPEG/GIF/WebP) are forwarded as authenticated bytes, limited to ten images and 20 MB per request. External image URLs and non-image attachments remain links; they are not automatically downloadable by a cloud VM. Provider history is supported through standard provider events and Codex ASP turns. An upstream URL is displayed when supplied; otherwise the UI links to the Replicas dashboard rather than guessing a deep link.

References: [Slack behavior](https://docs.replicas.dev/features/slack), [create](https://docs.replicas.dev/api-reference/replica/create-replica), [send](https://docs.replicas.dev/api-reference/replica/send-message), [history](https://docs.replicas.dev/api-reference/replica/read-history).
