# Money Tracker

Personal income/expense tracker that lives on the iPhone home screen as a web app. Dark, keypad-first, fast. Firebase Hosting + Firestore, Google sign-in locked to one account, $0/month on the Spark plan. Apple Watch and Siri entry come through an Apple Shortcut, no App Store.

Same stack and shape as [n0rahh/food-tracker](https://github.com/n0rahh/food-tracker): React 19 + Vite 8 + TypeScript + Tailwind v4 + Firebase 13 + vite-plugin-pwa.

- Project: `money-tracker-vlad` · App: https://money-tracker-vlad.web.app
- Owner (locked in Firestore rules): `vlad.herasymovychh@gmail.com`

## Documents

| Document | What it is |
|---|---|
| [Design spec](docs/superpowers/specs/2026-10-14-money-tracker-design.md) | The whole product: decisions, architecture, data model, screens, design system, analytics definitions, roadmap, the Siri and Watch Shortcut in brief |
| [Milestone 1 plan](docs/superpowers/plans/2026-10-14-m1-core-logging.md) | The executed implementation plan for the first shippable version (code blocks synced through Task 16; the final review's fixes, such as the sync badge, month follow-on-resume and the error boundary, are described in the spec) |
| [Milestone 2 plan](docs/superpowers/plans/2026-10-17-m2-insights.md) | The executed plan for Trends, Compare, the category page, the pace line, the daily strip and the suggestion chips |
| [Milestone 3 plan](docs/superpowers/plans/2026-10-17-m3-power.md) | The executed plan for budgets, recurring entries, search, the month picker, undo, export/import and the lazy pages; its "Deviations accepted in execution" block says where the code differs from its task text |
| [Milestone 4 plan](docs/superpowers/plans/2026-10-20-m4-shortcut.md) | The executed plan for the Siri & Apple Watch quick add: the Shortcut password, the REST client and its emulator test, the Settings page with the in-app test, and the recipe |
| Rulings: [M1](docs/m1-rulings.md), [M2](docs/m2-rulings.md), [M3](docs/m3-rulings.md), [M4](docs/m4-rulings.md) | The decisions taken on the owner's behalf while executing each plan, in order, each with what it costs if wrong |
| [Device checklist](docs/device-checklist.md) | First-deploy steps and the iPhone verification list |
| [Shortcut recipe](docs/shortcut.md) | How to build the Apple Shortcut for Siri and the watch, action by action, with the income copy, troubleshooting and the security note |

## Decisions in one screen

- **Web app, not native.** A native iOS/watchOS app would need the $99/year Apple Developer Program just to stay installed. iOS 26 opens home-screen sites as web apps by default; with a manifest and icons it feels native and works offline.
- **Apple Watch via Shortcuts (Milestone 4).** watchOS cannot run web apps, but the Shortcuts app runs on the watch and can POST to Firestore's REST API.
- **No server code.** Cloud Functions and Cloud Storage need the Blaze plan. Everything runs on the client over your own data; Firestore's persistent cache makes it instant and offline-capable.
- **Security = Firestore rules.** Every read/write requires `email == vlad.herasymovychh@gmail.com` and `email_verified`, plus schema validation. The UI check is cosmetic. Rules are tested against the Firestore emulator.
- **Google sign-in with a popup everywhere.** Verified to work inside the installed home-screen app with food-tracker, so no redirect flow and no custom auth domain.
- **Integers for money, ISO strings for dates.** `amount` in minor units with a static ISO 4217 digits table (never the browser's locale data, which differs between devices); `date` as local `YYYY-MM-DD`; one composite index (`date DESC, at DESC`).
- **Never wait for the network.** Writes are applied to the local cache first; sheets close immediately and failures surface as toasts. A "Syncing…" pill shows while writes are pending. The one write the app waits for is a CSV import, which shows its progress.

## Local development

```bash
cp .env.example .env.local   # fill in the web app config from Firebase Console → Project settings → Your apps
npm install                  # Node ≥ 24.12 (Firebase 13 requires it)
npm run dev                  # http://localhost:5173, talks to the real project
```

To develop without the real project, put these in `.env.local` (any non-placeholder key/app id works against the emulators; the project id must match `--project` below): `VITE_FIREBASE_API_KEY=demo-key`, `VITE_FIREBASE_AUTH_DOMAIN=localhost`, `VITE_FIREBASE_PROJECT_ID=demo-money-tracker`, `VITE_FIREBASE_APP_ID=demo-app`, `VITE_USE_EMULATORS=1`, and run the emulators in a second terminal:

```bash
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"   # the emulators need a JDK
npx firebase emulators:start --only auth,firestore --project demo-money-tracker --import=./.emulator-data --export-on-exit=./.emulator-data
```

The Auth emulator's "Add new account" screen accepts the owner email; the rules require `email_verified`, which the emulator sets for fake Google accounts.

## Checks

```bash
npm run typecheck
npm run lint
npm test                      # Vitest + Testing Library (jsdom)
npm run test:scripts          # node:test for scripts/ (the .mmbak dump)
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH" && npm run test:rules   # 5 files against the Auth and Firestore emulators: the rules, the app's own writes and reads, and the Shortcut's exact HTTP calls
npm run build                 # warning-free; first paint ≈ 305 kB gzipped (budget 320), all JS ≈ 333 kB (budget 350)
```

## Deploy

```bash
npx firebase deploy --only firestore --project money-tracker-vlad   # 1. rules + composite index (first time, and whenever they change); then wait about a minute
npm run deploy                                                       # 2. build + hosting + rules + index
```

The build inlines `.env.local`, so it must hold the real config (and `VITE_USE_EMULATORS=0`) before deploying. Production builds never include the emulator hookup. Follow [docs/device-checklist.md](docs/device-checklist.md) for the first deploy and the iPhone verification.

Milestone 3 changes the rules, so deploy them first: run the `--only firestore` line, wait about a minute for the rules to apply, then run `npm run deploy` (its rules step then has nothing new to release). The M2 client works with the M3 rules, so this order is always safe; never deploy hosting alone. One `npm run deploy` does release the rules seconds before hosting, but a phone that reloads into the new build before they apply runs against the M2 rules: budgets and recurring show permission errors, nothing is materialised, Export JSON fails, and a repeating entry saved in that minute disappears. Relaunching the app after the minute recovers everything but that entry.

## Backups and import

Settings → Data has Export CSV, Export JSON and Import CSV. Exports read from the server, so they need a connection (offline they fail rather than save part of the data). On the iPhone the file goes to the share sheet (Save to Files); on a computer it downloads.

- **Export JSON** is the full backup: categories, budgets, recurring templates and every entry. There is no JSON importer yet, so restoring one is a manual job.
- **Export CSV** holds the entries only (`id,date,kind,amount,currency,category,note,source`), for a spreadsheet.
- **Import CSV** takes any CSV with a header row and lets you match its columns; a Money Manager CSV export works as it is. Importing the same file again overwrites instead of doubling, and re-importing the app's own CSV export puts every entry back under its own id, so the count does not change. It also reverts edits made since that export and brings back entries deleted since. A CSV restores entries only: icons, colours, budgets and templates are not in it.

A Money Manager `.mmbak` backup is an SQLite database. To see what is in it, dump every table to a CSV with Node ≥ 24.12 (nothing is converted, nothing goes to Firestore):

```bash
node scripts/mmbak-dump.mjs <file.mmbak> <outDir>   # one <table>.csv per table, with row counts; exit 1 if not SQLite or not readable/writable, 2 for wrong arguments
```

Keep the backup and the dump under `imports/` (for example `node scripts/mmbak-dump.mjs imports/backup.mmbak imports/backup-tables`): the folder is git-ignored, and both are personal data.

## Siri and Apple Watch

An Apple Shortcut, "Add expense", adds an entry from Siri, the Apple Watch, a watch-face complication or the Action button. It signs in with a password linked to your Google account and writes the entry through Firestore's REST API, so there is still no server and no App Store.

1. Once, in Firebase Console → Authentication → Sign-in method: add **Email/Password** and enable it (leave "Email link (passwordless)" off). The app cannot turn it on itself. Also keep Authentication → Settings → User actions → "Enable create (sign-up)" on until the password exists: the app links it through sign-up.
2. In the app, Settings → Siri & Apple Watch: create the password (shown once, never stored), then turn "Enable create (sign-up)" off again. Copy the seven values and send a test entry; its Undo removes it.
3. On the iPhone, build the Shortcut from [docs/shortcut.md](docs/shortcut.md) and turn on "Show on Apple Watch".

For income, duplicate the Shortcut, change `"expense"` to `"income"` and paste the income categories. "Reset password" on the same page revokes the Shortcut (other signed-in devices may need to sign in again). The rules did not change: an entry from the Shortcut passes the same checks as one made in the app, with `source: "shortcut"`.

## Roadmap

| Milestone | Scope |
|---|---|
| M1 (implemented; first deploy and the iPhone checklist pending) | Sign-in, categories (seeded + editable), add/edit/delete with keypad, month view, PWA, deploy |
| M2 (implemented) | Trends (monthly bars, ranges, category filter), compare two months, category detail, pace line, daily strip, suggestion chips |
| M3 (implemented) | Budgets, recurring transactions, search, month picker, export/import (Money Manager backup), undo, perf pass |
| M4 (implemented) | Siri + Apple Watch quick add through a Shortcut: a password linked to the Google account, a Settings page with an in-app test, the recipe |
