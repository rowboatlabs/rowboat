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
**开源 AI 同事：把你的工作沉淀成一张知识图谱，并据此行动**

</h5>

[English](./README.md) | 简体中文

Rowboat 接入你的邮箱和会议记录，构建一张可长期演进的知识图谱，并基于这些上下文协助你完成工作 —— 全程在本地、私密运行。

你可以这样用它：
- `帮我做一份下个季度路线图的演示稿` → 结合知识图谱里的上下文，直接生成 PDF
- `帮我准备和 Alex 的会议` → 把过去的决定、悬而未决的问题、相关讨论汇总成一份简明的会前 brief（也可以是语音版）
- 跟踪某个人、公司或话题，并持续更新一份"实时笔记"
- 随时查看、编辑、更新你的知识图谱（其实就是 Markdown 文件）
- 录制语音备忘录，关键要点会自动沉淀进图谱

Mac/Windows/Linux 下载最新版：[Download](https://www.rowboatlabs.com/downloads)

⭐ 如果觉得 Rowboat 有用，欢迎 star 这个仓库,可以帮助更多人发现它。

## Demo
[![Demo](https://github.com/user-attachments/assets/8b9a859b-d4f1-47ca-9d1d-9d26d982e15d)](https://www.youtube.com/watch?v=7xTpciZCfpw)

[查看完整视频](https://www.youtube.com/watch?v=7xTpciZCfpw)

---

## 安装

**Mac/Windows/Linux 下载最新版：** [Download](https://www.rowboatlabs.com/downloads)

**所有发布版本：**   https://github.com/rowboatlabs/rowboat/releases/latest

### 接入 Google 服务
要连接 Gmail、Calendar、Drive 等 Google 服务，请参考 [Google setup](https://github.com/rowboatlabs/rowboat/blob/main/google-setup.md)。

### 语音输入
启用语音输入和语音笔记（可选），在 `~/.rowboat/config/deepgram.json` 中填入 Deepgram API key。

### 语音输出

启用语音输出（可选），在 `~/.rowboat/config/elevenlabs.json` 中填入 ElevenLabs API key。

### 网页搜索

使用 Exa research 搜索（可选），在 `~/.rowboat/config/exa-search.json` 中填入 Exa API key。

### 外部工具

启用外部工具（可选），你可以接入任意 MCP server，或者通过在 `~/.rowboat/config/composio.json` 中填入 API key 使用 Composio 工具。

所有 API key 文件统一使用以下格式：
```
{
  "apiKey": "<key>"
}
```

## 它能做什么

Rowboat 是一款 **本地优先（local-first）的 AI 同事**，它可以：
- **记住** 你不想反复解释的重要上下文（人、项目、决策、承诺）
- **理解** 当前这一刻什么信息真正相关（开会前、回邮件时、写文档时）
- **协助你行动**：起草、总结、规划，并生成真实可交付的产物（brief、邮件、文档、PDF 演示稿）

底层上，Rowboat 维护着一个 **与 Obsidian 兼容** 的纯 Markdown 笔记仓库，带双向链接 —— 这是一份可检视、可编辑的"工作记忆"，没有黑箱。

## 集成

Rowboat 会从你日常的工作中持续构建记忆，包括：
- **Gmail**（邮件）
- **Google Calendar**
- **Rowboat 自家的会议记录** 或 **Fireflies**

此外，还可以通过 Composio.dev 接入大量产品级集成。

## 它有什么不同

大多数 AI 工具靠"现搜现答"来临时拼凑上下文，每次都要重新检索文档或会议记录。

Rowboat 选的是另一条路 —— **持续沉淀长期知识**：
- 上下文随时间积累
- 关系是显式的，可以一眼看清
- 笔记由你编辑，而不是被模型藏在内部
- 所有内容都以纯 Markdown 形式保存在你自己的机器上

最终的效果是：记忆在复利式增长，而不是每次都从零开始检索。

## 你可以用它做这些事

- **会议准备**：基于过去的决定、讨论串和悬而未决的问题生成 brief
- **邮件起草**：基于历史记录和承诺撰写，不会前后矛盾
- **文档和演示稿**：从你正在进行的上下文中生成（包括 PDF 演示稿）
- **跟进事项**：记录决定、行动项和责任人，不让事情漏掉
- **本机协助**：创建文件、把内容整理进笔记、用本地工具运行工作流（每一步都明确、可审阅）

## 实时笔记 (Live notes)

实时笔记是一种会自动更新的笔记。在任意笔记中输入 `@rowboat` 就可以创建一篇。

- 跨 X、Reddit、新闻持续跟踪某个竞品或市场话题
- 跨网页和你的通讯记录监控某个人、项目或机会
- 为任何你关心的主题维护一份持续滚动的摘要

所有内容都会写回到你本地的 Markdown 仓库。运行什么、何时运行，完全由你掌控。

## 自带模型（Bring your own model）

Rowboat 适配你偏好的任何模型组合：
- **本地模型**：通过 Ollama 或 LM Studio
- **托管模型**：自带 API key / 服务商
- 模型可以随时切换 —— 你的数据始终留在本地 Markdown 仓库里

## 用 MCP 扩展 Rowboat

Rowboat 可以通过 **Model Context Protocol (MCP)** 连接外部工具和服务。
也就是说，你可以接入（比如）搜索、数据库、CRM、客服系统、自动化工具 —— 也可以接入你自己内部的工具。

示例：Exa（网页搜索）、Twitter/X、ElevenLabs（语音）、Slack、Linear/Jira、GitHub 等。

## 本地优先（Local-first）的设计

- 所有数据以纯 Markdown 形式存储在本地
- 没有专有格式，也不存在被托管服务锁死的风险
- 你可以随时检视、编辑、备份或删除任何数据

---
<div align="center">

[Discord](https://discord.gg/wajrgmJQ6b) · [Twitter](https://x.com/intent/user?screen_name=rowboatlabshq)
</div>
