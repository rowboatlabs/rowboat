<a href="https://www.youtube.com/watch?v=5AWoGo-L16I" target="_blank" rel="noopener noreferrer">
  <img width="1339" height="607" alt="rowboat-github-2" src="https://github.com/user-attachments/assets/fc463b99-01b3-401c-b4a4-044dad480901" />
</a>

<h5 align="center">

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

# Rowboat  
**Open-source alternative to Claude Desktop that builds a knowledge graph from work.**

</h5>

Rowboat turns your work into a living, editable knowlege graph and has built-in 'work-surfaces' for effective human-AI collaboration.

Brain

Download latest for Mac/Windows/Linux: [Download](https://www.rowboatlabs.com/downloads)

⭐ If you find Rowboat useful, please star the repo. It helps more people find it.

## Demo
[![Demo](https://github.com/user-attachments/assets/8b9a859b-d4f1-47ca-9d1d-9d26d982e15d)](https://www.youtube.com/watch?v=7xTpciZCfpw)

[Watch the full video](https://www.youtube.com/watch?v=7xTpciZCfpw)

---
## Features

<table>
<tr>
<td width="40%" valign="middle">
<h3>Brain</h3>
Rowboat indexes email, meetings, slack and assistant conversations into a living Obsidian-style backlined knowledge graph. 
</td>
<td width="60%">
<img width="1512" height="948" alt="Screenshot 2026-06-23 at 10 34 37 PM" src="https://github.com/user-attachments/assets/aa6cc14c-2ed7-418c-a949-531f8ca64b59" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Email</h3>
The built-in email client sorts emails into important and everthing else. Rowboat automatically drafts responses for important email using all the work context.
</td>
<td width="60%">
<img width="1512" height="948" alt="Screenshot 2026-06-23 at 10 35 51 PM" src="https://github.com/user-attachments/assets/4392b3ca-cc4c-473a-849a-eea0e97388f2" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Background agents</h3>
You can setup background agents that run on events like new email or on schedule like very day at 8am. They can connect to tools, search the web, use the browser and write code using Claude Code or Codex.  
</td>
<td width="60%">
<img width="1512" height="951" alt="Screenshot 2026-06-23 at 10 44 11 PM" src="https://github.com/user-attachments/assets/5b73a3c3-f0d3-4151-83e7-0997457074e6" />

</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Built-in Browser</h3>
Rowboat includes an browser that lets you and assistant collaborate on web tasks. Because its isolated from your main browser, you can log in only to the accounts that want the assistant to access. 
</td>
<td width="60%">
<img width="1512" height="948" alt="Screenshot 2026-06-23 at 11 02 14 PM" src="https://github.com/user-attachments/assets/ce04871f-4477-40eb-8310-13ef7f125b11" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>SSH</h3>
<code>cmux ssh user@remote</code> creates a workspace for a remote machine. Browser panes route through the remote network so localhost just works. Drag an image into a remote session to upload via scp.
</td>
<td width="60%">
<img src="./docs/assets/ssh.png" alt="cmux SSH" width="100%" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Claude Code Teams</h3>
<code>cmux claude-teams</code> runs Claude Code's teammate mode with one command. Teammates spawn as native splits with sidebar metadata and notifications. No tmux required.
</td>
<td width="60%">
<img src="./docs/assets/claude-code-teams.png" alt="Claude Code Teams" width="100%" />
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

## What it does

Rowboat is a **local-first AI coworker** that can:
- **Remember** the important context you don’t want to re-explain (people, projects, decisions, commitments)
- **Understand** what’s relevant right now (before a meeting, while replying to an email, when writing a doc)
- **Help you act** by drafting, summarizing, planning, and producing real artifacts (briefs, emails, docs, PDF slides)

Under the hood, Rowboat maintains an **Obsidian-compatible vault** of plain Markdown notes with backlinks — a transparent “working memory” you can inspect and edit.

## Integrations

Rowboat builds memory from the work you already do, including:
- **Gmail** (email)
- **Google Calendar** 
- **Rowboat meeting notes** or **Fireflies**

It also contains a library of product integrations through Composio.dev

## How it’s different

Most AI tools reconstruct context on demand by searching transcripts or documents.

Rowboat maintains **long-lived knowledge** instead:
- context accumulates over time
- relationships are explicit and inspectable
- notes are editable by you, not hidden inside a model
- everything lives on your machine as plain Markdown

The result is memory that compounds, rather than retrieval that starts cold every time.

## What you can do with it

- **Meeting prep** from prior decisions, threads, and open questions
- **Email drafting** grounded in history and commitments
- **Docs & decks** generated from your ongoing context (including PDF slides)
- **Follow-ups**: capture decisions, action items, and owners so nothing gets dropped
- **On-your-machine help**: create files, summarize into notes, and run workflows using local tools (with explicit, reviewable actions)

## Live notes

Live notes are notes that stay updated automatically. You can create one by typing '@rowboat' on a note. 

- Track a competitor or market topic across X, Reddit, and the news
- Monitor a person, project, or deal across web or your communications
- Keep a running summary of any subject you care about

Everything is written back into your local Markdown vault. You control what runs and when.

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
