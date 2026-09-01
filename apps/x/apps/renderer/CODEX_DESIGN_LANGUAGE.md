# Codex Design Language for Rowboat

A complete visual language modeled on the Codex desktop app (macOS), specified so it can be
applied directly to Rowboat's existing token system (`src/App.css`, Tailwind v4 + shadcn
variables). The live styleguide artifact renders every token and component in this file.

The read of the reference in one paragraph: **a quiet, macOS-native surface.** Pure white
canvas, one warm-less gray rail, near-black ink, generous whitespace, soft 8–24px radii,
hairline borders instead of shadows (shadows are reserved for floating things), the system
font everywhere, and exactly one accent — blue — used only for links, focus, and toggles.
Black is the primary action color, not blue. Density comes from restraint, not compression.

---

## 1. Color

All values light theme first, dark theme after the slash. Dark is derived (the reference
screenshots are light-only) and follows the same logic: rail darker than canvas, raised
surfaces lighter than canvas, ink ramp compressed.

### 1.1 Backgrounds & surfaces

| Token | Light | Dark | Used for |
|---|---|---|---|
| `bg/canvas` | `#FFFFFF` | `#212121` | Main content: chat surface, settings content, right panel |
| `bg/sidebar` | `#F4F4F4` | `#171717` | App sidebar, settings nav rail |
| `bg/raised` | `#FFFFFF` | `#2A2A2A` | Popovers, menus, composer, dialogs, settings group cards. Same as canvas in light — separation comes from hairline + shadow; in dark it lifts one step lighter |
| `bg/inset` | `#EBEBEB` | `#303030` | Recessed fields: search inputs, segmented-control track |
| `bg/code` | `#F1F1F1` | `#2E2E2E` | Inline code chips, path fragments |
| `bg/hover` | `rgba(0,0,0,.05)` | `rgba(255,255,255,.06)` | Hover wash on rows, icon buttons, list items |
| `bg/selected` | `rgba(0,0,0,.06)` | `rgba(255,255,255,.09)` | Selected nav row pill, active segmented chip |
| `bg/bubble` | `#0D0D0D` | `#303030` | User message bubble (ink-inverse text) |

Layering rule: canvas is the floor. The sidebar sits *beside* it (not on it), one step
darker. Anything that floats (popover, composer, scroll-to-bottom button) is `bg/raised`
with a hairline ring and a soft shadow. Anything recessed (inputs) is `bg/inset` with no
border. Never stack cards on cards.

### 1.2 Ink

| Token | Light | Dark | Used for |
|---|---|---|---|
| `ink/primary` | `#0D0D0D` | `#ECECEC` | Body text, row labels, titles |
| `ink/secondary` | `#5D5D5D` | `#A6A6A6` | Default icon color, "Worked for 43s", active meta |
| `ink/tertiary` | `#8F8F8F` | `#8A8A8A` | Placeholders, descriptions, section labels ("Projects", "Recents"), timestamps, shortcut hints |
| `ink/faint` | `#B4B4B4` | `#666666` | Disabled rows ("Commit or push"), disabled text |
| `ink/inverse` | `#FFFFFF` | `#0D0D0D` | Text on bubble / primary button |

### 1.3 Accent & semantic

| Token | Light | Dark | Used for |
|---|---|---|---|
| `accent/blue` | `#3478F6` | `#5B94FF` | Links, file links, toggles-on, focus ring, "Learn more". **Never buttons** — primary actions are black |
| `semantic/success` | `#1EA446` | `#3DCB70` | Diff `+N`, success states |
| `semantic/danger` | `#E5484D` | `#F2555A` | Diff `-N`, destructive actions, attention dots |
| `semantic/git` | `#8B5CF6` | `#A78BFA` | Branch/agent activity glyphs beside chat rows |

### 1.4 Borders

