# Money Tracker

Personal income/expense tracker that lives on the iPhone home screen as a web app. Dark, keypad-first, fast. Firebase Hosting + Firestore, Google sign-in locked to one account, $0/month on the Spark plan. Apple Watch and Siri entry come later through an Apple Shortcut, no App Store.

Same stack and shape as [n0rahh/food-tracker](https://github.com/n0rahh/food-tracker): React 19 + Vite 8 + TypeScript + Tailwind v4 + Firebase 13 + vite-plugin-pwa.

- Project: `money-tracker-vlad` · App: https://money-tracker-vlad.web.app
- Owner (locked in Firestore rules): `vlad.herasymovychh@gmail.com`

## Documents

| Document | What it is |
|---|---|
| [Design spec](docs/superpowers/specs/2026-10-14-money-tracker-design.md) | The whole product: decisions, architecture, data model, screens, design system, analytics definitions, roadmap, Watch recipe |
| [Milestone 1 plan](docs/superpowers/plans/2026-10-14-m1-core-logging.md) | The executed implementation plan for the first shippable version (code blocks synced through Task 16; the final review's fixes, such as the sync badge, month follow-on-resume and the error boundary, are described in the spec) |
| [Device checklist](docs/device-checklist.md) | First-deploy steps and the iPhone verification list |

## Decisions in one screen

- **Web app, not native.** A native iOS/watchOS app would need the $99/year Apple Developer Program just to stay installed. iOS 26 opens home-screen sites as web apps by default; with a manifest and icons it feels native and works offline.
- **Apple Watch via Shortcuts (Milestone 4).** watchOS cannot run web apps, but the Shortcuts app runs on the watch and can POST to Firestore's REST API.
- **No server code.** Cloud Functions and Cloud Storage need the Blaze plan. Everything runs on the client over your own data; Firestore's persistent cache makes it instant and offline-capable.
- **Security = Firestore rules.** Every read/write requires `email == vlad.herasymovychh@gmail.com` and `email_verified`, plus schema validation. The UI check is cosmetic. Rules are tested against the Firestore emulator.
- **Google sign-in with a popup everywhere.** Verified to work inside the installed home-screen app with food-tracker, so no redirect flow and no custom auth domain.
- **Integers for money, ISO strings for dates.** `amount` in minor units with a static ISO 4217 digits table (never the browser's locale data, which differs between devices); `date` as local `YYYY-MM-DD`; one composite index (`date DESC, at DESC`).
- **Never wait for the network.** Writes are applied to the local cache first; sheets close immediately and failures surface as toasts. A "Syncing…" pill shows while writes are pending.

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
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH" && npm run test:rules   # Firestore rules against the emulator
npm run build                 # warning-free; JS ≤ 350 kB gzipped
```

## Deploy

```bash
npx firebase deploy --only firestore --project money-tracker-vlad   # rules + composite index (first time, and whenever they change)
npm run deploy                                                       # build + hosting + rules + index
```

The build inlines `.env.local`, so it must hold the real config (and `VITE_USE_EMULATORS=0`) before deploying. Production builds never include the emulator hookup. Follow [docs/device-checklist.md](docs/device-checklist.md) for the first deploy and the iPhone verification.

## Roadmap

| Milestone | Scope |
|---|---|
| M1 (implemented; first deploy and the iPhone checklist pending) | Sign-in, categories (seeded + editable), add/edit/delete with keypad, month view, PWA, deploy |
| M2 (implemented) | Trends (monthly bars, ranges, category filter), compare two months, category detail, pace line, daily strip, suggestion chips |
| M3 | Budgets, recurring transactions, search, month picker, export/import (Money Manager backup), undo, perf pass |
| M4 | Siri + Apple Watch quick add through a Shortcut |
