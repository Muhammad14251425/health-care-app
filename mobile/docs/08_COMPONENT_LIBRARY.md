# Component Library

Card styling is defined once. No screen re-implements a card, pill, row or
avatar.

## Primitives — `src/components/ui/`

| Component | Props (key) | Notes |
|---|---|---|
| `Text` | `variant`, `color`, `muted`, `align` | Every string goes through this; sizes are never hand-typed |
| `Card` | `flush`, `padding`, `backgroundColor` | Hairline border on Android, soft shadow elsewhere |
| `Button` | `variant`, `size`, `loading`, `icon` | primary / gold / secondary / ghost / danger; press-scale 0.97; ≥40pt tall |
| `Avatar` | `name`, `size`, `elevated` | Gold circle with derived initials |
| `StatusPill` | `status`, `kind` | Resolves through the central tone map |
| `FilterPill` / `FilterPillRow` | `options`, `value`, `onChange` | Horizontally scrollable; never wraps |
| `Screen` | `scroll`, `onRefresh`, `withTabBar`, `padded` | Safe-area aware; adds tab-bar clearance |
| `ScreenHeader` | `title`, `subtitle`, `eyebrow`, `right` | The reference's top row |
| `BackHeader` | `title`, `subtitle`, `right` | Circular back button, 40pt target |
| `SectionHeader` | `title`, `actionLabel`, `onAction` | "Today's schedule / See all" |
| `HeroCard` | `label`, `value`, `caption`, `actions` | The dark-green card: gradient, mint disc, gold branch |
| `StatCard` / `StatCardRow` | `label`, `value`, `backgroundColor` | Soft peach/mint/yellow tiles |
| `ProfileStat` | `label`, `value` | White bordered stat for profile screens |
| `SearchBar` | `value`, `onChangeText`, `onFilterPress` | Controlled; debouncing lives in the consumer |
| `SummaryRow` | `label`, `value`, `strong`, `valueColor`, `last` | Label/value rows on detail screens |
| `SettingsRow` / `SettingsGroup` | `icon`, `label`, `value`, `destructive` | Icon tile + chevron, grouped in a white block |
| `BottomSheet` | `visible`, `onClose`, `title` | Modal-based; taps inside do not dismiss |
| `Toast` / `ToastProvider` / `useToast` | `success`, `error`, `show` | Native-feeling snackbar |
| `Logo` / `LogoMark` | `name` | Dot-with-highlight wordmark |

## States — `src/components/ui/States.tsx`

| Component | Purpose |
|---|---|
| `EmptyState` | Icon, title, message, optional action |
| `ErrorState` | Adapts to the error: offline / permission / generic. **No Retry on a 403** — it is not retryable |
| `SkeletonBlock` | Shimmering placeholder |
| `SkeletonRow` / `SkeletonList` | Matches real row geometry so layout does not jump |
| `SkeletonHero` | Matches the hero card |

## Domain cards — `src/components/clinic/`

| Component | Used on |
|---|---|
| `AppointmentCard` | Home, Appointments, Calendar. `compact` for the dashboard |
| `PatientCard` | Patient directory |
| `InvoiceCard` | Billing. Shows amount **due** when outstanding |

## Booking — `src/components/booking/`

| Component | Purpose |
|---|---|
| `BookingProgress` | Slim step rail |
| `DoctorCard` | Avatar, specialty, next available |
| `DateStrip` | Horizontal date selector; unavailable days shown but disabled |
| `TimeSlotGrid` | Slot pills; taken slots muted and non-pressable |

## Forms — `src/components/form/`

| Component | Purpose |
|---|---|
| `FormInput` | RHF-bound; picks keyboard/autocomplete from `type`; constant border width so focus never shifts layout |
| `PickerField` | Select that opens a searchable bottom sheet |

## Navigation

| Component | Purpose |
|---|---|
| `TabBar` | The floating white bar. Custom, because React Navigation's default is edge-attached — visually the opposite of the reference |

## Conventions

* **No API calls in components.** Presentational components take data as props;
  screens and hooks fetch.
* **No colour outside the theme.** Everything resolves through `src/theme`.
* **Icon-only controls carry `accessibilityLabel`.**
* Lists use `FlatList`/`SectionList`, never `ScrollView` + `.map()` over
  unbounded data.