| Token | Light | Dark | Used for |
|---|---|---|---|
| `border/hairline` | `rgba(0,0,0,.07)` | `rgba(255,255,255,.08)` | Card outlines, dividers, popover rings, "Worked for" rule |
| `border/control` | `rgba(0,0,0,.12)` | `rgba(255,255,255,.14)` | Outline buttons, dropdown triggers |
| `ring/focus` | `#3478F6` @ 3px 25% halo | `#5B94FF` same | Keyboard focus only |

---

## 2. Typography

**The system font is the identity.** Do not load a webfont for UI.

```css
--font-ui: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI",
           Inter, ui-sans-serif, system-ui, sans-serif;
--font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
```

| Role | Size/Line | Weight | Tracking | Used for |
|---|---|---|---|---|
| Display | 28/34 | 600 | -0.015em | Settings page title ("General") |
| Title | 20/26 | 600 | -0.01em | Dialog titles |
| Headline | 15/20 | 600 | 0 | Section subheads ("Permissions"), popover headers ("Environment") |
| Body | 16/26 | 400 | 0 | Chat prose. 1.6 line-height is load-bearing — it's what makes answers feel calm |
| UI | 14/20 | 400 (500 emphasized) | 0 | Sidebar rows, buttons, settings row titles, top-bar title |
| Small | 13/18 | 400 | 0 | Descriptions, timestamps, section labels, keyboard shortcuts |
| Mono | 13/20 | 400 | 0 | Inline code chips |
| Mono small | 12/16 | 400 | 0 | Paths in settings rows |

Numerals: `font-variant-numeric: tabular-nums` on diff badges, shortcuts, and any column
of digits. Section labels are **not** uppercased — Codex uses sentence case at tertiary
ink instead of small caps.

---

## 3. Spacing, radius, size

Base-4 spacing scale: `2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64`.

### Radii

| Token | Value | Used for |
|---|---|---|
| `r/xs` | 6px | Inline code chips, filetype badges |
| `r/sm` | 8px | Buttons, nav row selection pill, popover rows |
| `r/md` | 10px | Inputs, dropdown triggers, secondary chips |
| `r/lg` | 14px | Settings group cards |
| `r/xl` | 18px | Popovers, menus |
| `r/2xl` | 24px | Composer, user bubble |
| `r/full` | 999px | Send button, avatar, toggle, drag handle, scroll-to-bottom |

### Key metrics

- **Sidebar**: 300px wide. Row height 36px, radius 8, padding `0 10px`, icon–label gap 10px, icon 18px. Section label: 13px tertiary, `24px` above / `8px` below, left-padded 10px to align with row labels. Nested chat rows indent 28px.
- **Top bar**: 52px tall, `0 16px` padding, title 14/500 with 8px gap to its icon.
- **Chat column**: max-width 820px centered, `0 24px` padding, 28px between messages.
- **User bubble**: padding `10px 16px`, radius 22px (reads pill at one line), max-width 75%, right-aligned.
- **Composer**: max-width 800px, radius 24, padding `14px 16px 12px`, two rows (input, then controls), send button 36px circle.
- **Popover**: width ~320px, radius 18, padding 8px, row height 40px, row radius 8, row padding `0 10px`, icon–label gap 10px.
- **Settings**: content max 720–1000px, page title then 32px, group card radius 14 + hairline border, rows `16px 20px` padding, min-height 64px, title/description gap 4px, hairline between rows optional (Codex separates by padding alone within a card).
- **Buttons**: heights 28 (sm) / 32 (default) / 36 (lg); padding-x 12–14; icon buttons 32×32.
- **Toggle**: 40×24, knob 20px, 2px inset.

---

## 4. Elevation

Borders do the everyday separating; shadows are reserved for the three floating things.

```css
--shadow-popover:  0 0 0 1px rgba(0,0,0,.06), 0 12px 32px rgba(0,0,0,.10), 0 4px 12px rgba(0,0,0,.05);
--shadow-composer: 0 0 0 1px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.06);
--shadow-float:    0 0 0 1px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.12);   /* scroll-to-bottom */
```

