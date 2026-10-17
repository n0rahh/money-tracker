# iPhone verification checklist (run after every deploy that touches auth, PWA or layout)

Device: iPhone, iOS 26+, Safari. URL: https://money-tracker-vlad.web.app

## First deploy
- [ ] Firestore database created: Build → Firestore Database → Create database → Standard edition → location `eur3` → production mode (the location cannot be changed later).
- [ ] Google sign-in provider enabled: Authentication → Sign-in method → Google.
- [ ] Authentication → Settings → Authorized domains includes `money-tracker-vlad.web.app`.
- [ ] `.env.local` holds the REAL web app config (apiKey, appId, `VITE_FIREBASE_AUTH_DOMAIN=money-tracker-vlad.firebaseapp.com`, `VITE_FIREBASE_PROJECT_ID=money-tracker-vlad`), `VITE_ALLOWED_EMAIL=vlad.herasymovychh@gmail.com` (the address in `firestore.rules`; empty or missing falls back to it) and `VITE_USE_EMULATORS=0`; production builds never include the emulator hookup anyway, but the project id and key are inlined at build time.
- [ ] `npx firebase deploy --only firestore --project money-tracker-vlad` ran and the composite index finished building (Firestore → Indexes).
- [ ] `npm run deploy` printed the Hosting URL.

## Install
- [ ] Open the URL in Safari → Share → Add to Home Screen. The dialog shows the lime icon and the name "Money".
- [ ] The home-screen icon is the generated PNG (not a screenshot). Launching shows a dark splash, no white flash, no Safari chrome.

## Sign-in (decides spec §5)
- [ ] In the installed app: Continue with Google → Google screen → back in the app, signed in (popup flow, same as food-tracker).
- [ ] (While no settings document exists on the server yet — i.e. before the very first currency choice on any device) go offline, launch, then reconnect: the currency prompt appears once the server confirms there are no settings.
- [ ] Force-quit and relaunch: still signed in, Home loads from cache instantly.
- [ ] If sign-in ever fails in the installed app but works in Safari: see the fallbacks in spec §5.
- [ ] In a Safari tab, sign in with a different Google account → "This app only accepts vlad.herasymovychh@gmail.com" and no data loads.
- [ ] Authentication → Settings → User actions: "Enable create (sign-up)" is OFF after your first sign-in and the different-account check above (with sign-up off, Firebase itself refuses an account it has never seen, before the app's message can show).

## Layout
- [ ] Status bar area is dark and the month header is not hidden under the notch/Dynamic Island.
- [ ] The bottom tab bar sits above the home indicator; the + button is reachable with the thumb.
- [ ] Tapping the Note field does not zoom the page.
- [ ] The Add sheet fits on the screen with the keypad fully visible (scroll the sheet body on small phones).

## Behaviour
- [ ] Add an expense: +, "12.5", "+", "3", category, Save → the sheet closes at once; Home shows 15.50 in the selected currency under the right category.
- [ ] Airplane mode on → add another expense → it appears in the list and a "Syncing…" badge shows in the summary card's corner → airplane mode off → the badge goes away and within seconds Firebase Console shows the document.
- [ ] Cold start offline: launch the installed app once online and wait a few seconds (the service worker installs inside the standalone context), force-quit, turn airplane mode on, launch → Home opens with the cached month, no browser error page; opening /categories offline works too.
- [ ] Edit a transaction's amount and date; delete one (confirm dialog appears).
- [ ] Switch to last month and back; the empty state shows for an empty month.
- [ ] Categories: create, recolor, archive, reorder; archived category still labels its old transactions.
- [ ] Settings: change currency → Home reformats; Sign out → login screen; sign in again.
- [ ] First month query on the deployed project succeeds (no failed-precondition: the composite index is built).
- [ ] (optional) Settings shows the "Install as an app" hint in a Safari tab and not in the installed app.
- [ ] (optional) After a redeploy, the installed app shows the new build on the second launch (sw.js is served no-cache).

## Milestone 2 (insights)
- [ ] Trends tab: 6M bars render with income dots; switching to 3M / 12M / YTD re-draws without a stale frame; the range is remembered after a reload.
- [ ] Tapping a bar shows that month's totals and "Open in Home" opens Home on that month; Back returns to Trends.
- [ ] Category filter chips narrow the bars; income dots disappear and income/net read "—" while a filter is on.
- [ ] Phone table (375 px): Month · Spent · Δ with income/net on a second line, no horizontal scroll; Compare shows Category · A · B · Δ badge.
- [ ] Compare: change Month A while scrolled to the bottom; the page does not jump; rows sort by biggest change, "new" and "−100 %" appear where expected; tapping a category opens its page on month B.
- [ ] Home (current month): pace line reads "… by day N · last month by day N: … ±x %"; breakdown rows show deltas with the "vs last month to date" legend; the daily strip highlights today and tapping a day scrolls to it.
- [ ] Home on a past month: no pace line; tapping a breakdown row opens the category page on that month; Back returns to that month.
- [ ] Category page: 12 bars, average per month, tapping a bar lists that month, tapping a row opens the edit sheet; an archived category still opens.
- [ ] Add sheet: "Quick add" chips appear for repeated purchases; tapping one fills amount, category and note; a combo already logged today is not offered; no chips when editing.
- [ ] Resume the installed app on a new calendar month: Home follows it.
- [ ] Add sheet at 390×844: after the first digit both category rows are visible without scrolling (Quick add disappears on the first digit or when a category is picked).
- [ ] Trends opened offline (airplane mode) shows "Offline — months you haven't opened may be missing" beside the heading.
- [ ] Compare → tap a category → Back returns to Compare with the same months A and B.
- [ ] While Home shows a linked month (e.g. opened from Trends), tapping the Home tab returns to the current month.
- [ ] An "Uncategorized" breakdown row (category removed in the console) is not tappable.
