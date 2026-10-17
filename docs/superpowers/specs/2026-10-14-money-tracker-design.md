# Money Tracker — Design Spec

Date: 2026-10-14
Status: Milestones 1 and 2 implemented (2026-10-17); decisions in §15

## 1. Summary

A personal income/expense tracker that lives on the iPhone home screen as a web app, with a dark, fast, keypad-first UI. Hosted on Firebase Hosting, data in Firestore, Google sign-in locked to one email. No App Store, no backend servers, $0/month on the Firebase Spark plan. Apple Watch and Siri entry come from an Apple Shortcut that writes to Firestore directly.

The stack and project shape mirror your existing `n0rahh/food-tracker` repo (React 19 + Vite 8 + TypeScript + Tailwind v4 + Firebase 13 + vite-plugin-pwa), so everything you already know about that project carries over.

## 2. What you asked for, and what I assumed

### You said

- Track earnings and expenses from an iPhone; it must be simple and fast.
- Categories with icons and colors; add new categories.
- Dark, friendly, modern UI.
- Several ways to compare spending, for example by month.
- A website added to the home screen is fine (you suspect a native app is too hard/long).
- Firebase for hosting and database, everything written to the DB, free tier.
- Login that only accepts `vlad.herasymovychh@gmail.com` (this exact spelling is already in the food-tracker rules, so I treat it as correct).
- Apple Watch would be great but you expect it needs a separate app; think about apps first, and if App Store publishing is required, go with the web page.
- Open to questions and to extra ideas that fit this kind of app.

### I assumed (defaults applied; cheap to change)

| Topic | Assumption |
|---|---|
| Currency | One base currency, chosen on first run and stored in settings; **PLN is preselected** (confirmed 2026-10-14). No conversion, no multi-currency in v1. |
| Amounts | Two decimal places (minor units), stored as integers. |
| Periods | Calendar months in the phone's local time zone. |
| Language | English UI. |
| Categories | Separate category sets for expenses and for income. Categories are archived, never deleted, so history keeps its labels. |
| Accounts | No accounts (cash/card/bank) and no transfers in v1. |
| Data volume | A few entries per day; a few thousand documents per year. |
| Devices | Primary: iPhone home-screen app. Secondary: desktop browser (same URL, responsive layout). |
| Name | Project `money-tracker`, Firebase project `money-tracker-vlad`, app name "Money Tracker" (matches "Food Tracker"). |

### Success criteria

1. From the home screen icon, logging an expense takes under 5 seconds: open, type amount, tap category, save.
2. The app opens instantly and works with no network; entries sync when back online.
3. The home screen answers "how much have I spent this month, on what, and is it more than last month?" without tapping anything.
4. Only your Google account can read or write any data, enforced by Firestore rules, not just by the UI.
5. Monthly cost is $0 on Spark with headroom of at least 10x on every quota.

## 3. Platform decision

| Option | What it would take | Verdict |
|---|---|---|
| Native iOS app + watchOS app (Swift/SwiftUI) | Xcode, Firebase Apple SDK (watchOS support is partial), and an Apple Developer Program membership ($99/year) for TestFlight or App Store. With a free Apple ID you can only sideload to your own phone and the build expires every 7 days. | Rejected: the recurring cost and re-signing chore exist only to avoid the App Store, which you do not want anyway. |
| Web app (PWA) on Firebase Hosting | What you already did with food-tracker. iOS 26 opens any site added to the Home Screen as a web app by default; a manifest and icons make it look and feel native (standalone window, dark splash, own icon). Offline via service worker + Firestore persistence. | **Chosen.** |
| Apple Watch via the web | watchOS has no browser you can bookmark and no home-screen web apps. | Not possible, as you suspected. |
| Apple Watch + Siri via Shortcuts | The Shortcuts app runs on the watch (watchOS 7+). A shortcut with "Ask for Input" + "Get Contents of URL" can POST a transaction to Firestore's REST API. Runs from the watch, a watch-face complication, Siri ("Hey Siri, add expense"), or the iPhone Action Button. No developer account, no App Store. | **Chosen for watch/voice entry (Milestone 4).** |

