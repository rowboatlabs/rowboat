# Running Rowboat (Headless) in Docker

You can run the core agent logic of Rowboat in a Docker container, suitable for server environments or always-on agents.

## Build

From the `apps/x` directory:

```bash
docker build -t rowboat-agent .
```

## Run

You need to mount a volume for the data directory (`~/.rowboat`) to persist your knowledge graph and credentials.

```bash
docker run -d \
  --name rowboat \
  -v $(pwd)/rowboat-data:/data/.rowboat \
  rowboat-agent
```

## Configuration

The agent uses the configuration files in your data volume (`/data/.rowboat/config/`).
If you are starting fresh, you may need to manually populate `models.json` or `config.json` in that volume, as there is no UI to guide you through onboarding in this headless mode.

### Environment Variables

You can inject API keys via environment variables which Rowboat will pick up (if configured to read them):

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`
```
