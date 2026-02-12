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
**Open-source AI coworker that turns work into a knowledge graph and acts on it**

</h5>

Rowboat connects to your email and meeting notes, builds a long-lived knowledge graph, and uses that context to help you get work done - privately, on your machine.

You can do things like:
- `Build me a deck about our next quarter roadmap` → generates a PDF using context from your knowledge graph
- `Prep me for my meeting with Alex` → pulls past decisions, open questions, and relevant threads into a crisp brief (or a voice note)
- Visualize, edit, and update your knowledge graph anytime (it’s just Markdown)
- Record voice memos that automatically capture and update key takeaways in the graph

Download latest for Mac/Windows/Linux: [Download](https://www.rowboatlabs.com/downloads)


## Demo


[![Demo](https://github.com/user-attachments/assets/3f560bcf-d93c-4064-81eb-75a9fae31742)](https://www.youtube.com/watch?v=5AWoGo-L16I)

[Watch the full video](https://www.youtube.com/watch?v=5AWoGo-L16I)

---

## Installation

**Download latest for Mac/Windows/Linux:** [Download](https://www.rowboatlabs.com/downloads)

**All release files:**   https://github.com/rowboatlabs/rowboat/releases/latest

### Google setup
To connect Google services (Gmail, Calendar, and Drive), follow [Google setup](https://github.com/rowboatlabs/rowboat/blob/main/google-setup.md).

### Voice notes
To enable voice notes (optional), add a Deepgram API key in ~/.rowboat/config/deepgram.json:
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
- **Granola** (meeting notes)
- **Fireflies** (meeting notes)

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

## Background agents

Rowboat can spin up **background agents** to do repeatable work automatically - so routine tasks happen without you having to ask every time.

Examples:
- Draft email replies in the background (grounded in your past context and commitments)
- Generate a daily voice note each morning (agenda, priorities, upcoming meetings)
- Create recurring project updates from the latest emails/notes
- Keep your knowledge graph up to date as new information comes in

You control what runs, when it runs, and what gets written back into your local Markdown vault.

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


## Looking for Rowboat Web Studio?

If you’re looking for Rowboat web Studio, start [here](https://docs.rowboatlabs.com/). 

---
<div align="center">

[Discord](https://discord.gg/wajrgmJQ6b) · [Twitter](https://x.com/intent/user?screen_name=rowboatlabshq)
</div>