So: web app first; the watch gets a Shortcut, not an app. If you ever want a real watch app later, the Firestore data model is the same, so nothing is wasted.

## 4. Architecture

```
iPhone home-screen web app / desktop browser
  React 19 + TypeScript + Vite 8 + Tailwind v4 (static bundle, precached by a service worker)
       │  Firebase JS SDK v13 (Auth + Firestore with persistent local cache)
       ▼
Firebase project "money-tracker-vlad" (Spark plan)
  ├─ Hosting      https://money-tracker-vlad.web.app   (serves the bundle + /__/auth/ handler)
  ├─ Auth         Google provider, owner email locked by rules
  └─ Firestore    collections: categories, transactions, settings
                   (Standard edition, Native mode, one (default) database)

Apple Shortcut (iPhone / Apple Watch / Siri)  ──REST──▶  Firebase Auth + Firestore (Milestone 4)
```

### Why this shape

- **No server code.** Cloud Functions and Cloud Storage both require the Blaze plan, so the design never needs either. Everything (aggregation, comparisons, recurring entries) runs on the client over the user's own data.
- **Offline-first by default.** `persistentLocalCache` keeps every month you have looked at in IndexedDB; writes are applied locally first and synced later. The service worker precaches the app shell so a cold start never waits for the network.
- **Client-side aggregation.** With a few thousand documents per year, loading one month (≈150 docs) or twelve months (≈2,000 docs) and reducing in memory is instant and well within quota. No summary documents to keep in sync, no aggregation queries. Revisit only if a single query ever exceeds ~10k docs.
- **Mirrors food-tracker.** Same tooling, same folder layout, same auth context pattern, same rules style. You can copy `Sheet`, `Button`, `AuthContext`, `RequireAuth` almost verbatim.

### Free-tier math (Spark plan)

| Resource | Free allowance | Expected use |
|---|---|---|
| Firestore reads | 50,000 / day | Cold start of Home ≈ 300 (this month + last month); Trends 12 months ≈ 2,000 first time, then only changed docs. Typical day < 1,000. |
| Firestore writes | 20,000 / day | ≈ 5–10 / day. |
| Firestore storage | 1 GiB | ≈ 300 bytes per transaction → under 1 MB per year. |
| Hosting | 10 GB storage, ~10 GB/month transfer | Bundle ≈ 1 MB; a handful of loads per day. |
| Auth | Free for Google and email/password | One user. |
| Cloud Storage / Functions | Blaze only | Not used. |

The free quota applies to one Firestore database per project (the first one you create), so the project keeps a single `(default)` database.

## 5. Authentication

### Decision

Google sign-in with the Firebase Auth SDK, locked to one email, done exactly the way food-tracker does it:

- `signInWithPopup` everywhere, default `authDomain` (`money-tracker-vlad.firebaseapp.com`). **Verified 2026-10-14:** food-tracker's Google sign-in works in the installed home-screen app on your iPhone, so no redirect flow and no custom auth domain are needed.
- `login_hint` pre-fills your Gmail address on the Google screen.
- After any sign-in, the client checks `user.email === VITE_ALLOWED_EMAIL`; a mismatch signs out immediately with a clear message. This is UX only.
- **Enforcement lives in Firestore rules**: every read and write requires `request.auth.token.email == 'vlad.herasymovychh@gmail.com' && request.auth.token.email_verified == true`.
- After your account exists, turn off new sign-ups in Firebase Console → Authentication → Settings → User actions ("Enable create" off). Rules already make other accounts useless; this just keeps the user list clean.

### Fallbacks, kept for the record

