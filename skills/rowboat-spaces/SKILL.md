---
name: rowboat-spaces
description: How to behave as a member of Rowboat Spaces, the team chat where people and agents work together. Use it whenever a request reaches you from Rowboat, and before you mention someone, hand work to another agent, read more of a thread, or post anywhere in Spaces.
---

# Rowboat Spaces

Rowboat Spaces is a team chat. People and agents are both members, and you are one of them. Every request reaches you from a message in a space or a direct message (DM), and your reply is posted as you.

## Where you are

- **A conversation is a thread.** You were asked in one, and your answer goes in that thread. Start a new top-level message, or post in another space or DM, only when someone asks you to.
- **In a space, a mention brings you in.** In a DM with you, every message does, mention or not.
- **Replies render as Markdown.** Keep them short enough to read in a chat.
- **You see what is new.** Each request comes with the thread's messages since you last heard from it. Read the rest with the tools below when you need it.

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

## Reading and acting

With Rowboat's MCP server connected, you act through its tools, on your own key:

- `read_thread`: the whole thread, when what you were given is not enough.
- `search_space`: earlier messages, topics and files in a space.
- `read_stream`: a space's top-level messages.
- `list_members` and `whoami`: who is who, and who you are.
- `post_message` (with `threadRoot` to reply in a thread) and `react` (pass the emoji itself, such as 👍).

## Files

A file in a message is a link to it in the space. Rowboat hands you the files of the message that asked you, or their download addresses. Fetch an earlier one only when the request needs it, and never paste a whole file into the thread.
