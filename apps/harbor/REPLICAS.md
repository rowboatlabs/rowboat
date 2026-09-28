# Replicas in Spaces

## Setup

Build and deploy Harbor before the updated Rowboat client. Migration `023-replicas-threads` adds connection and task storage; no existing messages or personal Replicas settings are migrated.

Set `HARBOR_INTEGRATION_KEY` on Harbor to a stable 32-byte random key encoded as 64 hexadecimal characters. Keep it in the deployment secret manager and back it up: changing it without re-encrypting connections makes existing credentials unreadable. Each connection is encrypted with the Space id as associated data. No key is sent to the coding workspace or returned by the API.

An organization admin opens a shared Space, chooses **Replicas → Settings** above the composer, and connects a Replicas API key. This explicitly shares use of that account with Space members. Replicas environments, model credentials, billing, and code-host attribution belong to that account. A personal key is still a personal upstream identity even when teammates send requests through the Space; use an organization account when that is the intended attribution.

Choose **Ask Replicas** or select the Replicas member in the mention picker. Pick an environment, use `[env:name]`, or allow the configured default/single environment. When selection is ambiguous, the thread asks for an environment and waits. **Plan first** and `/plan` request a plan; a later addressed “proceed” continues the same conversation. Ask questions and request changes in the same thread. **Fork task** creates another feature thread with source context. A direct message to the integration member also works for members of its source Space.

## Operation and recovery

The worker runs on Harbor every three seconds, with at most eight threads progressing concurrently and one active request per thread. Deployment startup restores org runtimes so pending results do not depend on a client reconnecting. Graceful shutdown waits for the current bounded API requests. The existing single-instance Harbor restriction applies.

State, queue, bindings, and delivery checkpoints are durable Postgres records. Results use ordinary message notifications. Repeated read failures leave the active task intact and visible as reconnecting. A definitively rejected request can be retried after correcting the cause. An interrupted write is **uncertain** because the upstream API does not document idempotent writes: inspect Replicas, then supply its workspace id and chat id with **Resume tracking**. This resumes observation without resending the request. Do not attach an unrelated conversation: the worker waits for the original request marker.

**Disconnect** pauses future delivery and observation; it does not terminate or delete running Replicas workspaces. Results catch up when the connection is enabled again. Existing personal Rowboat Replicas tools continue to serve private chats; Spaces uses the shared Harbor path.

## Compatibility boundary

The integration uses Replicas' public workspace, send-message, environments, and persisted-history APIs. It matches the shared thread workflow, not the proprietary Slack Mothership service. Proactive channel triage and monitoring presets, semantic mute/unmute, Slack-style personal account linking, cross-channel forks, PR merge/close webhooks, custom emoji selection, and automation suggestions are not provided by this bridge. Spaces currently has two-person DMs rather than Slack group DMs.

Images in the same Space (PNG/JPEG/GIF/WebP) are forwarded as authenticated bytes, limited to ten images and 20 MB per request. External image URLs and non-image attachments remain links; they are not automatically downloadable by a cloud VM. Provider history is supported through standard provider events and Codex ASP turns. An upstream URL is displayed when supplied; otherwise the UI links to the Replicas dashboard rather than guessing a deep link.

References: [Slack behavior](https://docs.replicas.dev/features/slack), [create](https://docs.replicas.dev/api-reference/replica/create-replica), [send](https://docs.replicas.dev/api-reference/replica/send-message), [history](https://docs.replicas.dev/api-reference/replica/read-history).
