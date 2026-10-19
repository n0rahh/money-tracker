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
- [ ] Edit a transaction's amount and date; delete one (since M3 there is no confirm dialog: the sheet closes and a "Deleted" toast offers Undo).
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

## Milestone 3 (power features)

### Deploy
- [ ] `npx firebase deploy --only firestore --project money-tracker-vlad`, wait about a minute for the rules to apply, then `npm run deploy`. Launch the app twice: the second launch runs the new build.
- [ ] If Home shows "Could not load budgets: …" right after a deploy (the phone reloaded before the rules applied), relaunch after a minute: budgets and Settings → Recurring come back. A repeating entry saved in that minute is gone; save it again.

### Budgets
- [ ] Categories → an expense category: the "Monthly budget" field does not zoom on focus; the decimal keypad's comma works ("12,5" saves 12.50); "0" says "Enter an amount above 0, or tap No budget"; a valid value reads back as "… a month"; "No budget" clears the field and keeps the keyboard and the focus in the sheet. An income category has no field.
- [ ] Home at 375 px: "Budgets: … of …" under the hero; a budgeted row's bar is as wide as any other row's, every amount ends in the same column, and the third line reads "<spent> of <budget>"; with 6- or 7-digit amounts it wraps without overflowing.
- [ ] Exactly at the limit the line ends "· at limit" and the bar turns to the expense colour; at 150 % it ends "· <overage> over". Check with a rose and a red category (Health, Gifts), where the colour barely changes and the words carry it.
- [ ] A budgeted category with nothing spent shows an empty row after the others, with a −100 % badge if it spent last month. On the 1st, before the first entry, only the "Budgets" line shows. Archiving a budgeted category takes its row and its limit out of the line.
- [ ] Create a budgeted category in airplane mode, then reconnect: the category and its budget both arrive.
- [ ] A template whose entry is dated later in the month (rent on the 25th) is listed above Today from the 1st on and counts in "Spent" and in the budget line, while the pace line leaves it out until the 25th.

