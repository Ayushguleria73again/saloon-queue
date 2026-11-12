# Design System — SalonFlow SaaS

## 1. Visual Identity

SalonFlow balances **hospitable warmth** on customer QR flows with **high-clarity SaaS precision** on owner/staff/admin dashboards. Usability, scannability, and speed take strict priority over decorative clutter.

---

## 2. Color Tokens

| Semantic Token | Light Value | Usage |
| :--- | :--- | :--- |
| `--bg-canvas` | `#FAF9F6` | Customer page background |
| `--bg-dashboard` | `#F8FAFC` | Owner & Admin SaaS workspace canvas |
| `--bg-surface` | `#FFFFFF` | Cards, drawers, sticky bottom bar |
| `--bg-muted` | `#F1F5F9` / `#F3F1EC` | Secondary chips, table headers |
| `--text-primary` | `#0F172A` | Primary headings, token numbers |
| `--text-secondary` | `#475569` | Secondary labels, durations, timestamps |
| `--border-default` | `#E2E8F0` | Card borders & dividers |
| `--brand-primary` | `#18181B` | Primary CTAs (`Get Queue Token`, `Call Next`) |
| `--brand-accent` | `#D97706` | Active turn callouts & highlights |

### Token Status Palette (Paired with Icons & Text Labels)
| Status | Background | Foreground | Icon (Lucide) |
| :--- | :--- | :--- | :--- |
| `WAITING` | `#FEF3C7` | `#92400E` | `Clock` |
| `CALLED` | `#DBEAFE` | `#1E40AF` | `BellRing` |
| `IN_SERVICE` | `#EDE9FE` | `#5B21B6` | `Scissors` |
| `COMPLETED` | `#D1FAE5` | `#065F46` | `CheckCircle2` |
| `SKIPPED` | `#F1F5F9` | `#334155` | `SkipForward` |
| `CANCELLED` | `#FEE2E2` | `#991B1B` | `XCircle` |
| `NO_SHOW` | `#FFE4E6` | `#9F1239` | `UserX` |

---

## 3. Typography & Layout Primitives

- **Sans**: `Plus Jakarta Sans` / `Inter` (`next/font/google`).
- **Numeric / Tokens**: `JetBrains Mono` + `tabular-nums` for `A014`, prices (`₹250`), and timers (`12m`).
- **Touch & Form Rules**: Minimum `48px` tap target height for mobile CTAs and service cards; `16px` minimum input font size to stop iOS Safari auto-zoom.
- **Motion**: Crisp Framer Motion transitions honoring `useReducedMotion()`.
