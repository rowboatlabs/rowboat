# Rowboat Web App

`apps/rowboat` is the hosted or self-hosted Next.js application in this repository. It is the server-backed Rowboat surface with project-scoped conversations, data sources, jobs, integrations, billing hooks, and RAG infrastructure.

## What Lives Here

- Next.js 15 App Router application
- Project and conversation APIs under `app/api`
- Dependency injection container in `di/container.ts`
- Layered backend code under `src/application`, `src/entities`, `src/infrastructure`, and `src/interface-adapters`
- Background workers for jobs and RAG ingestion in `app/scripts`

## Local Development

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Useful commands:

```bash
npm run verify
npm run build
npm run lint
npm run typecheck
npm run rag-worker
npm run jobs-worker
npm run setupQdrant
npm run deleteQdrant
```

## Infrastructure Dependencies

This app can depend on several services, depending on the features you enable:

- MongoDB for primary application data
- Redis for caching, pub/sub, and job coordination
- Qdrant for vector search
- Local uploads or S3 for document storage
- External model providers and integrations configured through environment variables

The root `docker-compose.yml` is the easiest way to see the expected service topology.

## Environment

Start from the repository `.env.example` and add the services you need. Common feature flags include auth, RAG, uploads, scraping, billing, and chat widget support.

## Architectural Notes

- Route handlers stay thin and resolve controllers from the DI container.
- Use cases and repositories are split by domain.
- Workers in `app/scripts` handle asynchronous processing such as document ingestion and recurring jobs.

If you are trying to understand where a feature belongs in the repo, read the root `ARCHITECTURE.md` first.
