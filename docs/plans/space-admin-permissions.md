# Space administration and organization oversight

Implementation proposal, 2026-11-25. This document describes a proposed change, not current permissions. No runtime or production permission changes are part of this planning branch.

## Outcome

A person can administer one shared space without becoming an organization admin. Organization roles remain independent. A space role never grants access to an agent's credentials, configuration, hosting, or connections.

Keep the existing settings layout and agent-management screens. This is permissions work, not a separate human-UX redesign.

## Current constraints

- `Member.role` is the organization role. `Membership` currently contains only `spaceId`, `memberId`, and `joinedAt`.
- Migration 067 removed per-space membership roles. Do not edit that migration or assume historical space admins can be reconstructed.
- `Spaces.setMemberRole` and the role dropdown in Space settings currently change organization roles. Reusing that operation for space roles would escalate privileges incorrectly.
- The sidebar/header use the organization roster to decide whether to show Settings. The settings page also checks the member's organization role.
- Some operations, including rename and adding members, currently permit ordinary members. Moving them behind space administration is a deliberate behavior change that must apply to every API and client entry point.
- Agent policy already distinguishes owner-only operations from explicit organization-admin powers. Preserve those distinctions; do not introduce a general `isAdmin` check that includes space admins in agent-management policy.

## Proposed permission boundary

| Operation | Space admin | Organization admin | Ordinary space member |
| --- | --- | --- | --- |
| Rename, archive/restore, change space visibility | Yes, in their space | Yes, where already a space member | No |
| Add/remove space members; assign/revoke space-admin roles | Yes, in their space | Yes, where already a space member | No |
| Add/remove an agent's participation in the space | Yes, subject to existing agent eligibility and owner/personal restrictions | Same restrictions | No direct membership management |
| Permanently delete a space | No by default | Yes, with existing confirmation and access checks | No |
| Change organization roles, invitation policy, default-space policy, or organization membership | No | Existing organization-admin rules | No |
| Read a private space or a DM | Existing membership rules | Existing membership rules; no automatic content access | Existing membership rules |
| Change agent credentials, configuration, connections, or hosting | No additional powers | Existing explicitly allowed organization-admin operations only | Agent ownership rules remain applicable |
| Enable the space knowledge graph | No by default | Existing organization-admin rule, since this sends content to an external service | No |

Open-space discovery, self-join, message posting, and reading stay governed by their existing policies. Invitations must obey both organization invite policy and target-space policy; define and test each space-bound invitation route rather than changing the organization invite flow accidentally. DMs have no space-admin role.

Deletion and graph enablement are proposed organization-only exceptions, not assumptions that the existing implementation already follows. Confirm these product choices before implementation.

## 1. Add a separate space role

Add `spaceRole: 'member' | 'admin'` to memberships, keeping `Member.role` for organization roles. Use a distinct field on space-roster responses so merging member profiles into caches cannot overwrite either role. Avoid a default that silently promotes anyone when older data lacks the field.

Add an append-only migration after the current latest migration. Use `(org_id, space_id, member_id)` for all membership reads, writes, constraints, and backfills. Keep migration logic compatible with both PostgreSQL and PGlite.

For existing shared spaces, initialize memberships as ordinary members. Existing organization admins keep their authorized administration path; they can explicitly assign local admins. Produce a read-only inventory of spaces with no local admin for rollout review. Do not infer ownership from the first participant, oldest ID, or message history.

For new shared spaces, assign the human creator as the initial space admin. An agent must not receive an admin role. Agent-created spaces need an explicit policy: preferably assign the active human owner only when that owner is enrolled through the authorized creation flow; otherwise leave assignment to an organization admin. Preserve the special rules for the permanent general space.

## 2. Enforce authorization and lifecycle invariants in Harbor

Implement a policy helper that takes separate organization-role and space-membership facts. Apply it to the intended space operations in `core/spaces.ts` and their policy functions. Keep ordinary read/write membership gates and archived-space restrictions.

Add a separate `setSpaceMemberRole` service operation and route. Leave `setMemberRole` explicitly organization-wide. Require a live human target membership in the same organization and shared space. A local admin cannot assign organization roles, grant agent-admin roles, or act in another space.

