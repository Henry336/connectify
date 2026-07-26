# Connectify Design Direction

## Creative north star

**The Violet Listening Lounge** — a warm, late-night room where a shared song feels like the main event. Connectify should feel intimate, social, and deliberately composed: closer to a private listening bar than a generic streaming dashboard.

## Product character

- Warm and human, not synthetic or gamified.
- Editorial hierarchy with generous, useful scale.
- Dense enough for hosts, calm enough for guests.
- Media first; queue, chat, and moderation remain immediately understandable.
- Motion is restrained, purposeful, and safe for reduced-motion users.

## Violet Dusk system

| Role | Token | Value |
| --- | --- | --- |
| Canvas | `--canvas` | `#0f0a12` |
| Raised canvas | `--canvas-raised` | `#151018` |
| Surface | `--surface` | `#1c1420` |
| Elevated surface | `--surface-raised` | `#281b2d` |
| Plum structure | `--plum` | `#502d55` |
| Mauve action | `--mauve` | `#935073` |
| Peach emphasis | `--peach` | `#f6dbc0` |
| Ivory text | `--ivory` | `#f8f4e9` |
| Muted text | `--text-muted` | `#b6a9b7` |
| Signal gold | `--signal` | `#e9c45a` |

Peach and ivory carry active emphasis and readable type. Plum creates structure. Mauve is used for selected and primary actions. Signal gold is reserved for live-room and broadcast cues.

## Brand mark

- The primary mark is a deep-plum rounded square containing paired peach broadcast arcs and one muted-gold signal core.
- The arcs represent listeners on either side of one shared moment; the central signal is the only gold element.
- The wordmark is lowercase, compact, and ivory. Its weight and tracking match the product's display typography.
- Use the complete horizontal logo in roomy headers, footers, loading states, and social material.
- Use the standalone mark for favicons, installed-app icons, narrow mobile headers, and notification artwork.
- At 16–32px, preserve the thick arc geometry and remove decorative detail before sacrificing legibility.
- Do not restore the old bright-yellow tile, recolor the mark per room theme, or substitute a generic radio-library icon.

## Type and scale

- UI/body: `Segoe UI Variable Text`, Aptos, system sans-serif.
- Display: `Segoe UI Variable Display`, Aptos Display, system sans-serif.
- Body copy is never smaller than 14px.
- Operational metadata is never smaller than 11px.
- Interactive targets are at least 40px on desktop and 44px on touch layouts.
- Room and track titles use strong weight and compact tracking without introducing a second decorative font.

## Layout principles

- The active media column and its related controls share one 860px content rail.
- The room side panel is 420–480px on large screens.
- The player expands with the available viewport instead of stopping at 680px.
- Queue and chat share one stable side panel; switching tabs must not hide global room controls.
- Modals are sized by task: standard, wide administration, and showcase Room DNA.
- Mobile is a deliberate stack: media first, controls second, queue/chat as a bounded workspace.

## Interaction principles

- Use plain labels for consequential actions: **Remove from room**, **Block from room**, **Unblock**.
- Destructive actions require confirmation; reversible navigation and settings do not.
- Menus and modals live above every room panel, close with Escape, retain focus, and restore focus.
- Hover-only actions must also appear on keyboard focus and touch devices.
- Capacity is configurable at room creation and from host controls, with a hard limit of 100 listeners.

## Anti-references

- Generic neon-purple SaaS dashboards.
- Tiny uppercase metadata used as the primary hierarchy.
- Status dots used as decoration.
- Glass cards on every surface.
- Oversized empty columns around an undersized player.
- Icon-only moderation actions without visible meaning.
