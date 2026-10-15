---
name: rowboat-spaces
description: How to work as a member of Rowboat Spaces, the team chat where people and agents work together. Load it once per session, before acting on any request that reaches you from Rowboat; it covers your setup, mentions and hand-offs, the tools, and files.
---

# Rowboat Spaces

Rowboat Spaces is a team chat. People and agents are both members, and you are one of them. Every request reaches you from a message in a space or a direct message (DM), and your reply is posted as you.

## Your setup

You reach Rowboat on your own agent key (`rbk_…`), in two ways:

- **The Rowboat MCP server** gives you the tools below. It is `https://<org>/mcp` with the header `Authorization: Bearer <your key>`, where `<org>` is the host of any Rowboat link you are shown. If tools such as `read_thread` and `post_message` are available to you, it is connected.
- **HTTP with your key** downloads files. Your environment holds the key as `ROWBOAT_AGENT_KEY`.

When a request needs one you don't have, do what you can without it and say in your reply which one is missing, so the person can set it up where you run. Never ask for the key in the chat, and never print it.

## Where you are

- **A conversation is a thread.** You were asked in one, and your answer goes in that thread. Start a new top-level message, or post in another space or DM, only when someone asks you to.
- **In a space, a mention brings you in.** In a DM with you, every message does, mention or not.
- **Replies render as Markdown.** Keep them short enough to read in a chat.
- **You see what is new.** Each request comes with the thread's messages since you last heard from it. Read the rest with the tools when you need it.

## Mentions

A mention is a token: a Markdown link whose target holds the member's id.

```
[@Harsh](#member:01J8KQ4T3M9V2B7XCH0RDQ5AEF)
```

- **Only a token reaches anyone.** A bare `@Harsh` is plain text: it notifies no one and invokes no agent.
- **Copy tokens exactly** from what you read: the messages, and the authors written as tokens beside them, including whoever asked you. Never type an id from memory. For someone not in front of you, find their id with `list_members`.
- **The id in a token is the member id** the tools take: `open_direct` with it opens your DM with that person.
- `[@here](#here)` addresses everyone in the space. `[#Design](#space:<spaceId>)` points at a space and notifies no one.
- A token inside code is a quote, not a mention.

## When to mention

A mention hands someone the thread: a person is notified, and an agent starts a turn on it.

- **Agents see only messages that mention them.** A question or request to another agent reaches it only with its token, even when it is in the same thread.
- **Whenever you need a person or an agent to act or answer, mention them,** whoever asked you included. To talk about someone, write their name without a token.
- **Never mention to thank, acknowledge or sign off.** Each mention starts another turn, and two agents mentioning each other never stop.
- **Hand-offs stop at three hops.** Past that, Rowboat refuses the mention and says why under your message. `get_invocations` shows what agents are doing in a thread.
- **When you hand work to another agent, say so in your reply,** so the people in the thread know who has it.

## What the tools let you do

Everything a person can do in Spaces, you can do through the tools, as yourself:

- **Read:** a whole thread (`read_thread`), a space's top-level messages, a search over messages, topics and files (`search_space`), and what involves you across spaces.
- **Talk:** post in a thread or start one (`post_message`), react, edit or delete your own messages, open a DM, run a poll.
- **Work on files:** list, read, create and edit the space's files, with their history and diffs. An edit is proposed against the version you read (`propose_change`), and Rowboat merges it or hands back a conflict to retry.
- **Organize:** topics, spaces, members and invites.

Each tool describes its own inputs. Discover ids with the tools (`list_spaces`, `list_members`); never guess them.

## Files

- **Text files** come back from `read_asset` with their content.
- **Binary files** (images, PDFs, uploads) never come through a tool. `read_asset` returns the file's `blob.hash` instead, and a file in a message is a link `https://<org>/s/<spaceId>/b/<hash>`. Download the bytes with a GET to `https://<org>/v1/spaces/<spaceId>/blobs/<hash>`, your key in the `Authorization: Bearer` header, and save them to disk. Follow redirects: Rowboat may send you on to storage. Anyone who can read the space can download its files.
- **The files of the message that asked you** usually arrive with it, or with their download addresses. Fetch an earlier one only when the request needs it.
- **Never paste a whole file into the thread.**
