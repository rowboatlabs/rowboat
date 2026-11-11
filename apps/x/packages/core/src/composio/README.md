# Composio transport

The signed-in desktop uses the billing backend's `/v1/composio` routes with a Supabase bearer token. The backend replaces the connection user ID with the authenticated subject. Signed-out users supply their own project key and call Composio v3.1 directly with `rowboat-user` as their entity ID.

Since 2026-11-11, managed OAuth uses [`POST /connected_accounts/link`](https://docs.composio.dev/reference/api-reference/connected-accounts/postConnectedAccountsLink). The desktop opens `redirect_url`, saves `connected_account_id`, and verifies the account status after its loopback callback. The link token is not stored locally. Existing connection IDs remain valid. Deploy the backend's link route before releasing this desktop client; its compatibility adapter supports older clients.

Tool search requests `toolkit_versions=latest`, matching execution's `version=latest`. Multiple toolkit filters are comma-separated. Explicit execution versions are preserved. Pagination accepts an omitted terminal cursor, connection status includes `REVOKED`, and error parsing accepts current structured Composio errors as well as legacy error codes.

The backend wire contract is documented in [`rowboatx-backend/packages/api/README.md`](https://github.com/rowboatlabs/rowboatx-backend/blob/main/packages/api/README.md#composio-v1composio).