Google's OAuth endpoint refuses embedded web views, and iOS home-screen web apps were historically caught by that. The food-tracker test above shows current iOS is fine. If a future iOS release breaks it: (1) `signInWithRedirect` with `authDomain` set to the app's own `web.app` host (Firebase's "Option 1" for browsers that block third-party storage; needs the `/__/auth/handler` URL added to the OAuth client's redirect URIs), then (2) email + password for the same Gmail address with sign-up disabled, which Milestone 4 adds anyway for the Shortcut.

### Local development before the Firebase project exists

The app runs fully against the Firebase emulators (Auth + Firestore) with a `demo-` project id, no Google account or billing involved: `VITE_USE_EMULATORS=1` in `.env.local` and `firebase emulators:start --only auth,firestore --project demo-money-tracker`. The Auth emulator's Google popup lets you create a fake account with the owner email. Deploying and the real sign-in need the project (M0 step 2), which can happen any time.

### Session lifetime

Firebase keeps the session in IndexedDB; the refresh token does not expire on its own. You sign in once per device and stay signed in for months. iOS home-screen web apps have their own storage that is not subject to Safari's 7-day eviction.

## 6. Data model

Root-level collections, same style as food-tracker (one owner, rules lock everything to that owner). Document ids are Firestore auto-ids.

### `categories/{id}`

| Field | Type | Notes |
|---|---|---|
| `name` | string | 1–40 chars |
| `icon` | string | key of the curated Lucide icon map (≈60 icons), e.g. `"Coffee"` |
| `color` | string | one of 17 palette keys, e.g. `"amber"` |
| `kind` | `"expense"` \| `"income"` | separate sets per kind |
| `order` | number | manual sort order within its kind |
| `archived` | boolean | archived categories are hidden from pickers but still label old transactions |
| `createdAt`, `updatedAt` | timestamp | server timestamps |

### `transactions/{id}`

| Field | Type | Notes |
|---|---|---|
| `kind` | `"expense"` \| `"income"` | |
| `amount` | integer | minor units (cents), always > 0; sign is implied by `kind` |
| `categoryId` | string | references `categories/{id}` |
| `note` | string | 0–200 chars, `""` by default |
| `date` | string | `YYYY-MM-DD` in the phone's local time zone; drives all grouping and queries |
| `at` | timestamp | ordering within a day; "now" when added for today, 12:00 local for back-dated entries |
| `source` | string, optional | `"app"` (default), `"shortcut"`, `"import"` |
| `createdAt`, `updatedAt` | timestamp | server timestamps (optional, informational) |

Why integer minor units: no floating-point drift when summing. Why an ISO date string: lexicographic range queries (`date >= '2026-10-01' && date <= '2026-10-31'`) work with no time-zone surprises, and grouping by day/month is a substring.

### `settings/main`

| Field | Type | Notes |
|---|---|---|
| `currency` | string | ISO 4217 code, e.g. `"EUR"`; chosen on first run |
| `locale` | string \| null | null = use the browser locale for number formatting |

Later milestones add `budgets/{categoryId}` (`{ monthly: integer }`) and `recurring/{id}` (template + `dayOfMonth` + `lastAppliedMonth`); transactions created from a template carry an optional `recurringId` string.

### Indexes

One composite index on `transactions`: `date DESC, at DESC` (and the ASC twin), the same shape food-tracker uses for `entries`.

### Rules (summary; full text in the M1 plan)

- `isOwner()`: signed in, email equals the allowed address, `email_verified == true`.
- `categories`, `transactions`, `settings`: read/write only for the owner.
- Schema validation on create/update: `kind` in the enum, `amount` is an integer in `(0, 10^11)`, `note` ≤ 200 chars, `date` matches `^\d{4}-\d{2}-\d{2}$`, `at` is a timestamp, category `name` 1–40 chars, `order` number, `archived` bool.
- Validation keeps the Shortcut (Milestone 4), which writes through REST, honest too.

## 7. Product: screens and flows

### Navigation

Bottom tab bar (iOS style, respects the home-indicator safe area) with a floating lime **+** button at the bottom right (thumb reach) that opens the Add sheet from anywhere.

