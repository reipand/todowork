# Todowork — Design Direction

This file is the **direction** layer. `antislop.md` is the **filter** applied on top of it.
Direction says what the product is; the filter removes generic AI output.

---

## Design Read

> Reading this as: a productivity/task-management dashboard for individual knowledge
> workers who care about their time, in a precise, low-noise, editorial-tool visual
> language, dial **ENERGY 1 / RHYTHM 2 / MOTION 1**.

Dials, and what each one commits us to:

| Dial | Value | Commitment |
|---|---|---|
| **ENERGY** | 1 | Quiet surface. The UI says hello through structure and spacing, not decoration. No glow, no gradient spectacle, no floating everything. |
| **RHYTHM** | 2 | Mostly consistent grid, with deliberate breaks: the dashboard stat row is dense, the task list is airy, the empty state is generous whitespace. Not uniform everywhere, not asymmetric for its own sake. |
| **MOTION** | 1 | Interaction feedback only: hover, focus, and state transitions. No scroll reveals, no parallax, no entrance choreography. A todo app is opened 20 times a day; animation becomes noise fast. `prefers-reduced-motion` collapses all of it. |

---

## Identity

**Todowork** — "Organize your tasks. Own your time."

The product's promise is that the app is *always there*, including offline. The visual
identity should read as **calm, owned, and dependable**, not as hype.

**Identity motif — "the work rail".** A single 2px vertical rule sits at the left edge of
every task row, colored by the task's project (falling back to a neutral). It is the one
repeated gesture across the whole product, and it does real work: at a glance you see which
project a task belongs to and how it is grouped. It is not decoration. It is also **not**
the banned "colored left stripe on cards" cliché (antislop Part 1) because it encodes
project membership, and its color always has a legend available.

**Second motif — tabular numerals.** Counts, dates, and durations use proportional-width
tabular figures in the mono face. Numbers line up in columns, which is what a productivity
tool actually needs. Typography carries the identity instead of color.

---

## Palette

Per antislop R-29: **2 core colors + 1 accent**. Neutrals (white/near-black/grey) are
outside that budget and are not counted.

| Role | Light | Dark | Why |
|---|---|---|---|
| Core 1: Ink (neutral-warm near-black) | `#1A1A19` | `#EDEDEB` | Text and primary surface contrast. Warm-shifted so it reads as paper/ink rather than the cold blue-black every AI dashboard defaults to. |
| Core 2: Paper (warm off-white / warm charcoal) | `#FBFAF8` | `#141413` | The canvas. Slightly warm so large white areas do not glare under office lighting. |
| Accent: Iris | `#4F46E5` | `#8B85F5` | The single deliberate accent. Used for focus rings, the active nav item, and the primary action **only**. Never as a background wash. |
| Priority: High | `#B4232A` | `#F08A8E` | Semantic, not decorative. |
| Priority: Medium | `#8A6100` | `#D9A93E` | Semantic. |
| Priority: Low | `#3F6B57` | `#7FB89C` | Semantic. |

**Why not the default indigo-to-violet gradient?** Because a gradient tells the user nothing
about their tasks. Flat iris on a warm neutral does the one job an accent has: marks the
thing you can act on.

**Why warm neutrals?** Deliberate warmth at the ink/paper level is the cheapest way to stop
a dashboard looking like every other Tailwind-admin screenshot, without adding decoration.

### Priority is never color alone (spec §5G, WCAG 1.4.1)

Every priority is rendered as **color + a distinct glyph + a text label** in accessible
contexts. The glyphs are geometric and language-independent:

- High: filled triangle up `▲`
- Medium: filled square `■`
- Low: filled circle `●`

A user with deuteranopia, protanopia, or monochromacy can still read priority. The same
applies to completion (checkmark glyph, not just a color change) and overdue status (a
`text-label` "Overdue", not just red text).

### Contrast (antislop R-25)

All pairings below are **targeted** at WCAG AA (4.5:1 normal, 3:1 large). They must be
machine-verified with the `antislop-human` contrast checker before this file is considered
final; see `docs/ACCESSIBILITY.md`. Do not treat these as verified until that runs.

| Foreground | Background | Purpose |
|---|---|---|
| `#1A1A19` | `#FBFAF8` | Body text on paper |
| `#6B6B66` | `#FBFAF8` | Secondary text (must be checked; this is the pair that most often fails) |
| `#FFFFFF` | `#4F46E5` | Primary button label |
| `#B4232A` | `#FBFAF8` | Overdue / high priority text |
| `#EDEDEB` | `#141413` | Body text, dark mode |

---

## Typography

Two families, chosen for reasons, not defaults (antislop R-06 bans typeface-by-default).

| Role | Family | Why this one |
|---|---|---|
| UI / text | **Inter** | Loaded via `next/font` with `display: swap`. Chosen because it is a workhorse UI face with an unusually complete true-tabular numeral set and a real `ss02` alternative glyph, which matters in a data-dense list. It is a *reasoned* pick, not a reflex. |
| Numerals / dates / counts | **JetBrains Mono** | Used **only** for tabular figures and timestamps, never for headings. A productivity app compares numbers all day; monospaced digits stop counts from jittering as they change. This is a functional use, not a "terminal aesthetic" (antislop R-06). |

Explicitly rejected: large monospace headings, `UPPERCASE` section labels with wide
letter-spacing. Both are AI-typography tells and neither serves a task manager.

### Scale

