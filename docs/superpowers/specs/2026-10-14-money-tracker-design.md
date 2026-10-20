# Money Tracker — Design Spec

Date: 2026-10-14
Status: Milestones 1–4 implemented (M1 and M2 2026-10-17, M3 2026-10-19, M4 2026-10-20); decisions in §15

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
  └─ Firestore    collections: categories, transactions, settings, budgets, recurring
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
| Firestore reads | 50,000 / day | At ~150 entries/month: a cold Home open ≈ 300 (this month + last month), each Add-sheet open ≈ 300 (its own 61-day listener), Trends 6M ≈ 1,050 and 12M ≈ 1,950, a category page ≈ 1,800, Compare ≈ 2 months (month-shaped queries shared with Home). A logging-only day ≈ 3–4k; a Trends-heavy day ≈ 10–13k. Listeners re-attached within 30 minutes re-use their resume token and read only changes. (M3) Two small listeners: `budgets` (Home, Categories) and `recurring` (always, for the materialiser in the app shell; Settings and the Recurring page share its watch target), one read per document per attach: about 30 more reads on a cold launch. An export reads what it holds once, from the server: ≈ N reads for N entries per tap (the JSON also reads the budgets and templates). An import reads only the categories. |
| Firestore writes | 20,000 / day | ≈ 5–10 / day. (M3) A recurring template costs 2 writes when it is created (the template and its first entry) and 2 per later month (its entry and its own update, one batch). An import writes 1 per row plus its new categories, so a 10,000-row file fits a day's quota once, not twice; importing it again the next day overwrites the same entries instead of adding any. |
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

Root-level collections, same style as food-tracker (one owner, rules lock everything to that owner). Document ids are Firestore auto-ids, except a budget's (its category's id) and the deterministic ids of recurring and imported entries (below).

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
| `at` | timestamp | ordering within a day; "now" when added for today, 12:00 local for back-dated entries; (M3) 12:00 local for every recurring entry |
| `source` | string, optional | `"app"` (the app, recurring entries included), `"shortcut"` (M4), `"import"` (M3, CSV import); read as `"app"` when missing |
| `recurringId` | string, optional | (M3) the template's id, 1–64 chars, on an entry made from a recurring template; left out otherwise, never null; an import drops it |
| `createdAt`, `updatedAt` | timestamp | server timestamps (optional, informational) |

Why integer minor units: no floating-point drift when summing. Why an ISO date string: lexicographic range queries (`date >= '2026-10-01' && date <= '2026-10-31'`) work with no time-zone surprises, and grouping by day/month is a substring.

Ids (M3): an entry added in the app (or by the Shortcut) has an auto-id. A template's entry for a month is `rec_<templateId>_<YYYY-MM>`, so a month materialised twice, on one device or two, overwrites one document. An imported row is `imp_` plus the first 24 hex digits of the SHA-256 of `kind|amount|category name in lower case|date|note`; each repeat of an identical row in the same file hashes its count in front (`1#`, `2#`, …), so two equal coffees stay two entries. A row of this app's own CSV export keeps its id instead (§7 Import CSV). Importing the same file again therefore overwrites instead of doubling.

### `settings/main`

| Field | Type | Notes |
|---|---|---|
| `currency` | string | ISO 4217 code, e.g. `"EUR"`; chosen on first run |
| `locale` | string \| null | null = use the browser locale for number formatting |

### `budgets/{categoryId}` (M3)

| Field | Type | Notes |
|---|---|---|
| `monthly` | integer | the limit in minor units, > 0 and < 10^11; no budget = no document |
| `updatedAt` | timestamp | server timestamp |

The document id is the category's id. One limit per category, the same for every month: budgets have no history, so a past month is measured against today's limit. Only expense categories offer the field (§7).

### `recurring/{id}` (M3)

| Field | Type | Notes |
|---|---|---|
| `kind`, `amount`, `categoryId`, `note` | | as for a transaction |
| `dayOfMonth` | integer | 1–31; a shorter month gets its entry on its last day |
| `startMonth` | string | `YYYY-MM`, the first month |
| `endMonth` | string \| null | the last month (Stop sets it); null while it has no end |
| `lastAppliedMonth` | string \| null | the latest month already turned into an entry; null while none is |
| `createdAt`, `updatedAt` | timestamp | server timestamps |

`endMonth` and `lastAppliedMonth` are always written, as null when empty: the rules refuse a missing field. The id is an auto-id, capped at 64 characters by the rules because it becomes the `recurringId` of the template's entries. The Add sheet writes a new template, with `lastAppliedMonth` = `startMonth`, and its first entry in one batch, so no snapshot ever shows a template without its first month. A template's entry is an ordinary transaction: id `rec_<templateId>_<YYYY-MM>`, `recurringId` = the template's id, `source: "app"`, `date` on `dayOfMonth` (or the month's last day), `at` at local noon. How months are materialised: §9.

### Indexes

One composite index on `transactions`: `date DESC, at DESC` (and the ASC twin), the same shape food-tracker uses for `entries`. M3 adds none: the recurring list is sorted on the client.

### Rules (summary; full text in `firestore.rules`)