- **Home** (month view) · **Trends** (M2) · **Categories** · **Settings**
- Desktop (≥ 768 px): the same tabs as a left sidebar, content max-width 640 px.

### Home — the month at a glance

- Header: `‹  October 2026  ›` (tap arrows; future months are reachable so a mis-dated entry can be found; tap the label for a month/year picker in M3). When the installed app is resumed in a new calendar month, Home follows it automatically.
- **Summary card**: Spent (hero number), Income, Net. Under it, the pace line (M2): "€1,240 by day 14 · last month by day 14 €1,410 · −12%".
- **Daily strip** (M2): 28–31 tiny bars, today highlighted; tap a bar to jump to that day in the list.
- **Category breakdown**: rows sorted by amount: color dot + icon, name, amount, share bar, and Δ vs. last month (M2). Tap → category detail (M2).
- **Transactions**: grouped by day ("Today", "Yesterday", "Tue, 12 Oct"), each row: icon in its category color, name, note, amount (expenses plain, income in accent). Tap → edit sheet. Day header shows the day total.
- Empty month: a friendly illustration-free empty state with a single "Add first expense" button.

### Add / Edit sheet — the fast path

Full-height bottom sheet, opens in ≈180 ms:

1. Segmented control **Expense | Income** (defaults to Expense; remembers last used in the session).
2. **Amount display** (big, tabular numerals, currency symbol) fed by a **custom keypad**: `1 2 3 ⌫ / 4 5 6 + / 7 8 9 − / . 0 =`. The keypad supports simple sums (`12.5 + 3`) because receipts are often split; `=` or Save evaluates. Max 2 decimals, no leading zeros, operator replaces operator.
3. **Date chips**: Today · Yesterday · Pick… (native date input). Default Today.
4. **Note** field (optional, 16 px font so iOS does not zoom).
5. **Category grid**: 2 horizontally scrolling rows of chips (icon + name) in category colors; most-recently used first; selected chip is filled. Archived categories are hidden, except that when editing an old entry whose category was archived, that category is shown first as a selected chip labelled "… (archived)" so the entry can be saved unchanged.
6. **Save** button reads "Add €12.50 · Groceries" and is disabled until amount > 0 and a category is chosen. The keypad and the Save button are fixed at the bottom of the sheet and the amount stays pinned at the top; only the date, note and category rows scroll on short phones.
7. Edit mode: same sheet prefilled, with Delete (confirm) in the header.
8. (M2) **Suggestion chips** in a "Quick add" row directly under the amount block: the 4 most frequent (category, amount, note) combos of the last 60 days, e.g. "☕ Coffee €3.50", never for an archived category and never one already logged today. One tap fills kind, amount, category and note; Save confirms.

Tap count for a normal expense: + → digits → category → Save.

### Categories

- Tabs Expense | Income. List in `order`; archived ones in a collapsed section.
- Add/Edit sheet: name, **icon picker** (searchable grid of the curated Lucide set), **color row** (17 swatches), Archive toggle, Move up / Move down.
- Defaults are seeded on first run (about 20 expense + 6 income categories, see M1 plan); you can rename, recolor, or archive any of them.

### Trends (M2) — compare over time

- Range chips: 3M · 6M · 12M · YTD.
- **Monthly bars** of expenses with income as dots on the same axis; tap a bar to see that month's totals; the selected month links to Home.
- **Category filter** chips (multi-select) narrow the bars to those categories.
- **Table** under the chart: Month · Spent · Income · Net · Δ vs. previous month.
- **Compare two months**: pick A and B → per-category table with absolute and % deltas, sorted by biggest change. Answers "why was September so expensive?".
- **Category detail** (from anywhere a category is shown): 12-month bars for that category, average per month, and its transaction list.

### Settings

