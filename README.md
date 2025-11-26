![ui](/assets/banner.png)

<h5 align="center">

<p align="center" style="display: flex; justify-content: center; gap: 20px; align-items: center;">
  <a href="https://trendshift.io/repositories/13609" target="blank">
    <img src="https://trendshift.io/api/badge/repositories/13609" alt="rowboatlabs%2Frowboat | Trendshift" width="250" height="55"/>
  </a>
</p>

<p align="center">
  <a href="https://docs.rowboatlabs.com/" target="_blank" rel="noopener">
    <img alt="Docs" src="https://img.shields.io/badge/Docs-8b5cf6?labelColor=8b5cf6&logo=readthedocs&logoColor=white">
  </a>
  <a href="https://discord.gg/rxB8pzHxaS" target="_blank" rel="noopener">
    <img alt="Discord" src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white&labelColor=5865F2">
  </a>
  <a href="https://www.rowboatx.com/" target="_blank" rel="noopener">
    <img alt="Website" src="https://img.shields.io/badge/Website-10b981?labelColor=10b981&logo=window&logoColor=white">
  </a>
  <a href="https://www.youtube.com/@RowBoatLabs" target="_blank" rel="noopener">
    <img alt="YouTube" src="https://img.shields.io/badge/YouTube-FF0000?labelColor=FF0000&logo=youtube&logoColor=white">
  </a>
  <a href="https://www.linkedin.com/company/rowboat-labs" target="_blank" rel="noopener">
    <img alt="LinkedIn" src="https://custom-icon-badges.demolab.com/badge/LinkedIn-0A66C2?logo=linkedin-white&logoColor=fff">
  </a>
  <a href="https://x.com/intent/user?screen_name=rowboatlabshq" target="_blank" rel="noopener">
    <img alt="Twitter" src="https://img.shields.io/twitter/follow/rowboatlabshq?style=social">
  </a>
  <a href="https://www.ycombinator.com" target="_blank" rel="noopener">
    <img alt="Y Combinator" src="https://img.shields.io/badge/Y%20Combinator-S24-orange">
  </a>
</p>

# RowboatX - Claude Code for Everyday Automations
</h5>

- ✨ **Create background agents with full shell access**
   - E.g. "Generate a NotebookLM-style podcast from my saved articles every morning"
- 🔧 **Connect any MCP server to add capabilities**
   - Add MCP servers and RowboatX handles the integration
- 🎯 **Let RowboatX control and monitor your background agents**
   - Easily inspect state on the filesystem 

Inspired by Claude Code, RowboatX brings the same shell-native power to background automations.

## Quick start
```bash
npx @rowboatlabs/rowboatx@latest
```

## Demo
[![Screenshot](https://github.com/user-attachments/assets/ab46ff8b-44bd-400e-beb0-801c6431033f)](https://www.youtube.com/watch?v=cyPBinQzicY&t)

## Examples
### Add and Manage MCP servers 
`$ rowboatx`
- Add MCP: 'Add this MCP server config: \<config\> '
- Explore tools: 'What tools are there in \<server-name\> '

### Create background agents
`$ rowboatx`
- 'Create agent to do X.'
- '... Attach the correct tools from \<mcp-server-name\> to the agent'
- '... Allow the agent to run shell commands including ffmpeg'

### Schedule and monitor agents
`$ rowboatx`
- 'Make agent \<background-agent-name\> run every day at 10 AM' 
- 'What agents do I have scheduled to run and at what times'
- 'When was \<background-agent-name\> last run'
- 'Are any agents waiting for my input or confirmation'

### Run background agents manually
``` bash
rowboatx --agent=<agent-name> --input="xyz" --no-interactive=true
```
```bash    
rowboatx --agent=<agent-name> --run_id=<run_id> # resume from a previous run
```
## Models support
You can configure your models using:
```bash
rowboatx model-config
```

Alternatively, you can directly edit `~/.rowboat/config/models.json`
```json
{
  "providers": {
    "openai": {
      "flavor": "openai"
    },
    "lm-studio": {
      "flavor": "openai-compatible",
      "baseURL": "http://localhost:2000/...",
      "apiKey": "...",
      "headers": {
        "foo": "bar"
      }
    },
    "anthropic": {
      "flavor": "anthropic"
    },
    "google": {
      "flavor": "google"
    },
    "ollama": {
      "flavor": "ollama"
    }
  },
  "defaults": {
    "provider": "lm-studio",
    "model": "gpt-5"
  }
}
```
--- 
# Rowboat Studio - Cursor for Multi-agent Workflows

⚡ Build AI agents instantly with natural language | 🔌 Connect tools with one-click integrations | 📂 Power with knowledge by adding documents for RAG | 🔄 Automate workflows by setting up triggers and actions | 🚀 Deploy anywhere via API or SDK<br><br>

## Quick start
1. Set your OpenAI key
   ```bash
   export OPENAI_API_KEY=your-openai-api-key  
   ```
      
2. Clone the repository and start Rowboat (requires Docker)
   ```bash
   git clone git@github.com:rowboatlabs/rowboat.git
   cd rowboat
   ./start.sh
   ```

3. Access the app at [http://localhost:3000](http://localhost:3000).

To add tools, RAG, more LLMs, and  triggers checkout the [Advanced](#advanced) section below.
#### Create a multi-agent assistant with MCP tools by chatting with Rowboat
[![meeting-prep](https://github.com/user-attachments/assets/c8a41622-8e0e-459f-becb-767503489866)](https://youtu.be/KZTP4xZM2DY)

---

# Contributing

We'd love your help making Rowboat better! Join our 💬 [Discord](https://discord.com/invite/rxB8pzHxaS)