- `isOwner()`: signed in, email equals the allowed address, `email_verified == true`.
- `categories`, `transactions`, `settings`, `budgets`, `recurring`: read/write only for the owner; every collection but `settings` allows read and delete separately from its validated create and update; everything else is denied.
- Schema validation on create/update: `kind` in the enum, `amount` is an integer in `(0, 10^11)`, `note` ≤ 200 chars, `date` matches `^\d{4}-\d{2}-\d{2}$`, `at` is a timestamp, category `name` 1–40 chars, `order` number, `archived` bool.
- (M3) A transaction's `recurringId` (1–64 chars) and `source` (`app`, `shortcut`, `import`) are checked when present; null is refused for both. A budget's `monthly` is an integer in `(0, 10^11)`. A template has a transaction's `kind`, `amount`, `categoryId` and `note` checks, `dayOfMonth` an integer 1–31, `startMonth` a real month (`^[0-9]{4}-(0[1-9]|1[0-2])$`), and `endMonth` and `lastAppliedMonth` null or a real month; its id is at most 64 chars on create and update. That id check is never on read: in a read rule `id.size()` denies the owner's own list queries.
- Validation keeps the Shortcut (Milestone 4), which writes through REST, honest too.

## 7. Product: screens and flows

### Navigation

Bottom tab bar (iOS style, respects the home-indicator safe area) with a floating lime **+** button at the bottom right (thumb reach) that opens the Add sheet from anywhere.

- **Home** (month view) · **Trends** (M2) · **Categories** · **Settings**
- Desktop (≥ 768 px): the same tabs as a left sidebar, content max-width 640 px.

### Home — the month at a glance

- Header: `‹  October 2026 ⌄  ›` and, at the right, a search icon (M3). Tap the arrows; future months are reachable so a mis-dated entry can be found. When the installed app is resumed in a new calendar month, Home follows it automatically.
- (M3) **Month picker**: the label opens a sheet "Choose month" with a year row (‹ 2026 ›) and a 3 × 4 grid of months, opening on the shown month's year. The shown month is pressed, this month carries a dot, and months ahead are selectable. A pick behaves exactly like the arrows: `?month=` is replaced in the URL, and picking the current month follows the calendar again.
- **Summary card**: Spent (hero number), Income, Net. Under it, the pace line (M2): "€1,240 by day 14 · last month by day 14 €1,410 · −12%". (M3) With at least one budget, a muted line under the hero: "Budgets: <spent in the budgeted categories> of <the sum of their limits>", hidden while the month loads or after its read failed.
- **Daily strip** (M2): 28–31 tiny bars, today highlighted; tap a bar to jump to that day in the list.
- **Category breakdown**: rows sorted by amount: color dot + icon, name, amount, share bar, and Δ vs. last month (M2). Tap → category detail (M2). (M3) A budgeted row keeps the bar line of any other row (its share slot stays, empty, so every amount ends in one column), with the bar measured against the limit (full and `expense`-coloured from 100 %, §9), and adds a third line: "<spent> of <budget>", then " · at limit" at exactly 100 % or " · <overage> over" past it. A budgeted category with nothing spent gets an empty row after the others, in category order, with a −100 % badge when it spent last month (an empty month shows the empty state instead).
- **Transactions**: grouped by day ("Today", "Yesterday", "Tue, 12 Oct"), each row: icon in its category color, name, note, amount (expenses plain, income in accent). Tap → edit sheet. Day header shows the day total. (M3) A template's entry dated later in the month is listed from the 1st, above Today.
- (M3) **Search**: the header's icon (a quiet icon while closed, dimmed while Home loads or for a month without entries) opens a bar above the day list, under the breakdown, and the page jumps it to the top of the screen; the field takes the focus within the tap, so iOS raises the keyboard. The placement is pending the device pass (`docs/m3-rulings.md`). The bar holds a field "Search notes and categories" and All / Expenses / Income. An entry matches when its kind fits and the trimmed query is part of its note or of its category name as the list shows it ("Uncategorized" for a removed category), ignoring case and accents (§9). The list shows the matches under a caption "N matching entries · <total>", signed like the day headers ("· −€57.70", "· +€3,000.00"; both kinds apart, never netted), or "No matches". While a search is on, each day header totals that day's matching entries only. The summary card, pace line, daily strip and breakdown always describe the whole month. Any month change, and closing the bar, reset the query and the kind; nothing is persisted.
- Empty month: a friendly illustration-free empty state with a single "Add first expense" button.

### Add / Edit sheet — the fast path

Full-height bottom sheet, opens in ≈180 ms:

1. Segmented control **Expense | Income** (defaults to Expense; remembers last used in the session).
2. **Amount display** (big, tabular numerals, currency symbol) fed by a **custom keypad**: `1 2 3 ⌫ / 4 5 6 + / 7 8 9 − / . 0 =`. The keypad supports simple sums (`12.5 + 3`) because receipts are often split; `=` or Save evaluates. Max 2 decimals, no leading zeros, operator replaces operator.
3. **Date chips**: Today · Yesterday · Pick… (native date input). Default Today.
4. **Note** field (optional, 16 px font so iOS does not zoom).
5. **Category grid**: 2 horizontally scrolling rows of chips (icon + name) in category colors; most-recently used first (M3: entries made by a template do not count); selected chip is filled. Archived categories are hidden, except that when editing an old entry whose category was archived, that category is shown first as a selected chip labelled "… (archived)" so the entry can be saved unchanged. (M3) Under the grid, for new entries only, a switch row **Repeat every month on day N** (N follows the chosen date; off by default). At 375×812 it starts half hidden behind the keypad, and the body scrolls to it. With it on, Save writes a recurring template from the entry's month and the entry itself, as the template's first, in one batch (§6).
6. **Save** button reads "Add €12.50 · Groceries" and is disabled until amount > 0 and a category is chosen. The keypad and the Save button are fixed at the bottom of the sheet and the amount stays pinned at the top; only the date, note and category rows scroll on short phones.
7. Edit mode: same sheet prefilled, with Delete in the header. (M3) Delete has no confirm: the sheet closes, the entry is deleted at once, and a "Deleted" toast offers Undo for 6 s (the time stops while the toast has the focus or the pointer), which writes the entry back under its own id with the same `at` and `createdAt`. Edit mode shows no switch; an entry made from a template is edited like any other. Opening any sheet takes away a pending toast that has a button (§11).
8. (M2) **Suggestion chips** in a "Quick add" row directly under the amount block: the 4 most frequent (category, amount, note) combos of the last 60 days, e.g. "☕ Coffee €3.50", never for an archived category and never one already logged today. One tap fills kind, amount, category and note; Save confirms. (M3) Entries made by a template do not count.