- Currency (change only affects formatting; amounts are not converted, the UI says so).
- Export JSON / CSV (M3), Import CSV (M3, for migrating from your current app).
- "Siri & Apple Watch quick add" (M4): set a quick-add password, shows the Shortcut recipe.
- Install hint when not running standalone on iOS: "Share → Add to Home Screen".
- Sign out, app version.

### First run

Sign in → choose currency (searchable list, PLN preselected) → default categories are seeded → Home with the empty state.

## 8. Design system (dark)

Goal: "new and friendly" = near-black surfaces, one vibrant accent, category colors as the only other saturation, large rounded shapes, big numbers, short motion.

### Tokens (Tailwind v4 `@theme`)

| Token | Value | Use |
|---|---|---|
| `bg` | `#0A0A0D` | page background |
| `surface` | `#131318` | cards, sheets |
| `surface-2` | `#1B1B22` | chips, inputs, keypad keys |
| `border` | `#26262F` | hairlines |
| `text` | `#F4F4F6` | primary text |
| `muted` | `#8C8C9A` | secondary text |
| `accent` | `#C6F432` | brand lime: primary button, income amounts, active tab |
| `accent-ink` | `#0A0A0D` | text on accent |
| `expense` | `#FF6B7A` | expense totals when emphasized (hero number stays `text`) |
| `danger` | `#FF5C5C` | destructive actions |

Radii: 20 px cards and sheets, 14 px chips and keys, pill for segmented controls. Shadows are replaced by borders and subtle surface steps (shadows read muddy on black).

### Category palette (17 keys)

rose, red, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet, fuchsia, pink, slate. Each key maps to a foreground hex (Tailwind 400-level brightness, readable on black) and a 16 % alpha tint for chip backgrounds. Colors are applied with inline styles because they are data, not classes.

### Typography

- **Inter** (variable, self-hosted via `@fontsource-variable/inter` so it is precached and works offline), weights 400–700. (DM Sans was the first choice; its fontsource build ignores `tabular-nums`, measured 2026-10-16, so amounts jittered while typing.)
- All amounts use `font-variant-numeric: tabular-nums` so columns line up and numbers do not jitter while typing. The keypad expression is capped at 24 characters and the amount line shrinks in three steps (40/28/20 px) so it always fits a 375 px phone (343 px column), the smallest width iOS 26 runs on.
- Scale: hero amount 40/44 px semibold, section titles 15 px semibold uppercase-tracking for small labels, body 15–16 px, captions 13 px.

### Components

`Button` (primary / ghost / danger), `Sheet` (bottom sheet, full-height variant, swipe-down to close is a nice-to-have), `SegmentedControl`, `Keypad`, `AmountDisplay`, `CategoryChip`, `IconPicker`, `ColorPicker`, `MonthSwitcher`, `SummaryCard`, `BreakdownRow`, `TransactionRow`, `DayGroup`, `EmptyState`, `Toast`, and in M2 `BarChart`, `DailyStrip` and `DeltaBadge` as small hand-written HTML/CSS components (no chart library: smaller bundle, exact theming, real buttons for accessibility).

### Motion and touch

- Sheet enter/exit 180 ms ease-out using CSS transitions with `@starting-style`; pressed buttons scale to 0.97; everything respects `prefers-reduced-motion`.
- Minimum touch target 44 × 44 px; keypad keys 56 px tall.
- `touch-action: manipulation`, transparent tap highlight, `overscroll-behavior: none` on the shell, `100dvh` layouts, `viewport-fit=cover` with `env(safe-area-inset-*)` padding (top for the notch, bottom for the home indicator).
- Inputs use 16 px font to stop iOS auto-zoom.
- `theme_color`/`background_color` match `bg` so there is no white flash at launch.

### iOS home-screen specifics

- Manifest: `display: standalone`, `start_url: /`, `id: /`, 192/512 PNG icons plus a 512 maskable icon; `apple-touch-icon` 180 px PNG (iOS ignores SVG icons and would show a screenshot instead).
- `apple-mobile-web-app-status-bar-style: black-translucent` with the shell padded by the top safe-area inset.
- Service worker with `registerType: 'autoUpdate'` and a navigation fallback to `index.html` so deep links work offline.

