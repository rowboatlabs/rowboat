# RowboatX Frontend

`apps/rowboatx` is the newer frontend for the local Rowboat runtime. It is a Next.js UI that renders chat, artifacts, tools, and resource views on top of a runtime provided by `apps/cli` or another host shell.

## What Lives Here

- Main chat/dashboard page in `app/page.tsx`
- Shared UI primitives and AI-oriented components under `components/`
- Static export configuration in `next.config.ts`

## Runtime Expectations

This frontend is not self-contained. It expects one of the following to exist at runtime:

- `window.config.apiBase` for direct backend requests
- `/api/stream` for SSE run events
- `/api/rowboat/*` endpoints for local resource browsing and editing

In practice, this means the UI is meant to be served by a shell or proxy that also provides the local runtime APIs.

## Local Development

```bash
npm install
npm run dev
```

Build the static export:

```bash
npm run build
```

## Notes For Contributors

- Changes here should preserve the assumption that the backend lives outside this app.
- If you add a new runtime endpoint, document the expected contract in the host surface that provides it.
- For repo-level ownership and status, see the root `ARCHITECTURE.md`.