Tap count for a normal expense: + → digits → category → Save.

### Categories

- Tabs Expense | Income. List in `order`; archived ones in a collapsed section.
- Add/Edit sheet: name, **icon picker** (searchable grid of the curated Lucide set), **color row** (17 swatches), Archive toggle, Move up / Move down.
- (M3) For expense categories, the sheet also has a **Monthly budget** field (decimal keypad, a decimal comma accepted, 16 px; a valid value reads back as "<limit> a month") and a "No budget" button that clears it; Save writes the limit only when the field was changed. An archived category's limit rests: its sheet shows it and can clear it, but it counts nowhere until the category is unarchived. A budgets read error shows as a toast.
- Defaults are seeded on first run (about 20 expense + 6 income categories, see M1 plan); you can rename, recolor, or archive any of them.

### Trends (M2) — compare over time

- Range chips: 3M · 6M · 12M · YTD.
- **Monthly bars** of expenses with income as dots on the same axis; tap a bar to see that month's totals; the selected month links to Home.
- **Category filter** chips (multi-select) narrow the bars to those categories.
- **Table** under the chart: Month · Spent · Income · Net · Δ vs. previous month.
- **Compare two months**: pick A and B → per-category table with absolute and % deltas, sorted by biggest change. Answers "why was September so expensive?".
- **Category detail** (from a Home breakdown row, a Compare row, or the "History" link in the category edit sheet; transaction rows open the edit sheet instead): 12-month bars for that category, average per month, and its transaction list for the tapped month. Back returns to where you came from.

### Settings

- Currency (change only affects formatting; amounts are not converted, the UI says so; a confirm appears only when the decimals differ, §11).
- (M3) **Recurring**: a row with the number of templates that have not ended (no end, or an end this month or later), opening the Recurring page.
- (M3) **Data**: Export CSV, Export JSON and Import CSV, under the caption "CSV opens in a spreadsheet. JSON is a full backup, with categories, budgets and recurring entries." An export reads every document once, from the server, never from the cache, so offline it fails instead of saving part of the data. The row reads "Exporting…" while it reads. On a touch device that can share files, the file goes to the share sheet (on iOS that is the way to save it to Files); elsewhere it downloads, a Mac included.
  - CSV: the entries, columns `id,date,kind,amount,currency,category,note,source`, newest first; the amount a plain decimal in the currency's scale, the category by name ("Uncategorized" for a removed one); UTF-8 with a BOM, CRLF, RFC 4180 quoting.
  - JSON: `{ exportedAt, currency, categories, budgets, recurring, transactions }`, every document as the app reads it, timestamps as ISO strings (null for one that is no valid moment, which only a hand-made document has), amounts in minor units. There is no JSON importer yet: restoring one is a manual job.
  - Toasts: "Exported N entries"; "Could not export while offline"; on iOS, when the read outlasted the tap's window for the share sheet, "N entries ready to export" with a Share button (10 s) that hands over the file already built. A dismissed share sheet says nothing.
- (M4) **Siri & Apple Watch** → `/shortcut`: a row reading "Password set" or "Not set up", from whether the signed-in user has a password credential, opening the Siri & Apple Watch page (below).
- Install hint when not running standalone on iOS: "Share → Add to Home Screen".
- Sign out, app version.

### Recurring (M3)

- Settings → Recurring (`/recurring`; Back returns to Settings). Every template, by start month: icon, category name ("Uncategorized" for a removed one), note, amount (income with a + in the accent), and "Every month on day N · since <Month YYYY>", plus " · until <Month YYYY>" once it has an end; that schedule line is built for a valid template only.
- **Stop**, shown while a template runs past this month: ends it with this month. This month's entry stays and no later month gets one. M3 has no Resume and no Undo for Stop.
- **Delete template**: no confirm. The template goes at once and a "Template deleted" toast offers Undo for 6 s, which writes it back as it was. The entries it made stay either way.
- A template the rules would refuse (only a hand edit in the console makes one) reads "Invalid template" instead of its schedule, offers Delete only, without Undo, and is never materialised. Its months are kept as stored, and a mistyped month such as `2026/10` cannot be formatted, so building the line anyway would send the page to the error screen.
- Empty: "Nothing repeats yet. Turn on 'Repeat every month' when adding an entry."

### Import CSV (M3)

A sheet from Settings → Import CSV, for migrating from another app (a Money Manager CSV export needs no change) and for re-importing this app's own CSV.