## 9. Analytics definitions (so numbers mean one thing)

- **Month**: calendar month in local time; a transaction belongs to the month of its `date`.
- **Spent / Income**: sum of `amount` by `kind` for the period. **Net** = income − spent.
- **Category share**: category total ÷ total of the same kind in the period.
- **Day totals**: sums grouped by `date`; the daily strip plots expenses only.
- **Pace** (M2): spent from day 1 through today, compared with the previous month over the same number of days; delta shown in % with a sign. Only shown for the current month.
- **Δ vs. last month** (M2): per-category difference of full-month totals, absolute and %; new categories show "new"; categories that dropped to zero show −100 %.
- **Monthly trend** (M2): one bar per month over the range; income plotted as dots; the range is inclusive of the current month.
- **Compare A vs. B** (M2): per-category table of two arbitrary months, sorted by |Δ|.
- **Suggestions** (M2): group transactions of the last 60 days by (kind, categoryId, amount, note), rank by count then recency, take 4, exclude combos already used today.
- **Budgets** (M3): a monthly limit per category; progress = category month total ÷ limit; over 100 % turns the bar `expense`-colored.
- **Recurring** (M3): templates applied client-side on app launch for any month between `startMonth` and now that is not yet materialized, creating ordinary transactions with `source: "app"` and a `recurringId`.

## 10. Roadmap

Each milestone ships a usable app and gets its own implementation plan. Milestone 1's plan is written; later plans are written when you start them (they would otherwise go stale).

| Milestone | Scope | Acceptance |
|---|---|---|
| **M0 — Setup** (≈ 20 min, manual) | Auth spike done (popup works in the installed food-tracker). Create Firebase project `money-tracker-vlad` (Spark; Firestore Standard/Native, region `eur3`; Google provider; Hosting). Until then the app runs on the emulators. | The project exists; rules deployed. |
| **M1 — Core logging** (≈ 1 weekend) | Scaffold, theme, auth, rules + rules tests, categories (seed + manage), add/edit/delete with keypad, Home month view with breakdown and day-grouped list, month switcher, currency first-run, PWA manifest/icons/service worker, deploy, device checklist. | On the iPhone home screen: add an expense in under 5 s; works offline and syncs; only your account works. |
| **M2 — Insights** (implemented 2026-10-17) | Trends tab (monthly bars, range chips, category filter, table), Compare A vs. B, category detail, pace line and Δ on Home, daily strip, suggestion chips. Home keeps the viewed month in the URL so drill-downs and Back return to it. | "Was this month more expensive than last, and why?" is answered in two taps. |
| **M3 — Power features** (≈ 2 evenings) | Budgets with progress, recurring transactions, search/filter of the month list on Home, month/year picker, export JSON/CSV, import CSV, undo toast on delete, bundle/perf pass (lazy routes; Firebase alone is ~189 kB gzipped, so the realistic target is ≤ 320 kB total). | Monthly bills appear by themselves; old data imported; backup is one tap. |
| **M4 — Siri & Apple Watch** (≈ 1 evening) | Link an email/password credential for REST, Settings page recipe, Shortcut "Add expense" that signs in and POSTs to Firestore, `source: "shortcut"`, watch complication and Siri phrase, test from the watch with the phone away. | "Hey Siri, add expense" on the watch creates a transaction that appears in the app within seconds. |

Stretch ideas, deliberately out of scope until the above exists: accounts and transfers, multi-currency with rates, receipt photos (needs Blaze for Storage), a weekly push summary (needs a sender; doable for free from a GitHub Actions cron + FCM, but YAGNI), shared use with a second person.

## 11. Error handling and edge cases