Dark: same geometry, ring becomes `rgba(255,255,255,.08)`, blur colors deepen to
`rgba(0,0,0,.4–.5)`. Settings cards and the environment panel's neighbors get **no**
shadow — hairline only.

---

## 5. Iconography & details

- **Icons**: Lucide, 1.5px stroke, round caps/joins. 18px in nav and popover rows, 16px for inline message actions, 20px only in the top bar. Default color `ink/secondary`; `ink/primary` when the row is selected.
- **Message actions** (copy / feedback / share): 16px icons at `ink/tertiary`, hover to `ink/secondary` + `bg/hover` wash, 28px hit area, appear under the last assistant message.
- **Drag handle**: 36×5px pill, `#D9D9D9` / `#4A4A4A`, centered.
- **Keyboard shortcuts**: 13px `ink/tertiary`, real macOS symbols (⌘⇧⌥⌃), right-aligned in rows.
- **Diff badge**: 13px tabular, `+N` success / `-N` danger, 6px gap.
- **File link**: inline-flex, 6px gap: 14px filetype badge (blue rounded-4 square, 9px 700 white "TS") + `accent/blue` link text. Hover: underline.
- **Avatar**: 28px circle, `bg/bubble` fill, 11px/600 white initials.
- **Activity glyph**: 14px git-branch icon in `semantic/git` at the right edge of chat rows with agent activity; `semantic/danger` dot variant for attention.

---

## 6. Components

### Buttons

| Variant | Recipe |
|---|---|
| Primary | `bg/bubble` fill, `ink/inverse` text, 14/500, radius 8, h32, px14. Hover: 85% opacity. The send button is this as a 36px circle |
| Secondary | `bg/inset` fill (`#F0F0F0` on white), `ink/primary` text 14/500, radius 8, h32, no border. Hover: darken 4%. ("Change", "View") |
| Outline / dropdown | `bg/raised` fill, `border/control`, radius 10, h32, chevron 16px `ink/tertiary` at right. ("Cursor ⌄", "Auto detect ⌄") |
| Ghost | Text 14/400 `ink/secondary` + optional icon, transparent, radius 8. Hover: `bg/hover`. ("Share", "Ask for approval") |
| Icon | 32×32, radius 8, icon 18px `ink/secondary`. Hover: `bg/hover` |
| Floating circle | 36px, `bg/raised`, `shadow-float`, icon 18px `ink/secondary`. (scroll-to-bottom) |

### Inputs

- **Search / text field**: `bg/inset`, radius 10, h32, px10, 14px text, placeholder `ink/tertiary`, leading 16px icon. No border at rest; focus = accent ring.
- **Toggle**: 40×24 track. Off: `rgba(0,0,0,.16)` / dark `rgba(255,255,255,.2)`. On: `accent/blue`. Knob white 20px, 180ms.
- **Segmented (text)**: options as 28px-high chips radius 7; selected gets `bg/selected` + `ink/primary` 500; unselected `ink/tertiary` 400. ("Bottom | Right")
- **Model picker**: ghost text button — name 14/500 `ink/primary` + variant 14/400 `ink/tertiary` + chevron. ("5.6 Terra **Medium** ⌄")

### Chat

- **User message**: bubble per §3, no timestamp inline. Day dividers centered, Small/tertiary ("Thu, Jun 25 at 2:38 PM").
- **Assistant message**: no bubble, Body 16/26 on canvas, full column width. Prose: numbered lists with 8px gap, nested hollow-circle bullets, inline code as chips (`bg/code`, radius 6, mono 13, padding `2px 6px`), links `accent/blue` no underline (underline on hover).
- **Work disclosure**: "Worked for 43s ›" UI/`ink/secondary` + hairline rule filling the rest of the line, 16px below to content.