1. **File**: a CSV with a header row, `,` or `;` as the separator, read as UTF-8; a file with unreadable characters gets a hint to save it as UTF-8.
2. **Columns**: a select per field (Date, Amount, Kind, Category, Note), filled in from the header; an "Amount" column wins over one named after a currency. Without a kind column, "Negative amounts are expenses" (on). With one, "Kind values" maps each distinct value (up to 8) to Expense, Income or Skip; transfers are skipped by default, since the app has no accounts. A "Slash dates" select (day first or month first, with an example line) appears only when a date such as 03/04/2026 reads two ways; otherwise the file's own dates decide, day first by default.
3. **Preview**: the first 5 rows as they will be imported, "N of M rows ready to import", how many notes and category names will be shortened, "N rows keep this app's own ids (existing entries with those ids are replaced)." (or "1 row keeps this app's own id (an existing entry with that id is replaced)."), and the first five rows that cannot be imported, by line.
4. **Import**: "Import N entries" creates the missing categories (matched by kind and name ignoring case, archived ones included; a new one is slate `CircleEllipsis` after the last of its kind) and writes the entries in batches of 400, all sent at once, with a progress line "N of M written". It is the one write the app waits for. Then a toast "Imported N entries · M new categories", and Home opens on the latest imported month. A failure says how far it got ("Imported 601 of 1,001 entries; the rest failed: …") and leaves the sheet open; choosing the file again is safe.

- Rows are cleaned to what the app stores: a note becomes one line, cut to 200 characters; a category name is cut to 40; a row without a category goes to "Other". Dates: `YYYY-MM-DD` (also with `/` or `.`), `DD.MM.YYYY`, `DD-MM-YYYY`, `DD/MM/YYYY` or `MM/DD/YYYY`, a time after them ignored. Amounts: either decimal mark (decided per column), thousands grouping, a minus before or after, or parentheses. A zero, unreadable or too-large amount and an unreadable date are reported, not guessed.
- Imported entries carry `source: "import"` and never a `recurringId`. Their ids (§6) make a second import of the same file overwrite instead of doubling. A row of this app's own export keeps its id, but only ids in the shapes this app writes are taken (any other id column is ignored), so re-importing that export changes no count. It does revert edits made since the export and brings back entries deleted since; a template's entry comes back as an ordinary imported entry, without its `recurringId`, and the template never writes that month again. A CSV restores entries only: `at` becomes local noon for a back-dated row, and icons, colours, budgets and templates are not in it.

### Siri & Apple Watch (M4)

Settings → Siri & Apple Watch (`/shortcut`; Back returns to Settings) holds what the Shortcut of §14 needs, under the intro "An Apple Shortcut adds expenses from Siri, the watch and the Action button. It signs in with a password that only the Shortcut knows." It has four numbered parts:

1. **Shortcut password**: "Password set" or "No password yet"; "Create password" while there is none, "Reset password" and "Remove" once there is one. Create and Reset generate 24 characters from `A-Za-z0-9` (`crypto.getRandomValues`); Create links them to the signed-in Google user as an email/password credential, and Reset changes that password. The new password shows once, in a copy field, with "Shown once. Paste it into the Shortcut now." The app never stores it; whether one exists is read from the user's providers (`password`). Remove unlinks it: "Password removed. The Shortcut stops working until you create a new one." A failure shows as an alert line under the buttons (§11).
2. **Values for the Shortcut**: copy fields for "Project id", "Web API key", "Email", "Expense categories" and "Income categories", with "Copy again after you add or rename categories." under the two dictionaries. A dictionary maps the name of each active category of its kind to its id, in category order, as JSON indented by two spaces; a repeated name gets " (2)", " (3)" and so on. Copy puts the value on the clipboard ("Copied"); where the clipboard cannot be used, it selects the text instead ("Select and copy the text").
3. **Test it here**: a "Shortcut password" field (16 px, kept only while the page is open) and "Send a test entry", which makes the Shortcut's two calls (§14) and adds a real entry: 0.01 (one minor unit) in the first active expense category, note "Shortcut test", dated today. Its toast "Test entry added" offers Undo for 6 s, which deletes the entry. When the token's email is not marked verified, the line reads "Your email is not marked verified for password sign-in." with "Send verification email" (toast: "Verification email sent. Open the link, then test again."). Other failures show their sentence (§11). The button is disabled while a test runs and when there is no expense category.
4. **Build the Shortcut**: the 14 actions of the recipe, each a title and one sentence, then a short paragraph on "Show on Apple Watch", the Siri phrase, the complication and the income copy, and the link "Full recipe and troubleshooting" to `docs/shortcut.md` on GitHub.

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