- **Offline writes**: Firestore queues them; the UI shows the entry immediately. A small "Syncing…" badge appears in the top-right corner of the summary card while `hasPendingWrites` is true for the visible month (absolutely positioned, so nothing shifts), and disappears on sync. No blocking spinners on add.
- **Quota exhausted** (practically impossible, but on Spark the service stops instead of billing): reads fail with `resource-exhausted`; M1 shows the raw error under the summary card; a friendlier banner ("Firebase quota reached, data will refresh after midnight PT") is deferred to M2.
- **Wrong Google account**: immediate sign-out with "This app only accepts vlad.herasymovychh@gmail.com".
- **Deleted/archived category on an old transaction**: rows render with the stored category name if the category document still exists (archived) or "Uncategorized" in slate if it was removed by hand in the console.
- **Time zones and travel**: `date` is computed on the device at entry time; a transaction stays on the day you logged it. Month boundaries never shift retroactively.
- **Double submit**: Save is disabled while the write is in flight; the sheet closes on local acknowledgement, not on server confirmation.
- **Keypad input**: expressions never produce negative totals; `10 − 15` evaluates to 0 and Save stays disabled.
- **Currency change**: the sheet note says amounts are not converted; a confirm dialog appears only when the new currency has a different number of decimals, because stored minor units are then read at a different scale (12.50 → ¥1,250).
- **Service-worker update**: `autoUpdate` reloads to the new version on the next launch; no in-app prompt.

## 12. Testing strategy

- **Unit tests (Vitest)** for every pure module: money formatting and minor-unit parsing, date utilities, keypad expression engine, statistics (totals, grouping, pace, deltas, suggestions), CSV export/import.
- **Rules tests** with `@firebase/rules-unit-testing` against the Firestore emulator: owner allowed, other verified email denied, unverified owner denied, anonymous denied, schema violations denied (negative amount, bad date, long note).
- **Component tests** (Testing Library + jsdom) for the keypad and the Add sheet's enable/disable logic.
- **Device checklist** (manual, in the repo): install to home screen, cold start with airplane mode, add offline then reconnect, sign-in flow in standalone, safe areas on a notched iPhone, no zoom on input focus, icon and splash color.
- **CI** (GitHub Actions): lint + typecheck + unit tests (TZ pinned to Europe/Warsaw so the DST assertions bite) + the rules tests on the Firestore emulator, on every push and pull request. Deploys stay manual (`npm run deploy`).

## 13. Development workflow and deployment

- Node 24 (Firebase 13 requires ≥ 24.12), npm (as in food-tracker). Scripts: `dev`, `build`, `preview`, `lint` (oxlint), `typecheck`, `test`, `test:rules`, `deploy`.
- `.env.local` holds the Firebase web config (copied from the console); `.env.example` documents the keys. `VITE_ALLOWED_EMAIL` holds the owner email for the UI check.
- Local dev talks to the real project (one user, free tier) exactly like food-tracker; the emulator is used only for rules tests. If you prefer, `VITE_USE_EMULATORS=1` switches dev to local emulators.
- Deploy: `npm run deploy` = `vite build` + `firebase deploy --project money-tracker-vlad` (hosting + rules + indexes).
- Repo layout (mirrors food-tracker):

```
money-tracker/
  docs/superpowers/{specs,plans}/
  public/            icons, manifest assets
  src/
    components/      Button, Sheet, Keypad, AmountDisplay, CategoryChip, ... (one component per file)
    context/         AuthContext, AddSheetContext
    hooks/           useCategories, useTransactions, useSettings
    lib/             firebase.ts, firestore.ts, types.ts, money.ts, dates.ts, keypad.ts, stats.ts, categoryIcons.ts, categoryColors.ts, defaultCategories.ts
    pages/           LoginPage, HomePage, CategoriesPage, SettingsPage, (M2) TrendsPage, CategoryPage
    index.css        tokens + base styles
  tests/rules/       Firestore rules tests
  firebase.json, .firebaserc, firestore.rules, firestore.indexes.json
```

