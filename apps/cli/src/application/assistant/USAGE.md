Quick start

1. `cd rowboat-V2/apps/cli`
2. `export OPENAI_API_KEY=...`
3. `npm run copilot`

Example prompts once running:
- `list my workflows`
- `show workflow example_workflow`
- `create a workflow demo that calls function get_date`
- `add an agent step default_assistant to demo`
- `delete the demo workflow`

While the session is open the copilot keeps conversational context, so you can ask follow-ups such as “what was the first thing I asked?” or “add that step again”. Responses are natural language summaries of the structured actions it performs.

Need to inspect the underlying JSON command/results? Run in debug mode with `npm run copilot -- --debug` (or set `COPILOT_DEBUG=1`) to keep the raw interpreter output visible.
