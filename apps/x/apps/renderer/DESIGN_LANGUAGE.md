# Rowboat Design Language

Rowboat should feel like a command center for people who live in notes, agents, email, meetings, and files all day. The launch direction is quiet, fast, and prosumer: dense enough for repeated work, warm enough to feel personal, and explicit about what the AI is doing.

## Principles

1. **Calm density**
   Keep the interface compact and scannable. Use tighter rows, restrained borders, and low-contrast panels so users can keep many contexts open without the app feeling heavy.

2. **Command first**
   Primary actions should feel like instant commands, not marketing CTAs. Side navigation, search, model selection, and composer controls use compact icon-led affordances with clear hover and selected states.

3. **Visible work state**
   AI actions, sync, saving, meeting capture, and background tasks need clear status surfaces. Prefer small persistent indicators over large banners.

4. **Notes as the canvas**
   The editor and conversation stay visually dominant. Chrome is supportive, not decorative. Avoid nested cards and oversized empty states in work surfaces.

5. **Warm precision**
   The palette pairs paper, ink, and graphite neutrals with earned signal colors: muted blue for structure, teal-green for command tools, amber for attention, and red for destructive state.

## Tokens

- Radius: `8px` for controls and cards, smaller where density matters.
- Backgrounds: warm paper in light mode, graphite ink in dark mode.
- Borders: one-step darker than surfaces, quiet enough to separate panels without tinting them.
- Shadows: reserved for the composer, menus, dialogs, and active segmented controls.
- Type: system sans with tabular-feeling OpenType features enabled; no negative tracking.
- Accent use: muted blue carries structure and focus. Teal-green is reserved for command/action affordances; amber and red are reserved for state.

## Core Surfaces

- **Sidebar:** persistent workflow switcher with calm selected states. Quick-action icons use the teal-green command treatment.
- **Titlebar/tabs:** slim, scan-first navigation. Active tabs get a bottom signal line, not a bulky filled pill.
- **Composer:** the highest-emphasis control outside the active canvas. It is slightly raised, flat, bordered by the primary tone, and sharp enough to feel like an input terminal.
- **Messages:** user messages are compact structured blocks; assistant messages remain full-width and readable.
- **Status:** sync, saving, recording, and task activity stay small but always visible near the surface they affect.

## Launch Positioning

The visual story is: **Rowboat is the personal AI workspace for people whose work already spans meetings, mail, notes, browser tasks, and agents.** It should feel closer to a focused desktop tool than a chat website.