Serialize the authorization read and mutation under the appropriate space transaction/lock. Recheck permissions inside the transaction: an admin demoted while a dialog is open must not retain write authority.

Protect the last active local admin from ordinary demotion, removal, or voluntary departure. Cover concurrent changes, not just a UI-disabled button. Organization account removal/deactivation remains possible for security reasons; it may orphan a space, which must enter the explicit recovery path. Migrated spaces with no local admin must remain recoverable.

Organization-admin recovery should assign an existing active human member to administer an orphaned shared space without granting the recovering admin content access or silently joining them. Give recovery its own narrowly scoped policy, audit record, and tests. Never apply it to DMs.

Audit indirect membership paths: invites/bind, self-join, adding agents through the Agents dialog or mentions, super-agent creation, organization removal, and default-space enrollment. Any exception to space-admin management must be deliberate and documented. Space admin authority cannot override a personal agent's owner restriction.

## 3. Expose consistent HTTP, MCP, events, and client contracts

Update protocol schemas, HTTP routing, the service facade, MCP tools, and the spaces client together. The new role operation must be clearly described as affecting one space; organization-role tools retain their current meaning.

Publish a durable space-role event and a live invalidation/update for the relevant roster. Inspect the existing `role_changed` event before reuse: older event schemas may strip unknown membership fields. Do not replay historical space-role events as organization-role changes.

Update IPC types and handlers. Separate organization-member cache updates from space-membership updates. On demotion/removal, immediately refresh or revoke the current settings view and its pending actions.

## 4. Connect existing UI to the new capability

Use one shared capability calculation for the space sidebar, context menu, header entry, settings page, and action buttons. Local admins see space-management controls; organization-only actions remain absent or read-only with a clear explanation.

In Space settings → People, label the new selector **Space role** and call only the new space-role API. Organization roles remain in organization management, not an ambiguously labeled selector on a space page.

Preserve the existing agent-management screen. Show participation controls only where authorized; do not restore duplicated agent credential/access settings to space rows. A user's own agent-management permissions remain independent of their role in the space.

Desktop and web share the renderer, but mobile has separate views and caches. Include equivalent mobile capability handling and space-role management in the implementation scope, or explicitly document and track a coordinated follow-up before release. Direct URLs and retained dialogs must fail safely on every client.

## 5. Verification

- Migration: populated multi-org database and fresh install; no accidental promotions; general/DM behavior; old migrations remain unchanged.
- Wire tests: ordinary member, local admin, organization admin, nonmember, agent owner, non-owner, removed member, and personal agent cases. Assert forbidden requests leave no state or audit changes.
- Isolation: a space admin cannot change organization roles, another space's roles, private-space content access, or agent secrets/configuration.
- Lifecycle: promotion/demotion, last-admin concurrency, leave/removal/deactivation, orphan recovery, idempotency, and live revocation.
- Integration: new role mutation through HTTP and MCP, IPC/client round-trip, correctly scoped events and cache refresh.
- UI: local-admin entry visibility, direct-URL guards, organization-only exceptions, correctly labeled role changes, and unchanged agent-management permissions on web/desktop/mobile.
- Compatibility: old/new roster and event schemas, archived spaces, existing invitation flows, and no default privilege escalation.
- Run Harbor typechecks and relevant server/protocol suites, rebuild linked packages, then renderer/mobile checks and the repository's required CI. Test on disposable data before any production rollout.

## 6. Delivery sequence

1. Agree on the matrix exceptions and orphan-recovery policy; document the product rules in SPEC.md.
2. Ship additive storage/protocol/server support with tests and dated CONTRACT.md changes. Keep delegated authority behind a rollout gate until compatible clients are available.
3. Ship client capability handling, role controls, cache/event handling, and mobile parity. Preserve a server rejection path for older clients.
4. Review the existing-space inventory. Organization admins assign space admins explicitly; do not auto-promote the requester or mutate live roles as part of development.
5. Enable delegated authority on a disposable/test organization, verify the negative permission cases, then release deliberately.

Rollback disables delegated space-admin authority while retaining the additive membership data for recovery. Do not drop the new role column or rewrite historical events. Document the minimum client/server versions before enabling the rollout gate.