`Button` (primary / ghost / danger), `Sheet` (bottom sheet, full-height variant, swipe-down to close is a nice-to-have), `SegmentedControl`, `Keypad`, `AmountDisplay`, `CategoryChip`, `IconPicker`, `ColorPicker`, `MonthSwitcher`, `SummaryCard`, `BreakdownRow`, `TransactionRow`, `DayGroup`, `EmptyState`, `Toast`, and in M2 `BarChart`, `DailyStrip` and `DeltaBadge` as small hand-written HTML/CSS components (no chart library: smaller bundle, exact theming, real buttons for accessibility). M3 adds `BudgetField`, `RecurringToggle`, `MonthPickerSheet`, `SearchBar` and `ImportSheet`, and gives `Toast` an action button.

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
- **Day totals**: sums grouped by `date`; the daily strip plots expenses only. (M3) While a search is on, a day header sums that day's matching entries only.
- **Pace** (M2): spent from day 1 through today, compared with the previous month over the same number of days; delta shown in % with a sign. Only shown for the current month.
- **Δ vs. last month** (M2): per-category difference, absolute and %; new categories show "new"; categories that dropped to zero show −100 %. For a past month both sides are full-month totals; for the current month the previous month is cut to the same day of month (the pace rule), and the legend reads "vs last month to date". On phones only the % badge is shown.
- **Monthly trend** (M2): one bar per month over the range; income plotted as dots; the range is inclusive of the current month.
- **Compare A vs. B** (M2): per-category table of two arbitrary months, sorted by |Δ|.
- **Suggestions** (M2): group transactions of the last 60 days by (kind, categoryId, amount, note), rank by count then recency, take 4, exclude combos already used today. (M3) Entries made by a template do not count, here or in the Add sheet's category order.
- **Budgets** (M3): a monthly limit per expense category; progress = category month total ÷ limit. The state is "under" below the limit, "at" exactly at it and "over" past it. The bar fills to 100 % and turns `expense`-colored from 100 % on (at and over); the row says " · at limit" at 100 % and " · <overage> over" past it. Only active expense categories with a budget count, for the bars, the empty rows and the summary line; an archived category's limit rests. There is no to-date rule: the month's whole total, future-dated entries included, is compared with the limit, for the current, a past or a future month alike, and a past month uses today's limits (no history).
- **Recurring** (M3): templates applied client-side, creating ordinary transactions with `source: "app"`, a `recurringId` and the deterministic id of §6. The materialiser in the app shell runs at launch, on each new snapshot of the template list and on each return to the foreground. A template owes every month from the month after `lastAppliedMonth` (never before `startMonth`) through the current month, or through `endMonth` when that comes first. One batch per template holds its entries and moves `lastAppliedMonth` to the last of them, at most 24 months per run, oldest first; the next snapshot carries on with the rest. It writes only from a list the server has confirmed, so an offline launch materialises nothing until a server snapshot arrives. `lastAppliedMonth` is a high-water mark: a deleted entry is never written again, and an edited one keeps its edit. A template the rules would refuse is skipped; its stored months are never repaired, so a malformed one (only a console edit makes one) marks the template invalid instead of rewriting months. A failed batch shows one toast and is retried at the next launch, not in the same session. Materialisation is month-granular: an entry exists from the 1st of its month, so the month total and the budget line include an entry dated later in the month, while the pace line (spent through today) leaves it out until its date. The device's clock decides the current month: a clock far ahead writes months ahead. The deterministic ids and the confirmed list matter mostly with a second device (phone and Mac): two devices then write a month into one document, and a stale cached copy cannot write months the other device already wrote.
- **Search** (M3): an entry matches when its kind fits the filter and the trimmed query is part of its note or of its category's displayed name. Both sides are folded: lower case, accents dropped (NFD without combining marks) and "ł" read as "l", so "zabka" finds "Żabka"; "ß", "æ", "ø" and "đ" are not folded.

## 10. Roadmap

Each milestone ships a usable app and gets its own implementation plan. The plans for Milestones 1–4 are written and executed.

| Milestone | Scope | Acceptance |
|---|---|---|
| **M0 — Setup** (≈ 20 min, manual) | Auth spike done (popup works in the installed food-tracker). Create Firebase project `money-tracker-vlad` (Spark; Firestore Standard/Native, region `eur3`; Google provider; Hosting). Until then the app runs on the emulators. | The project exists; rules deployed. |
| **M1 — Core logging** (≈ 1 weekend) | Scaffold, theme, auth, rules + rules tests, categories (seed + manage), add/edit/delete with keypad, Home month view with breakdown and day-grouped list, month switcher, currency first-run, PWA manifest/icons/service worker, deploy, device checklist. | On the iPhone home screen: add an expense in under 5 s; works offline and syncs; only your account works. |
| **M2 — Insights** (implemented 2026-10-17) | Trends tab (monthly bars, range chips, category filter, table), Compare A vs. B, category detail, pace line and Δ on Home, daily strip, suggestion chips. Home keeps the viewed month in the URL so drill-downs and Back return to it. | "Was this month more expensive than last, and why?" is answered in two taps. |
| **M3 — Power features** (implemented 2026-10-19) | Budgets with progress, recurring transactions, search/filter of the month list on Home, month/year picker, export JSON/CSV, import CSV, undo toast on delete, bundle/perf pass (every page but Home and Login lazy-loaded, which took only about 3 kB off the first load; Firebase alone is ~189 kB gzipped; the first paint ships at ≈ 302 kB gzipped against a 320 kB target, all JS at ≈ 323 kB against the 350 kB budget). | Monthly bills appear by themselves; old data imported; backup is one tap. |
| **M4 — Siri & Apple Watch** (implemented 2026-10-20) | An email/password credential linked to the Google account for REST, created, reset and removed in the app; the Settings page `/shortcut` with the values to copy, a test of the Shortcut's two calls from the app, and the recipe (`docs/shortcut.md`); Shortcut "Add expense" that signs in and POSTs to Firestore, `source: "shortcut"`; watch complication and Siri phrase; an emulator test of the two calls against the rules, which did not change. The run from the watch with the phone away is on the device checklist. | "Hey Siri, add expense" on the watch creates a transaction that appears in the app within seconds. |

Stretch ideas, deliberately out of scope until the above exists: accounts and transfers, multi-currency with rates, receipt photos (needs Blaze for Storage), a weekly push summary (needs a sender; doable for free from a GitHub Actions cron + FCM, but YAGNI), shared use with a second person.

## 11. Error handling and edge cases