## 14. Siri and Apple Watch quick add (Milestone 4 recipe)

Requires the email/password credential linked to your Google account (done from Settings → "Siri & Apple Watch quick add", which calls `linkWithCredential` with a password you choose; use a unique random one, it is stored inside the shortcut in your iCloud).

Shortcut "Add expense" (enable "Show on Apple Watch"):

1. **Ask for Input** → Number, prompt "Amount?" (dictation or scribble on the watch).
2. **Calculate** → amount × 100, then **Round** to 0 decimals (minor units).
3. **Choose from List** → category names; a **Dictionary** maps names to Firestore category ids (copied once from the Categories page, which shows each id under "Copy id for Shortcuts").
4. **Get Contents of URL** → POST `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<web API key>` with JSON `{ "email": "...", "password": "...", "returnSecureToken": true }` → **Get Dictionary Value** `idToken`.
5. **Format Date** (current date) → `yyyy-MM-dd` and ISO 8601.
6. **Get Contents of URL** → POST `https://firestore.googleapis.com/v1/projects/money-tracker-vlad/databases/(default)/documents/transactions`, header `Authorization: Bearer <idToken>`, JSON body in Firestore's typed format:
   `{"fields":{"kind":{"stringValue":"expense"},"amount":{"integerValue":"<minor>"},"categoryId":{"stringValue":"<id>"},"note":{"stringValue":""},"date":{"stringValue":"<yyyy-MM-dd>"},"at":{"timestampValue":"<ISO 8601>"},"source":{"stringValue":"shortcut"}}}`
7. **Show Notification** "Added €12.50 to Coffee".

The same shortcut runs from Siri on the watch or phone, from a watch-face complication (watchOS asks for a confirmation tap), and from the iPhone Action Button or Back Tap. The web API key is public by design; the rules and the password are what protect the data.

## 15. Decisions confirmed by Vlad (2026-10-14)

1. **Currency**: PLN preselected on first run.
2. **Region**: Europe → Firestore location `eur3`.
3. **Auth**: Google popup sign-in verified in the installed food-tracker; mirrored here.
4. **Name**: "Money Tracker" (folder `money-tracker`, Firebase project `money-tracker-vlad`).
5. **Scope of M3**: budgets and recurring transactions are in.
6. **Existing data**: a "Money Manager" backup file exists. Its format is inspected when the file is dropped into the repo (`imports/`, git-ignored); if it is a Realbyte `.mmbak` (SQLite) the converter is a Node script, if it is the app's Excel/CSV export the importer reads it directly. The in-app import always consumes the app's own JSON/CSV format, so the converter is the only format-specific piece.
7. **Language**: English only.
8. **Firebase project**: created later by Vlad; until then everything runs on the emulators (§5).

## 16. Alternatives considered

- **Precomputed monthly summary documents** (totals per category updated in a batch with each write): fewer reads for Trends, but every edit must adjust two months' summaries and drift is possible. Not needed at this data volume; can be added behind the same `stats` functions later.
- **Firestore aggregation queries** (`sum`): cheap, but they do not work offline and would need one query per category per month. Client-side reduce is simpler and offline.
- **Svelte/SvelteKit** for a smaller bundle: real gain of maybe 30 kB, at the cost of leaving the stack you know. React is fine here; the budget is 350 kB gzipped (M1 ships at ~295 kB).
- **Chart library (Recharts/Chart.js)**: 40–100 kB for two chart types. Hand-written SVG bars and a share bar are under 150 lines.
- **Email magic link** sign-in: the link opens in Safari, not in the home-screen app, so the session would land in the wrong context. Rejected.
- **Capacitor wrapper** to reach the App Store/TestFlight: solves OAuth web-view issues but brings back the $99/year and Xcode. Rejected for the same reason as native.
- **Subcollections under `users/{uid}`**: nicer for multi-user; unnecessary now and would complicate the Shortcut's REST paths. Root collections with owner rules, as in food-tracker.
