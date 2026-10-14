# Money Tracker

Personal income/expense tracker that lives on the iPhone home screen as a web app. Dark, keypad-first, fast. Firebase Hosting + Firestore, Google sign-in locked to one email, $0/month on the Spark plan. Apple Watch and Siri entry via an Apple Shortcut, no App Store.

Same stack and shape as [n0rahh/food-tracker](https://github.com/n0rahh/food-tracker): React 19 + Vite + TypeScript + Tailwind v4 + Firebase 12 + vite-plugin-pwa.

## Documents

| Document | What it is |
|---|---|
| [Design spec](docs/superpowers/specs/2026-10-14-money-tracker-design.md) | The whole product: decisions, architecture, data model, screens, design system, analytics definitions, roadmap, Watch recipe, open questions |
| [Milestone 1 plan](docs/superpowers/plans/2026-10-14-m1-core-logging.md) | Step-by-step implementation plan with code and tests for the first shippable version |

## Decisions in one screen

- **Web app, not native.** A native iOS/watchOS app would need the $99/year Apple Developer Program just to stay installed. iOS 26 opens home-screen sites as web apps by default; with a manifest and icons it feels native and works offline.
- **Apple Watch via Shortcuts.** watchOS cannot run web apps, but the Shortcuts app runs on the watch and can POST to Firestore's REST API. "Hey Siri, add expense" works from the watch, the phone, a complication and the Action Button. Milestone 4.
- **No server code.** Cloud Functions and Cloud Storage need the Blaze plan. Everything (totals, comparisons, recurring entries) runs on the client over your own data; Firestore's offline cache makes it instant.
- **Security = Firestore rules.** Every read/write requires `email == vlad.herasymovychh@gmail.com` and `email_verified`, plus schema validation. The UI check is cosmetic.
- **Google sign-in, with a tested fallback.** Popup in a browser tab, redirect in the home-screen app with `authDomain` on the app's own host. If iOS still blocks it, email + password (sign-up disabled) is pre-planned and also powers the Watch shortcut.
- **Integers for money, ISO strings for dates.** `amount` in cents, `date` as local `YYYY-MM-DD`; one composite index.

## Roadmap

| Milestone | Scope |
|---|---|
| M0 | Auth spike with food-tracker on the phone; create Firebase project `money-tracker-vlad`; pick currency |
| M1 | Sign-in, categories (seeded + editable), add/edit/delete with keypad, month view, PWA, deploy |
| M2 | Trends (monthly bars, ranges, category filter), compare two months, category detail, pace line, suggestion chips |
| M3 | Budgets, recurring transactions, search, month picker, export/import, undo, perf pass |
| M4 | Siri + Apple Watch quick add through a Shortcut |

## Start here (Milestone 0, about 30 minutes)

1. On the iPhone, open https://food-tracker-vlad.web.app as a home-screen app, sign out, sign in with Google. Note whether it works in that standalone window; it decides which auth branch M1 uses (spec §5).
2. Create the Firebase project as described in the M1 plan, Task 4, Step 1.
3. Decide the default currency and Firestore region (spec §15).
4. Run the M1 plan task by task.

## Open questions

See spec §15: currency, Firestore region, auth result from step 1 above, app name, whether budgets/recurring are wanted, data to import, English-only UI.