- **Offline writes**: Firestore queues them; the UI shows the entry immediately. A small "Syncing…" badge appears in the top-right corner of the summary card while `hasPendingWrites` is true for the visible month (absolutely positioned, so nothing shifts), and disappears on sync. No blocking spinners on add.
- **Quota exhausted** (practically impossible, but on Spark the service stops instead of billing): reads fail with `resource-exhausted`; every page maps read errors through one helper: "Firebase quota reached, data will refresh after midnight PT", "You don't have access to this data (signed in with the wrong account?)" for `permission-denied`, "You're offline and this data isn't cached yet" for `unavailable`. Cached data stays usable. Trends, Compare and the category page also show "Updating…" while a view is served from the cache only, or "Offline — months you haven't opened may be missing" when offline. (M3) The budgets and recurring listeners go through the same helper: Home shows "Could not load budgets: …" under the summary card, Categories a toast, the Recurring page the error line, and Settings a dash for the recurring count.
- **Wrong Google account**: immediate sign-out with "This app only accepts vlad.herasymovychh@gmail.com".
- **Deleted/archived category on an old transaction**: rows render with the stored category name if the category document still exists (archived) or "Uncategorized" in slate if it was removed by hand in the console.
- **Time zones and travel**: `date` is computed on the device at entry time; a transaction stays on the day you logged it. Month boundaries never shift retroactively.
- **Double submit**: Save is disabled while the write is in flight; the sheet closes on local acknowledgement, not on server confirmation.
- **Keypad input**: expressions never produce negative totals; `10 − 15` evaluates to 0 and Save stays disabled.
- **Currency change**: the sheet note says amounts are not converted; a confirm dialog appears only when the new currency has a different number of decimals, because stored minor units are then read at a different scale (12.50 → ¥1,250).
- **Service-worker update**: `autoUpdate`: the new service worker takes over as soon as it is installed (`skipWaiting`, `clientsClaim`), and the next launch runs the new build; no in-app prompt.
- **Stale page code after a deploy** (M3): every page but Home and Login is a lazy chunk. A tab left open across a deploy can ask for a chunk that is gone (the new service worker drops the old precache, and Hosting answers the old file name with `index.html`). Vite's `vite:preloadError` then reloads the page once, onto the page that was asked for. A timestamp in sessionStorage allows one such reload per 10 s, also after the clock was set back; a chunk that still fails reaches the ErrorBoundary, "Something went wrong" with Reload. A cold deep link to a lazy page shows "Loading…" for a moment.
- **Undo and toasts** (M3): one toast at a time. A deleted entry or template can be restored from its toast for 6 s; a second delete replaces the first toast, so Undo covers the most recent delete only. A failed delete replaces the toast with "Could not delete: …" and Firestore puts the entry back; a failed Undo of an entry shows "Could not undo: …" for 6 s. Toasts sit above sheets (z-60 over z-50), so opening any sheet takes away a toast that has a button (Undo, Share), which would otherwise take the taps meant for the sheet; a plain toast stays and lets taps through. One exception, accepted: the export's "N entries ready to export · Share" toast can come up over a sheet opened while the export was still reading, and then takes the taps of the sheet's lower part for up to 10 s. The time of every toast with a button, the 6 s Undo and the 10 s Share alike, stops while the pointer is over it or the keyboard focus is in it, and then runs on with the time it had left, so a keyboard or VoiceOver user can reach the button; on a phone a touch holds it only while the finger is down. A plain toast keeps its 3 s. The toasts' row is a polite live region mounted from the start, so that a toast is announced once (to be confirmed with VoiceOver on the device).
- **Exports offline** (M3): exports read from the server only, so offline they fail with "Could not export while offline", by design: a backup made from the cache could silently miss months. Other failures read "Could not export: …" with the read-error text.
- **Imports** (M3): offline, the rows reach the cache and Home at once and sync later; the progress line counts the rows the server has confirmed. A failure, a quota stop included, says how many rows were written, and importing the file again is safe. A day's 20,000 writes cover a 10,000-row file once.
- **Recurring failures** (M3): a refused batch shows "Could not add the repeating entries: …" and is not sent again in that session; the next launch tries again.
- **Rules deploy window** (M3): within one `npm run deploy` the rules are released seconds before hosting, but new rules take up to a minute to apply. A phone that reloads into the M3 build in that minute runs against the M2 rules, which deny `budgets` and `recurring`. Home then shows "Could not load budgets: …", Categories a toast, the Recurring page its error and Settings a dash; nothing is materialised in that session; Export JSON fails (Export CSV works); a repeating entry saved then is refused as a whole and disappears again ("Could not save: …"), and so is a new budget. A failed listener stays failed until it is attached again (a relaunch attaches all of them anew), so a relaunch after the minute recovers everything but such an entry. Hence the order in §13: rules first, a minute's wait, then `npm run deploy`.
- **Siri & Apple Watch** (M4): the page's failures read as sentences, never as JSON. Creating, resetting or removing the password: "Email/password sign-in is off. Turn it on in Firebase Console → Authentication → Sign-in method." while the provider is off, "A Shortcut password already exists. Reset it instead.", "There is no Shortcut password to remove.", "Sign-in was cancelled.", "You're offline.", or the error's own message. When Firebase wants a recent sign-in for one of the three (`auth/requires-recent-login`), the app opens the Google popup once and tries again; a second refusal is shown. The test: the same console sentence, "Wrong password. Reset it in step 1 and paste the new one.", "Too many attempts. Try again in a few minutes.", "Firestore refused the entry. The email must be the owner's and verified (see step 3).", "You're offline.", the quota sentence above for a `429` or `RESOURCE_EXHAUSTED`, or "Something went wrong (<code or status>)." The Shortcut's own failures and their fixes: `docs/shortcut.md` (Troubleshooting).