### Popover / menu (Environment, Outputs)

`bg/raised`, radius 18, `shadow-popover`, padding 8. Header row: Headline 15/600 with trailing 18px "+" icon button. Rows: h40 radius 8, 18px icon `ink/secondary`, UI label, trailing value/chevron `ink/tertiary`. Disabled row: everything `ink/faint`. Section split by 8px gap, not rules.

### Panel list (Review / Terminal / Browser…)

Rows h48, icon 18 + UI label + right-aligned shortcut Small/tertiary, radius 8, hover `bg/hover`. No borders.

### Settings

Page title Display, 32px below. Section subhead Headline with 12px below. Group card: `bg/raised`, radius 14, hairline border, rows inside `16px 20px`. Row: left column title UI/500 + description Small/tertiary (4px gap, max ~60ch); right column the control, vertically centered. Mono-small `ink/tertiary` for paths.

### Sidebar

Rail `bg/sidebar`, no visible border to canvas (the value shift is the border). Traffic lights inset `16px`. App wordmark row: 15/600 + chevron, trailing icon buttons. Nav rows per §3 metrics. Footer row: avatar + name UI/500 + trailing help icon, pinned with 12px padding.

---

## 7. Motion

- Hover washes: 120ms ease-out.
- Popovers/menus: 160ms `cubic-bezier(0.2, 0, 0, 1)`, fade + scale 0.98→1 from anchor corner.
- Toggle knob: 180ms same curve.
- Work disclosure expand: 200ms height + fade.
- Respect `prefers-reduced-motion`: collapse all of the above to opacity-only.

---

## 8. Applying to Rowboat (`src/App.css`)

Three changes: (1) replace the `:root` / `.dark` token values, (2) switch the body font
stack to system, (3) set `--radius` to 10px. Everything downstream (shadcn components,
`--rowboat-*` extensions) inherits.

