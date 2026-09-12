# Design System

Extracted from the two supplied references: the Baobab reference image (six
screens) and `baobab_html_css_clone_poppins.html`. The HTML was a **design
reference only** — nothing was embedded, no WebView, no markup copied.

---

## Translating a 300px prototype to a real device

The reference renders inside a fake 300×600 phone. Its raw pixel values
(5px gaps, 8.4px type, 78px tiles) are roughly **0.75×** what the same design
needs at ~390pt. Copying them literally would produce a cramped, unreadable app.

So proportions and hierarchy were preserved, and the absolute values scaled:

| Reference | This app | Why |
|---|---|---|
| `h1` 21px / -0.9 tracking | `heading1` 27 / -0.9 | same optical weight at real size |
| section title 11.5px | `heading3` 15 | stays clearly subordinate to h1 |
| body 8.8px | `body` 13 | 8.8 is unreadable on hardware |
| card radius 13px | `radius.card` 16 | same roundness ratio |
| hero radius 17px | `radius.hero` 20 | |
| nav height 54px | 62 | 44pt minimum touch targets |
| page gutter 14/300 | 18 | identical ratio |

**The fake phone frame, status bar, signal bars and battery are deliberately not
reproduced.** The app uses the real device screen via
`react-native-safe-area-context`.

---

## Colour

Taken verbatim from the reference's `:root` block. `src/theme/colors.ts` is the
single source; nothing outside it introduces a colour.

| Token | Value | Use |
|---|---|---|
| `bg` | `#F3F2ED` | warm page background |
| `card` | `#FFFFFF` | information cards |
| `line` | `#EBE9E2` | hairline separators |
| `ink` | `#10110F` | primary text |
| `muted` | `#73756F` | secondary text |
| `green` | `#124F3D` | primary, active nav, selected pills |
| `greenSecondary` | `#1F6A53` | |
| `greenAction` | `#285D4C` | hero card action buttons |
| `gold` | `#F4BF52` | the single strongest accent |
| `goldAvatar` | `#F2C65E` | avatar background |
| `peach` | `#F8DDC7` | soft tile / warning-ish status |
| `mint` | `#E8EFE7` | soft tile / positive status |
| `paleYellow` | `#F8ECC2` | soft tile / waiting status |
| `brown` | `#965C33` | tile accents |

**Two colours added**, both drawn from the reference rather than invented:

* `danger #AD4F49` — the reference's own `.logout` colour, a muted warm red that
  sits inside the palette's temperature. `dangerSoft #FFF0EE` is its `.logout`
  icon background.
* `success #2D775F` — the reference's `.money.plus` / `.complete` green.

### Status tones

One central map (`appointmentStatusTone`, `invoiceStatusTone`) so a status can
never take a different colour on a different screen.

| Status | Background | Foreground | Shown as |
|---|---|---|---|
| Scheduled | mint | green | Confirmed |
| Open / Checked In | paleYellow | warning | Waiting / Checked in |
| Closed | successSoft | success | Completed |
| Cancelled | dangerSoft | danger | Cancelled |
| No Show | peach | brown | No show |
| paid | mint | green | Paid |
| partially_paid | paleYellow | warning | Partial |
| unpaid | peach | brown | Unpaid |

---

## Typography

Poppins via `@expo-google-fonts/poppins`, weights 400/500/600/700/800.

The reference uses `font-weight: 850`, which is **not a real Poppins weight** —
browsers synthesise it. Headings here use the genuine **800** face plus tight
letter spacing, which reproduces the same dense, confident look without relying
on synthetic weights.

| Variant | Size / line / tracking | Use |
|---|---|---|
| `display` | 34 / 36 / −1.4 | hero number |
| `heading1` | 27 / 29 / −0.9 | page titles |
| `heading2` | 20 / 24 / −0.5 | sub-page titles |
| `heading3` | 15 / 18 / −0.3 | section titles |
| `cardTitle` | 13 / 17 / −0.2 | row and card names |
| `body` | 13 / 19 | body copy |
| `bodySmall` | 12 / 17 | secondary body |
| `caption` | 11 / 15 | metadata under a title |
| `micro` | 10 / 13 | tab labels, tile meta |
| `label` | 11 / 14 / +0.2 | field labels, date separators |
| `button` | 14 / 18 | button text |

Sizes are never hand-typed in a screen; everything goes through `<Text variant>`.

---

## Elevation

The reference is very restrained — `0 2px 8px rgba(36,39,34,.05)` on the nav and
almost nothing elsewhere. Separation comes from **warm background against white**,
not from shadow.

Android's `elevation` paints a grey halo that muddies the warm palette, so
`Card` uses a **hairline `line` border on Android** and the soft iOS shadow
elsewhere. Same visual weight, no grey cast.

---

## Signature components

**HeroCard** — the dark-green card. Faithful to the reference because these
details are what make it read as Baobab: a 145° three-stop gradient, a mint disc
bleeding off the top-right, a thin gold branch arc (inline SVG), and a row of
small actions with exactly one in gold.

**TabBar** — a custom `tabBar`, not React Navigation's default. A white rounded
rectangle inset 16pt from the edges, floating above content with a soft shadow,
19px thin icons, 9px labels, dark green when active.

**FilterPill** — fully rounded, dark green selected / white unselected,
horizontally scrollable so filters never wrap.

**Soft tiles** — peach / mint / paleYellow, cycled for department cards and
dashboard stats, mirroring the "Your circles" grid.

---

## Motion

Deliberately calm — this is healthcare software.

* Button press: spring to `scale: 0.97`
* Bottom sheet: spring slide-up
* Toast: 200ms fade with a small translate
* Screen transitions: platform default `slide_from_right`

No bouncing, no looping animation, no decorative graph motion. The only
continuous animation is the skeleton shimmer, which stops when content loads.

---

## Accessibility

* Every icon-only control has an `accessibilityLabel`.
* Touch targets are ≥44pt even where the reference draws ~27px — a visually
  compact design must not become an unusable one.
* Tabs and filter pills expose `accessibilityRole` and `accessibilityState`.
* Toasts announce via `accessibilityLiveRegion`.