## 12. Testing strategy

- **Unit tests (Vitest)** for every pure module: money formatting and minor-unit parsing, date utilities, keypad expression engine, statistics (totals, grouping, pace, deltas, suggestions, and in M3 budget progress), CSV export/import, and in M3 the recurring months and the search folding.
- **Rules tests** with `@firebase/rules-unit-testing` against the Firestore emulator: owner allowed, other verified email denied, unverified owner denied, anonymous denied, schema violations denied (negative amount, bad date, long note). (M3) Four files: the rules themselves (budgets and recurring included, list queries too), and three that run the app's own data layer against the real rules: Undo's restore, the recurring writes (the one-batch create, 24-month runs, refusals as a whole) and import/export (batches of 400, server-only reads).
- **Script tests** (M3): `npm run test:scripts` runs `node --test scripts/*.test.mjs` for the `.mmbak` dump script on `node:sqlite` (`node --test scripts/` would read the folder as one file).
- **Component tests** (Testing Library + jsdom) for the keypad and the Add sheet's enable/disable logic.
- **Device checklist** (manual, in the repo): install to home screen, cold start with airplane mode, add offline then reconnect, sign-in flow in standalone, safe areas on a notched iPhone, no zoom on input focus, icon and splash color.
- **CI** (GitHub Actions): lint + typecheck + unit tests (TZ pinned to Europe/Warsaw so the DST assertions bite) + the script tests + the rules tests on the Firestore emulator, on every push and pull request. Deploys stay manual (`npm run deploy`). (M3) CI also runs `npm run build`, so a broken build fails it; the bundle budgets and the precache are still read off the build by hand. CI sets TZ for the unit tests only, so the rules suite runs in UTC.

## 13. Development workflow and deployment

- Node 24 (Firebase 13 requires ≥ 24.12), npm (as in food-tracker). Scripts: `dev`, `build`, `preview`, `lint` (oxlint), `typecheck`, `test`, `test:rules`, `test:scripts` (M3), `deploy`.
- `.env.local` holds the Firebase web config (copied from the console); `.env.example` documents the keys. `VITE_ALLOWED_EMAIL` holds the owner email for the UI check.
- Local dev talks to the real project (one user, free tier) exactly like food-tracker; the emulator is used only for rules tests. If you prefer, `VITE_USE_EMULATORS=1` switches dev to local emulators.
- Deploy: `npm run deploy` = `npm run build` (typecheck + `vite build`) + `firebase deploy --project money-tracker-vlad` (hosting + rules + indexes). (M3) When the rules change, as they do in M3, deploy them first: `npx firebase deploy --only firestore --project money-tracker-vlad`, wait about a minute for them to apply, then `npm run deploy` (its rules step then has nothing new to release). The M2 client works with the M3 rules, so rules first is always safe, and hosting is never deployed alone; §11 says what a phone sees if it reloads into the new build before the rules apply.
- Repo layout (mirrors food-tracker):

```
money-tracker/
  docs/superpowers/{specs,plans}/
  public/            icons, manifest assets
  src/
    components/      Button, Sheet, Keypad, AmountDisplay, CategoryChip, ... (one component per file)
    context/         AuthContext, AddSheetContext, ToastContext
    hooks/           useCategories, useTransactions, useSettings, useVisibilityTick, (M3) useBudgets, useRecurring, useRecurringMaterialiser
    lib/             firebase.ts, firestore.ts, types.ts, money.ts, dates.ts, keypad.ts, stats.ts, categoryIcons.ts, categoryColors.ts, defaultCategories.ts, readError.ts, (M3) recurring.ts, search.ts, csv.ts, exporting.ts, chunkReload.ts
    pages/           LoginPage, HomePage, CategoriesPage, SettingsPage, (M2) TrendsPage, CategoryPage, (M3) RecurringPage
    index.css        tokens + base styles
  scripts/           (M3) mmbak-dump.mjs and its node:test file
  tests/rules/       Firestore rules tests, and (M3) the data layer against the real rules
  firebase.json, .firebaserc, firestore.rules, firestore.indexes.json
```

## 14. Siri and Apple Watch quick add (Milestone 4)

An Apple Shortcut, "Add expense", adds an entry from the iPhone or the Apple Watch: from Siri ("Hey Siri, add expense"), the Shortcuts app, a watch-face complication or the Action button. It asks for the amount and the category, then makes two HTTP calls, so there is no server and no App Store. A copy with `"income"` and the income categories adds income.

It signs in with an email/password credential linked to your Google account. Settings → Siri & Apple Watch (§7) generates the password (24 characters from `A-Za-z0-9`), shows it once and never stores it; it lives in the Shortcut, in your iCloud. Reset and Remove on that page revoke it. The Email/Password provider is turned on once, by you, in Firebase Console → Authentication → Sign-in method ("Email link (passwordless)" stays off).

The two calls, which the page's "Send a test entry" also makes:

1. `POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<web API key>`, JSON `{"email":"<owner email>","password":"<password>","returnSecureToken":true}` → `idToken`, a JWT whose payload carries `email` and `email_verified`.
2. `POST https://firestore.googleapis.com/v1/projects/<project id>/databases/(default)/documents/transactions`, headers `Authorization: Bearer <idToken>` and `Content-Type: application/json`, JSON `{"fields":{"kind":{"stringValue":"expense"},"amount":{"integerValue":"1250"},"categoryId":{"stringValue":"<id>"},"note":{"stringValue":""},"date":{"stringValue":"2026-10-20"},"at":{"timestampValue":"2026-10-20T17:05:00Z"},"source":{"stringValue":"shortcut"}}}` → `200` with the document, whose `name` ends in the new auto-id; `403 PERMISSION_DENIED` when the rules refuse, `401` for a bad token, `400` for a malformed body. `integerValue` is a JSON string; `timestampValue` is RFC 3339, with an offset (`+02:00`) or `Z`.

The entry carries no `recurringId` and no `createdAt`/`updatedAt` (REST cannot set server timestamps; both are optional, §6). The rules did not change for M4: they already accept `source: "shortcut"`, and the entry passes the same checks as one made in the app. The web API key is public by design; the rules and the password are what protect the data.

The recipe, action by action, with Siri and the watch, the income copy, troubleshooting and the security note: [`docs/shortcut.md`](../../shortcut.md).

## 15. Decisions confirmed by Vlad (2026-10-14)

1. **Currency**: PLN preselected on first run.
2. **Region**: Europe → Firestore location `eur3`.
3. **Auth**: Google popup sign-in verified in the installed food-tracker; mirrored here.
4. **Name**: "Money Tracker" (folder `money-tracker`, Firebase project `money-tracker-vlad`).
5. **Scope of M3**: budgets and recurring transactions are in.
6. **Existing data**: a "Money Manager" backup file exists and arrives after all milestones. Its format is inspected when the file is dropped into the repo (`imports/`, git-ignored). The in-app import (Settings → Import CSV, §7) maps the columns of any CSV, so Money Manager's own CSV export goes in as it is, with no converter. If the backup is a Realbyte `.mmbak` (SQLite), `scripts/mmbak-dump.mjs` dumps each of its tables to a CSV, so you can see whether the data can go through that import; it converts nothing and writes nothing to Firestore. There is no JSON importer in M3.
7. **Language**: English only.
8. **Firebase project**: created later by Vlad; until then everything runs on the emulators (§5).

Milestone 3 (2026-10-19): item 9 is Vlad's; the others were ruled on his behalf during execution, and `docs/m3-rulings.md` records each with what it costs if wrong.

9. **Search folds accents** (for Polish text): "zabka" finds "Żabka" (§9).
10. **Deletes have no confirm**: an Undo toast for 6 s replaces it, for entries and for templates. The currency-scale confirm (§11) is the one dialog left.
11. **Budgets**: one limit per expense category, with no history and no to-date rule; only active expense categories count; "at limit" at exactly 100 %, the expense colour from 100 % on (§9).
12. **Recurring**: deterministic entry ids; a new template and its first entry in one batch; materialised only from a list the server has confirmed, at most 24 months per run (§6, §9).
13. **Search placement**: the bar opens above the day list and the page jumps to it; the device pass decides whether it stays (§7).
14. **Exports**: from the server only, so offline they fail; the share sheet on a touch device, a download elsewhere; the JSON is the full backup and has no importer yet (§7).
15. **Import ids**: content ids, so a second import overwrites instead of doubling; the app's own export keeps its ids, taken only in the shapes the app writes (§6, §7).

Milestone 4 (2026-10-20): items 16 to 18 were ruled on Vlad's behalf when the plan was written, and `docs/m4-rulings.md` records each with what it costs if wrong.

16. **Shortcut sign-in**: an email/password credential linked to the Google account, with a password the app generates and shows once, instead of the SDK's refresh token. A password can be reset or removed from the app, and the Email/Password provider turned off in the console; a refresh token does not expire on its own (§5). The rules do not change (§14).
17. **The in-app test writes a real entry**: "Send a test entry" makes the Shortcut's two calls and adds 0.01, with Undo on its toast. It checks the provider, the password, the token's verified email and the rules on the phone before the Shortcut is built; an email not marked verified gets "Send verification email" (§7).
18. **Categories pasted once**: the Shortcut carries a name → id dictionary copied from the app and fetches no categories when it runs on the watch. The page builds the dictionary again at any time; copy it again after adding or renaming categories. An entry written with an older copy is still valid (§7, §14).

## 16. Alternatives considered

- **Precomputed monthly summary documents** (totals per category updated in a batch with each write): fewer reads for Trends, but every edit must adjust two months' summaries and drift is possible. Not needed at this data volume; can be added behind the same `stats` functions later.
- **Firestore aggregation queries** (`sum`): cheap, but they do not work offline and would need one query per category per month. Client-side reduce is simpler and offline.
- **Svelte/SvelteKit** for a smaller bundle: real gain of maybe 30 kB, at the cost of leaving the stack you know. React is fine here; the budget is 350 kB gzipped (M1 ships at ~295 kB).
- **Chart library (Recharts/Chart.js)**: 40–100 kB for two chart types. Hand-written SVG bars and a share bar are under 150 lines.
- **Email magic link** sign-in: the link opens in Safari, not in the home-screen app, so the session would land in the wrong context. Rejected.
- **Capacitor wrapper** to reach the App Store/TestFlight: solves OAuth web-view issues but brings back the $99/year and Xcode. Rejected for the same reason as native.
- **Subcollections under `users/{uid}`**: nicer for multi-user; unnecessary now and would complicate the Shortcut's REST paths. Root collections with owner rules, as in food-tracker.