```css
:root {
  --radius: 0.625rem; /* 10px */

  --background: #ffffff;
  --foreground: #0d0d0d;
  --card: #ffffff;
  --card-foreground: #0d0d0d;
  --popover: #ffffff;
  --popover-foreground: #0d0d0d;
  --primary: #0d0d0d;               /* black actions, per Codex */
  --primary-foreground: #ffffff;
  --secondary: #f0f0f0;             /* "Change"/"View" chips */
  --secondary-foreground: #0d0d0d;
  --muted: #f1f1f1;                 /* code chips, quiet fills */
  --muted-foreground: #8f8f8f;      /* ink/tertiary */
  --accent: rgba(0, 0, 0, 0.05);    /* hover wash */
  --accent-foreground: #0d0d0d;
  --destructive: #e5484d;
  --border: rgba(0, 0, 0, 0.07);    /* hairline */
  --input: rgba(0, 0, 0, 0.12);     /* control borders */
  --ring: #3478f6;

  --sidebar: #f4f4f4;
  --sidebar-foreground: #0d0d0d;
  --sidebar-primary: #0d0d0d;
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: rgba(0, 0, 0, 0.06);  /* selected pill */
  --sidebar-accent-foreground: #0d0d0d;
  --sidebar-border: transparent;          /* value shift is the border */
  --sidebar-ring: #3478f6;

  --scrollbar-track: transparent;
  --scrollbar-thumb: rgba(0, 0, 0, 0.18);
  --scrollbar-thumb-hover: rgba(0, 0, 0, 0.3);

  --card-surface: #ffffff;
  --rowboat-panel: #f4f4f4;
  --rowboat-raised: #ffffff;
  --rowboat-wash: #ebebeb;                /* inset fields */
  --rowboat-hairline: rgba(0, 0, 0, 0.12);
  --rowboat-command: #0d0d0d;
  --rowboat-attention: #e5484d;
  --rowboat-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 12px 32px rgba(0,0,0,.10), 0 4px 12px rgba(0,0,0,.05);
  --rowboat-shadow-soft: 0 0 0 1px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.06);

  /* Codex extensions */
  --codex-link: #3478f6;
  --codex-success: #1ea446;
  --codex-git: #8b5cf6;
  --codex-bubble: #0d0d0d;
  --codex-bubble-foreground: #ffffff;
  --codex-ink-secondary: #5d5d5d;
  --codex-ink-faint: #b4b4b4;
}

.dark {
  --background: #212121;
  --foreground: #ececec;
  --card: #2a2a2a;
  --card-foreground: #ececec;
  --popover: #2a2a2a;
  --popover-foreground: #ececec;
  --primary: #ececec;
  --primary-foreground: #0d0d0d;
  --secondary: #303030;
  --secondary-foreground: #ececec;
  --muted: #2e2e2e;
  --muted-foreground: #8a8a8a;
  --accent: rgba(255, 255, 255, 0.06);
  --accent-foreground: #ececec;
  --destructive: #f2555a;
  --border: rgba(255, 255, 255, 0.08);
  --input: rgba(255, 255, 255, 0.14);
  --ring: #5b94ff;

  --sidebar: #171717;
  --sidebar-foreground: #ececec;
  --sidebar-primary: #ececec;
  --sidebar-primary-foreground: #0d0d0d;
  --sidebar-accent: rgba(255, 255, 255, 0.09);
  --sidebar-accent-foreground: #ececec;
  --sidebar-border: transparent;
  --sidebar-ring: #5b94ff;

  --scrollbar-track: transparent;
  --scrollbar-thumb: rgba(255, 255, 255, 0.18);
  --scrollbar-thumb-hover: rgba(255, 255, 255, 0.3);

  --card-surface: #2a2a2a;
  --rowboat-panel: #171717;
  --rowboat-raised: #2a2a2a;
  --rowboat-wash: #303030;
  --rowboat-hairline: rgba(255, 255, 255, 0.14);
  --rowboat-command: #ececec;
  --rowboat-attention: #f2555a;
  --rowboat-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 12px 32px rgba(0,0,0,.45), 0 4px 12px rgba(0,0,0,.3);
  --rowboat-shadow-soft: 0 0 0 1px rgba(255,255,255,.08), 0 8px 24px rgba(0,0,0,.35);

  --codex-link: #5b94ff;
  --codex-success: #3dcb70;
  --codex-git: #a78bfa;
  --codex-bubble: #303030;
  --codex-bubble-foreground: #ececec;
  --codex-ink-secondary: #a6a6a6;
  --codex-ink-faint: #666666;
}
```

```css
body {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI",
               Inter, ui-sans-serif, system-ui, sans-serif;
  /* drop the Inter cv feature-settings — SF Pro doesn't need them */
}
```

### Migration checklist

1. Paste the token blocks over the current `:root` / `.dark` in `src/App.css` (lines ~1120–1213). Note the `var(--bg-color, …)` Monkeytype-style theme indirection: either drop it or move these values into the fallbacks.
2. Swap the body font stack (system first, Inter as fallback).
3. `--radius: 0.625rem` — shadcn's `radius-xl` (18px) then matches popovers, `radius-2xl`+ (24px) the composer.
4. Sidebar: remove the right border (`--sidebar-border: transparent`), rely on the `#F4F4F4`/`#FFFFFF` value shift.
5. Buttons: primary stays black/white (already `--primary`); ensure no blue buttons exist — blue is links/toggles/focus only.
6. Chat: user bubbles `--codex-bubble` at radius 22; assistant messages full-width prose at 16/26; inline code chips on `--muted` radius 6.
7. Scrollbars: overlay-style thin thumbs on transparent tracks (values above).
8. Shadows only on: popovers/menus (`--rowboat-shadow`), composer (`--rowboat-shadow-soft`), floating circle buttons. Cards get hairline borders, no shadow.
