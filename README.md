<h5 align="center">

<h1 align="center">Rowboat</h1>
<p align="center">A desktop AI coworker with a memory of your work and built-in surfaces to act on it.</p>

<p align="center" style="display: flex; justify-content: center; gap: 20px; align-items: center;">
  <a href="https://trendshift.io/repositories/13609" target="blank">
    <img src="https://trendshift.io/api/badge/repositories/13609" alt="rowboatlabs/rowboat | Trendshift" width="250" height="55"/>
  </a>
</p>

<p align="center">
    <a href="https://www.rowboatlabs.com/" target="_blank" rel="noopener">
    <img alt="Website" src="https://img.shields.io/badge/Website-10b981?labelColor=10b981&logo=window&logoColor=white">
  </a>
  <a href="https://discord.gg/wajrgmJQ6b" target="_blank" rel="noopener">
    <img alt="Discord" src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white&labelColor=5865F2">
  </a>
  <a href="https://x.com/intent/user?screen_name=rowboatlabshq" target="_blank" rel="noopener">
    <img alt="Twitter" src="https://img.shields.io/twitter/follow/rowboatlabshq?style=social">
  </a>
  <a href="https://www.ycombinator.com" target="_blank" rel="noopener">
    <img alt="Y Combinator" src="https://img.shields.io/badge/Y%20Combinator-S24-orange">
  </a>
</p>

</h5>

Rowboat indexes your work into a living knowledge graph and uses that to get work done on your machine. It includes work surfaces for collaborating with AI: email client, notes, browser, code mode, meeting note taker, and workspaces for different projects. 


Download latest for Mac/Windows/Linux: [Download](https://www.rowboatlabs.com/downloads)


<img width="1504" height="939" alt="Screenshot 2026-06-24 at 1 40 09 PM" src="https://github.com/user-attachments/assets/4b1a327d-7a68-4776-9bea-68da881b509f" />

⭐ If you find Rowboat useful, please star the repo. It helps more people find it.
[Demo](https://www.youtube.com/watch?v=7xTpciZCfpw)

---
## Overview

<table>
<tr>
<td width="40%" valign="middle">
<h3>Brain</h3>
Rowboat indexes email, meetings, slack and assistant conversations into a living Obsidian-style backlinked knowledge graph. 
</td>
<td width="60%">
<img width="1512" height="948" alt="Screenshot 2026-06-23 at 10 34 37 PM" src="https://github.com/user-attachments/assets/aa6cc14c-2ed7-418c-a949-531f8ca64b59" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Email</h3>
The built-in email client sorts emails into important and everything else. Rowboat automatically drafts responses for important email using all the work context.
</td>
<td width="60%">
<img width="1512" height="948" alt="Screenshot 2026-06-23 at 10 35 51 PM" src="https://github.com/user-attachments/assets/4392b3ca-cc4c-473a-849a-eea0e97388f2" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Background agents</h3>
You can set up background agents that run on events like new email or on schedule like every day at 8am. They can connect to tools, search the web, use the browser and write code using Claude Code or Codex.  
</td>
<td width="60%">
<img width="1512" height="951" alt="Screenshot 2026-06-23 at 10 44 11 PM" src="https://github.com/user-attachments/assets/5b73a3c3-f0d3-4151-83e7-0997457074e6" />

</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Built-in Browser</h3>
Rowboat includes a browser that lets you and assistant collaborate on web tasks. Because its isolated from your main browser, you can log in only to the accounts that want the assistant to access. 
</td>
<td width="60%">
<img width="1512" height="948" alt="Screenshot 2026-06-23 at 11 02 14 PM" src="https://github.com/user-attachments/assets/ce04871f-4477-40eb-8310-13ef7f125b11" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Meeting Notes</h3>
A local meeting note-taker that taps into mic & speaker, produces live transcript and summarizes the meeting in a markdown file and updates the knowledge graph. 
</td>
<td width="60%">
<img width="1512" height="947" alt="Screenshot 2026-06-23 at 11 47 02 PM" src="https://github.com/user-attachments/assets/c3729952-3c75-4c84-88e0-2a9070136502" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Code Mode</h3>
Code mode lets you spin up parallel coding agents with Claude Code or Codex, and have Rowboat drive them with all the work context where needed.
</td>
<td width="60%">
<img width="1512" height="949" alt="Screenshot 2026-06-24 at 12 02 31 AM" src="https://github.com/user-attachments/assets/306618b5-9aaf-4ef8-9117-91ea58e5e4e7" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Integrations</h3>
Includes one-click integrations to most popular products. 
</td>
<td width="60%">
<img width="1512" height="948" alt="Screenshot 2026-06-24 at 12 06 14 AM" src="https://github.com/user-attachments/assets/402e89db-8229-468a-8881-a763b9f20ad9" />
</td>
</tr>

</table>

---

## Installation

**Download latest for Mac/Windows/Linux:** [Download](https://www.rowboatlabs.com/downloads)

**All release files:**   https://github.com/rowboatlabs/rowboat/releases/latest

### Google setup
To connect Google services (Gmail, Calendar, and Drive), follow [Google setup](https://github.com/rowboatlabs/rowboat/blob/main/google-setup.md).

### Voice input
To enable voice input and voice notes (optional), add a Deepgram API key in `~/.rowboat/config/deepgram.json`

### Voice output

To enable voice output (optional), add an ElevenLabs API key in `~/.rowboat/config/elevenlabs.json`

### Web search

To use Exa research search (optional), add the Exa API key in `~/.rowboat/config/exa-search.json`

### External tools

To enable external tools (optional), you can add any MCP server or use Composio tools by adding an API key in `~/.rowboat/config/composio.json`

All API key files use the same format:
```
{
  "apiKey": "<key>"
}
```


## How it’s different

Most AI tools reconstruct context on demand by searching transcripts or documents.

Rowboat maintains **long-lived knowledge** instead:
- context accumulates over time
- relationships are explicit and inspectable
- notes are editable by you, not hidden inside a model
- everything lives on your machine as plain Markdown

The result is memory that compounds, rather than retrieval that starts cold every time.

## Bring your own model

Rowboat works with the model setup you prefer:
- **Local models** via Ollama or LM Studio
- **Hosted models** (bring your own API key/provider)
- Swap models anytime — your data stays in your local Markdown vault

## Extend Rowboat with tools (MCP)

Rowboat can connect to external tools and services via **Model Context Protocol (MCP)**.
That means you can plug in (for example) search, databases, CRMs, support tools, and automations - or your own internal tools.

Examples: Exa (web search), Twitter/X, ElevenLabs (voice), Slack, Linear/Jira, GitHub, and more.

## Local-first by design

- All data is stored locally as plain Markdown
- No proprietary formats or hosted lock-in
- You can inspect, edit, back up, or delete everything at any time

---
<div align="center">

[Discord](https://discord.gg/wajrgmJQ6b) · [Twitter](https://x.com/intent/user?screen_name=rowboatlabshq)
</div>