| Token | Size / line-height | Use |
|---|---|---|
| `text-display` | 30 / 36, weight 600, tracking -0.02em | Page titles |
| `text-title` | 20 / 28, weight 600 | Section headers |
| `text-body` | 14 / 22, weight 400 | Task titles, body |
| `text-meta` | 12 / 18, weight 500 | Labels, dates, counts |
| `text-mono` | 13 / 20, JetBrains Mono, `font-variant-numeric: tabular-nums` | Counts, timestamps |

Body is 14px because a task manager is a dense reading surface; 16px would push the list
to a scroll-heavy column. This is a deliberate density decision, and it is why the layout
gives the list real breathing room in whitespace instead of in line-height.

---

## Layout

- **Desktop:** fixed left sidebar (240px, collapsible to 64px icon rail), a slim top bar,
  then a max-width reading column for the task list. Collapsing persists per device.
- **Mobile:** bottom navigation for the five destinations a person actually uses on a
  phone (My Day, All Tasks, Calendar, Projects, Settings). Everything else lives in a
  drawer. Bottom nav respects `env(safe-area-inset-bottom)`; the top bar respects the top
  inset. Tap targets are 44px minimum (antislop R-03).
- **Right panel:** task details open as a side panel at `lg` and above, and as a
  full-height sheet below `lg`. This is the one place where a modal is allowed to take
  most of the screen, because editing a task is a focused act.

### Spacing

A 4px base scale. Section rhythm alternates deliberately (RHYTHM 2): dense inside a stat
card, generous between sections. The task list uses `12px` row padding, not `16px`, because
at 14px type the extra 4px compounds into a noticeably longer scroll for a 50-task list.

### Radius and elevation

- Radius: `6px` controls, `8px` cards, `12px` panels, full for avatars only. Not every
  element is a pill (antislop R-11).
- Elevation: **borders first, shadow second.** The base surface is a `1px` warm border.
  Shadow appears on exactly two things: the task detail panel and dropdown/popover menus,
  i.e. the two places where a layer genuinely floats above another. Nothing else gets a
  shadow, because nothing else is elevated (antislop R-12).

---

## Motion

MOTION 1. The complete permitted inventory:

- 120ms ease-out on hover/focus color and background changes
- 150ms on popover/sheet enter, 100ms exit
- Checkbox completion: a 200ms single-pass glyph draw, because completing a task is the
  emotional payoff of the whole product and warrants the one moment of delight
- 150ms on sidebar collapse width

Nothing animates on mount or on scroll. All of the above are inside a
`@media (prefers-reduced-motion: no-preference)` guard (spec §9, antislop R-19).

---

## Dark mode

Shipped and functional in both modes (antislop R-21, R-34). This is a tool people leave
open for hours, sometimes at night, so a toggle is warranted rather than decorative.
Default follows `prefers-color-scheme`. Implemented with `.dark` class + CSS variables so
there is exactly one source of color truth and no component knows a hex value.

---

## What we deliberately do not do

Each of these is a decision with a reason, not an omission:

- **No gradient, anywhere.** It would carry no meaning.
- **No glassmorphism.** Translucency behind text costs contrast, and contrast is the whole
  job here.
- **No decorative emoji.** They render inconsistently across the web/PWA/Android/iOS
  surfaces this ships to, and they are announced awkwardly by screen readers.
- **No confetti or animated empty-state illustrations.** An empty task list is a normal
  state to be helped out of, not a celebration.
- **No fabricated statistics or testimonials** anywhere in the product or its docs
  (antislop R-17, R-18, R-36). The dashboard shows only the user's own real data, and shows
  an honest empty state when there is none.

---

## Reason log (antislop R-31)

| Decision | One-line reason |
|---|---|
| Warm neutral base | Stops the build reading as a default Tailwind admin theme without adding decoration. |
| Single iris accent | One accent marks the actionable thing; more accents dilute that signal. |
| Work rail on task rows | Encodes project membership at a glance, and doubles as the product's one repeated identity gesture. |
| JetBrains Mono for numerals only | Stops counts from reflowing as they change; used functionally, never as an aesthetic. |
| Borders before shadow | Only genuinely floating layers should look elevated; everything else is flat paper. |
| MOTION 1 | A frequently-opened tool: motion becomes noise, not polish. |
| Sidebar collapsible, state persisted | Power users want the width back; everyone else wants the labels. |
| Priority as glyph + label + color | Color-alone would exclude users with color vision deficiency. |
| 14px body | Task lists are read densely; whitespace does the breathing, not line-height. |
| Lucide React for icons | **Spec-mandated** (spec §3). Note antislop R-04 flags Lucide-as-default; this is an explicit owner override, recorded here. Every icon must still be semantically relevant to its label, and no icon ships without a text label or `aria-label`. |

---

## Conflict recorded (antislop R-37 protocol)

antislop R-04 discourages an icon set chosen for its recognisable library look, naming
Lucide-style thin rounded strokes specifically. The Todowork spec (§3) mandates
**Lucide React**. Per R-37, the owner's explicit instruction wins and is recorded rather
than silently followed or silently overridden.

**Resolution:** keep Lucide React. Mitigation applied so the look is not "the generic thin
icon set": icons are always paired with a text label, sized to the type scale rather than
floated decoratively, and never used as the sole carrier of meaning. No sparkle, star,
magic, lightning, diamond, orb, or robot glyphs anywhere.