### Recurring
- [ ] Add sheet at 375×812: "Repeat every month on day N" sits under the categories, partly behind the keypad (27 of its 44 px show); scrolling the body reveals it, and it toggles. At 390×844 it fits.
- [ ] Toggle on, Save: the sheet closes at once; the entry is on Home, and Settings → Recurring shows the template (the count goes up by one).
- [ ] Save a repeating entry online and watch the network (Safari Web Inspector) or the Firestore usage: one batch per save, no second write of the same month (the Firestore console shows one `rec_<id>_<YYYY-MM>` entry).
- [ ] Online, save a test repeating entry dated last month (Pick…): last month's entry and this month's both appear. In airplane mode, a second test entry shows only last month's (nothing is materialised from a list the server has not confirmed); after reconnecting, its entry for this month appears, once. Delete both test templates and their entries afterwards.
- [ ] On the first launch or resume in a new month (or after setting the phone's date into the next month), each template's entry for that month appears by itself, on its day; day 31 falls on the month's last day. Entries written early by a date change are that month's real entries: keep them, since the app never writes a month twice.
- [ ] Stop: the schedule gains "· until <this month>" and Stop goes away; this month's entry stays, and next month nothing is added. Delete template, then Undo within 6 s: the template is back with its schedule, and its entries never change.
- [ ] Delete one month's entry of a template, or edit it: the next launch neither brings it back nor undoes the edit.
- [ ] Once a template's entry is written (rent on its day), the Add sheet's category order and its Quick add chips stay as they were: entries made by a template do not count.
- [ ] Recurring page at 375 px: long notes are cut with an ellipsis; Stop and "Delete template" are 44 px; VoiceOver names each with its category and note ("Stop Housing (Flat)", "Delete template Housing (Flat)").

### Month picker
- [ ] Tap the month label: "Choose month" opens on the shown month's year, the shown month lime, this month with a dot (legible on the dark and on the lime button); the arrows change the year; a month ahead opens with its empty state; the sheet closes on a pick, on the close button and on the backdrop; December clears the home indicator. Picking the current month makes Home follow the calendar again.

### Search
- [ ] The closed magnifier (a quiet icon, no circle) is easy to find, does not blink on month switches, and is dimmed for a month without entries.
- [ ] Tap it: the keyboard rises at once, with no second tap; the field sits at the top, below the status bar and the Dynamic Island, with All / Expenses / Income under it and the days under that. Safari does not scroll the page again once the keyboard is up. If any of this fails, take the decision table in `docs/m3-rulings.md` (search placement).
- [ ] Type "latte": only the matching days, "N matching entries · −…", each day header the total of its rows; a query matching only income reads "· +…". Type "zzz": "No matches", and the field does not slide behind the keyboard.
- [ ] The keyboard shows a Search key and does not autocorrect; Search puts the keyboard away and keeps the results; the clear button empties the field and keeps the keyboard; the kinds work with the keyboard up.
- [ ] The field does not zoom (16 px) and looks like the app's other fields: no white inset, no second native clear button.
- [ ] On the Polish keyboard, "zabka" finds "Żabka" and "lodz" finds "Łódź".
- [ ] At 375 px a long caption breaks before the dot, and VoiceOver reads it sensibly.
- [ ] Scroll to the top and tap the magnifier again: the whole month, and the summary, pace line, strip and breakdown never changed. Changing the month (arrows or picker) closes the search.
- [ ] Header at 375 px: the arrows, the label and the magnifier are each 44 px; a long month name in another language is cut with an ellipsis.
- [ ] Delete the last entry of a month while searching, then tap Undo: the list returns with the query kept and the focus where it was.

### Undo and toasts
- [ ] Delete an entry: no confirm, the sheet closes, "Deleted" with Undo shows for 6 s; Undo brings the entry back in its place in the day.
- [ ] Delete, then tap + at once: the toast is gone and the keypad's `0` and `.` work. The same with the month picker opened right after a delete: no toast over "Aug".
- [ ] With VoiceOver on (this decides the live region): delete an entry, and "Deleted, Undo" is read once; delete a second one within 6 s, and it is read once for the second; tap Undo: silence. Two announcements or none: apply the fallback in `docs/m3-rulings.md` (nested live region).
- [ ] Undo in airplane mode: the entry comes back at once and syncs after reconnecting.
- [ ] A plain toast stays when a sheet opens: in airplane mode tap Export CSV ("Could not export while offline"), then + at once. The toast stays over the keypad, and taps on `0` and `.` still reach the keys, with and without VoiceOver.
- [ ] With VoiceOver or a keyboard, move to the Undo button: the toast stays while Undo has the focus (or the pointer is over it), then runs out as usual.
- [ ] (Known, rare, accepted) Tap Export, then open Currency, Import CSV or + while the row still says "Exporting…": the share sheet may open over that sheet, or the "N entries ready to export · Share" toast may cover its lower part for up to 10 s.

### Export and import
- [ ] Export CSV and Export JSON on the iPhone: the share sheet opens and Save to Files works. With a few thousand entries the read may take longer than the tap allows: "N entries ready to export" with Share then opens it. Cancelling the share sheet says nothing, and both rows work again.
- [ ] On a Mac, in Safari and in Chrome, Export downloads the file (no share popover).
- [ ] Open the CSV in Numbers, Google Sheets and Excel: Polish letters, quoting, a note starting with `+` or `=`. Excel in a Polish locale shows one column unless the file is opened through its text import.
- [ ] Export in airplane mode: "Could not export while offline". On a weak connection, note how long it takes to fail.
- [ ] Import CSV, choosing a file from Files: the sheet at 375 px (44 px selects, no zoom on the selects or the file input, the preview, the error list).
- [ ] Import a real Money Manager CSV: the columns are guessed, Transfer values are skipped, dates read day first, decimal commas work; then the preview, "Import N entries" with its progress line, the toast, and Home on the latest imported month. A second import adds nothing. Then import the app's own CSV export into the same account: the number of entries does not change, the line "N rows keep this app's own ids (existing entries with those ids are replaced)" shows, and edits made since the export are reverted, as expected.
- [ ] A file whose slash dates read two ways shows "Slash dates" with an example line; flip it and watch the preview follow. A Windows-1250 file shows the hint to save it as UTF-8.
- [ ] Import in airplane mode: the progress line stays at "0 of N written" (it counts what the server confirms); close the sheet, and the rows already show on Home. Reconnect: they sync, and the "Imported N entries" toast follows. A file of several thousand rows: the progress line moves and the page stays responsive; an import that stops partway says "Imported N of M entries", and importing the file again (the next day, after a quota stop) finishes it.

### After a deploy
- [ ] After a cold start in airplane mode, open /trends: it renders (every page chunk is precached).
- [ ] With the app left open, deploy again, then tap a page not visited since (Trends, Categories, Settings) without relaunching: it opens, or the app reloads once into it; never "Something went wrong".

### Money Manager backup (Mac)
- [ ] `node scripts/mmbak-dump.mjs imports/<file>.mmbak imports/dump` (Node ≥ 24.12): one CSV per table, with its row count. A file that is not SQLite gives exit code 1 and a clear message.

### Only matters with more than one device
On one phone none of this shows. It is what to expect once the Mac, or a second phone, is signed in too.
- Both devices write a template's month into the same document (`rec_<template>_<YYYY-MM>`), so a month is never added twice.
- A device writes repeating entries only from a list the server has confirmed, so a stale cached copy does not write again the months the other device already wrote, or over the edits made there.
- Two devices launching within seconds of a new month can still overwrite an edit made on one of them to that month's entry.
- Undo writes back the copy it read: an edit made on the other device in between is lost (the last write wins).
- Undo of a template restores the `lastAppliedMonth` it read: if the other device wrote a month in between, the next run writes that month again (same id), over any edit to it.
- On the Mac, exports download instead of opening a share sheet.
