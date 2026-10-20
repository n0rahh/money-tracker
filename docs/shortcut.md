# Siri and Apple Watch: the Shortcut recipe

How to build the Apple Shortcut that adds an expense from Siri, the Apple Watch, a watch-face complication or the Action button (Milestone 4). The app's side is Settings → Siri & Apple Watch; the design is in the [spec](superpowers/specs/2026-10-14-money-tracker-design.md), §7 and §14.

## What it does and what it needs

"Add expense" asks "Amount?" and "Category?", signs in with the Shortcut password and writes the entry to Firestore through its REST API: dated today, with no note and `source: "shortcut"`. The entry appears in the app within seconds. There is no server and no App Store: the Shortcut makes the two HTTP calls itself.

It needs four things, once:

1. **Email/Password sign-in, turned on.** Firebase Console → Authentication → Sign-in method → add **Email/Password** and enable it. Leave "Email link (passwordless)" off. Only you can do this: until then, "Create password" in the app says "Email/password sign-in is off. Turn it on in Firebase Console → Authentication → Sign-in method."
2. **New sign-ups on, until the password exists.** The app links the password to your Google account through Firebase's sign-up, so Firebase Console → Authentication → Settings → User actions → "Enable create (sign-up)" must be on while you create it. Turn it off again right after. With it off, "Create password" says "Sign-up is turned off in Firebase Console (Authentication → Settings → User actions). Turn it on, create the password, then turn it off again."
3. **The Shortcut password.** In the app: Settings → Siri & Apple Watch → "1. Shortcut password" → "Create password". The app makes a 24-character password and shows it once ("Shown once. Paste it into the Shortcut now."). It never stores it: if you lose it, "Reset password" makes a new one.
4. **The five values** from "2. Values for the Shortcut", each with a Copy button. Where each one goes:

| Value | Where it goes |
|---|---|
| "Project id" | Step 14, in the URL |
| "Web API key" | Step 10, in the URL |
| "Email" | Step 10, the `email` field |
| "Expense categories" | Step 5 |
| "Income categories" | Step 5 of the income copy ([Income](#income)) |

The password goes into step 10 as well, as the `password` field.

Then try the whole path in the app before you build anything: "3. Test it here" → paste the password → "Send a test entry". The app makes the Shortcut's two calls with that password and adds a real entry of 0.01: "Shortcut test", in your first expense category, today. Its toast "Test entry added" has Undo, which removes the entry. If the page says "Your email is not marked verified for password sign-in.", tap "Send verification email", open the link in the email and test again.

## The recipe

In the Shortcuts app on the iPhone, tap + and name the new Shortcut "Add expense". Its name is what you say to Siri. Add the actions below in this order; search for each one by name.

How to read the steps:

- Each action passes its result to the next one. Shortcuts names the results: "Provided Input", "Calculation Result", "Rounded Number", "Formatted Number", "Updated Text", "Text", "Dictionary", "Dictionary Value", "Chosen Item", "Contents of URL" and "Formatted Date".
- Where a step uses an earlier result, insert it as a variable: put the cursor there, then tap the result in the bar above the keyboard, or tap "Select Variable" and tap the action it comes from. Several results share a name ("Text", "Dictionary Value", "Contents of URL", "Formatted Date"); the step says which one it means.
- In the templates, a name in angle brackets such as `<Updated Text>` is a variable: delete the placeholder, brackets included, and insert the variable in its place. `<web API key>` and `<project id>` are values you paste from the app, also without the brackets.
- If a parameter is not visible, tap the action's arrow ("Show More").

### 1. Ask for Input

- "Ask for Number with Amount?": the input type "Number" and the prompt `Amount?`.
- Make sure "Allow Decimal Numbers" is on.
- Result: "Provided Input", the amount as you typed or said it. On the watch the number comes from a numeric keypad.

### 2. Calculate

- "Provided Input × 100": the operation "×" and the number `100`.
- Result: "Calculation Result", the amount in minor units: 12.50 becomes 1250.

### 3. Round Number

- "Round Calculation Result to Ones Place", with "Mode" "Normal": the nearest 1.
- Result: "Rounded Number", a whole number, which is what the rules accept.

### 4. Format Number + Replace Text

- "Format Number": "Format Rounded Number to 0 Decimal Places", with "Decimal Places" at 0.
- Then "Replace Text", on the "Formatted Number": "Find Text" `[^0-9]`, "Replace With" left empty, and "Regular Expression" on.
- Why: Format Number has no switch for grouping and can write 1250 as `1,250` or `1 250`, depending on the phone's region, so Replace Text keeps only the digits.
- Result: "Updated Text", plain digits such as `1250`, for step 13. Keep "Decimal Places" at 0: with decimals, Replace Text would drop the decimal mark too, and the amount would come out 100 times too large.

### 5. Text (categories)

- A "Text" action with the "Expense categories" value pasted in as it is. It looks like this, with your own names and ids:

```json
{
  "Groceries": "<id>",
  "Coffee": "<id>"
}
```

- It holds your active expense categories. A name used twice gets " (2)" after it, so every name is unique.

### 6. Get Dictionary from Input

- "Get dictionary from Text": the "Text" of step 5.
- Result: "Dictionary", each category name with its id.

### 7. Get Dictionary Value (All Keys)

- "Get All Keys in Dictionary": tap "Value" and choose "All Keys". The input is the "Dictionary" of step 6.
- Result: "Dictionary Value", the list of category names.

### 8. Choose from List

- "Choose from Dictionary Value": the names of step 7, with the "Prompt" `Category?`.
- Result: "Chosen Item", the name you pick.

### 9. Get Dictionary Value (the id)

- "Get Value for Chosen Item in Dictionary": the key is the "Chosen Item" of step 8, and the dictionary is the "Dictionary" of step 6 (not the result of step 7).
- Result: "Dictionary Value", the category's id, for step 13.

### 10. Get Contents of URL (sign in)

- The URL, with the "Web API key" pasted in place of `<web API key>`:

```
https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<web API key>
```

- "Method": "POST". "Request Body" then appears.
- "Request Body": "JSON", with three fields ("Add new field"):

| Key | Type | Value |
|---|---|---|
| `email` | Text | the "Email" value |
| `password` | Text | the Shortcut password |
| `returnSecureToken` | Boolean | True |

That is this body:

```json
{"email":"<owner email>","password":"<password>","returnSecureToken":true}
```

- Result: "Contents of URL", Firebase's answer. After a good sign-in it holds `idToken`.

### 11. Get Dictionary Value (idToken)

- "Get Value for idToken in Contents of URL": type `idToken` as the key. The input is the "Contents of URL" of step 10.
- Result: "Dictionary Value", the ID token, for step 14. It is a JWT whose payload carries `email` and `email_verified`, which the rules check.

### 12. Format Date (twice)

Two "Format Date" actions, both on "Current Date":

1. "Date Format": "Custom", "Format String": `yyyy-MM-dd`. Its "Formatted Date" is the entry's day, such as `2026-10-20`. Keep the case exactly: `YYYY` is a different year near New Year, and `mm` means minutes.
2. "Date Format": "ISO 8601", with "Include ISO 8601 Time" on. Its "Formatted Date" is the moment with the phone's offset, such as `2026-10-20T19:05:00+02:00`.

### 13. Text (body)

- One "Text" action holding the whole request body, in Firestore's typed format. Paste this line rather than typing it (the keyboard can turn straight quotes into curly ones, and the JSON then breaks), and replace its four placeholders:

```json
{"fields":{"kind":{"stringValue":"expense"},"amount":{"integerValue":"<Updated Text>"},"categoryId":{"stringValue":"<Dictionary Value>"},"note":{"stringValue":""},"date":{"stringValue":"<Formatted Date>"},"at":{"timestampValue":"<Formatted Date>"},"source":{"stringValue":"shortcut"}}}
```

| Placeholder | Insert |
|---|---|
| `<Updated Text>`, in `amount` | the "Updated Text" of step 4 |
| `<Dictionary Value>`, in `categoryId` | the "Dictionary Value" of step 9, the id |
| `<Formatted Date>`, in `date` | the "Formatted Date" of the first Format Date (step 12) |
| `<Formatted Date>`, in `at` | the "Formatted Date" of the second Format Date (step 12) |

- Keep the quotes around each placeholder: `integerValue` is a string in this format too.
- For 12.50 the text then reads like this, with your own id and times:

```json
{"fields":{"kind":{"stringValue":"expense"},"amount":{"integerValue":"1250"},"categoryId":{"stringValue":"<id>"},"note":{"stringValue":""},"date":{"stringValue":"2026-10-20"},"at":{"timestampValue":"2026-10-20T17:05:00Z"},"source":{"stringValue":"shortcut"}}}
```

- `at` carries the phone's offset (`+02:00`) or `Z`; Firestore accepts both.

### 14. Get Contents of URL (write) + If + Show Notification

- The URL, with the "Project id" pasted in place of `<project id>`:

```
https://firestore.googleapis.com/v1/projects/<project id>/databases/(default)/documents/transactions
```

- "Method": "POST".
- "Headers", two of them ("Add new header"):

| Key | Value |
|---|---|
| `Authorization` | `Bearer <Dictionary Value>`: the word `Bearer`, one space, then the "Dictionary Value" of step 11, the token |
| `Content-Type` | `application/json` |

- "Request Body": "File", and as its "File" the "Text" of step 13 (tap "Choose Variable"). The text goes out as it is, as the body of the request.
- Firebase answers with the new document (`200`), whose `name` ends in the entry's id, or with an `error`: `403 PERMISSION_DENIED` when the rules refuse, `401` for a bad token, `400` for a malformed body.
- "Get Dictionary Value": "Get Value for name in Contents of URL", on the "Contents of URL" of this step (not of step 10).
- "If": "If Dictionary Value has any value", on the result just above. Adding "If" also adds "Otherwise" and "End If"; put these between them:
  - Under "If": "Show Notification" `Added <Provided Input> to <Chosen Item>`, with the "Provided Input" of step 1 and the "Chosen Item" of step 8.
  - Under "Otherwise": "Get Dictionary Value": "Get Value for error.message in Contents of URL", again on this step's "Contents of URL" (the dot reaches into `error`), then "Show Notification" with that "Dictionary Value".

A run that wrote the entry says "Added …"; any other run shows Firebase's message instead ([Troubleshooting](#troubleshooting)). Offline, the first call already fails with an error from Shortcuts.

## Siri, the watch and the complication

- **Apple Watch.** In the Shortcut's details, turn on "Show on Apple Watch". The Shortcut then shows in the Shortcuts app on the watch. With the phone away, the watch uses its own Wi-Fi or cellular connection.
- **Siri.** The phrase is the Shortcut's name: "Hey Siri, add expense", to the watch or to the phone. Renaming the Shortcut changes the phrase.
- **Complication.** Add the Shortcut to a watch face as a complication. Run from there, it asks for a confirmation tap first.
- **Action button.** On an iPhone that has one: Settings → Action Button → Shortcut → "Add expense". Back Tap can run it too (Settings → Accessibility → Touch → Back Tap).

## Income

Duplicate the Shortcut: in the Shortcuts app, touch and hold "Add expense" → "Duplicate", then rename the copy, for example "Add income" (Siri then answers to "Hey Siri, add income"). Change two things in the copy:

- Step 5: paste "Income categories" instead of the expense ones.
- Step 13: change `"expense"` to `"income"`.

Everything else stays as it is.

## Troubleshooting

When a run fails, its notification shows Firebase's message (the write's `error.message`) instead of "Added …". A failed sign-in shows up there as a refused write, because step 14 then has no token. The app's test ("3. Test it here") makes the same two calls with the same password and names the cause in a sentence, so start there. The table goes by those sentences, with Firebase's code after each.

| What you see | What it means | What to do |
|---|---|---|
| "Create password" says "Sign-up is turned off in Firebase Console (Authentication → Settings → User actions). Turn it on, create the password, then turn it off again." (`auth/admin-restricted-operation`) | Linking the password goes through Firebase's sign-up, which is off. | Turn "Enable create (sign-up)" on, create the password, then turn it off again. |
| "Email/password sign-in is off. …" (`OPERATION_NOT_ALLOWED` or `PASSWORD_LOGIN_DISABLED`) | The Email/Password provider is off. | Firebase Console → Authentication → Sign-in method → Email/Password → enable it. |
| "Wrong password. Reset it in step 1 and paste the new one." (`INVALID_LOGIN_CREDENTIALS`, or `INVALID_PASSWORD`, `EMAIL_NOT_FOUND`) | The password or the email in step 10 is not the current one. | On the page, "Reset password", and paste the new password into step 10 (in the income copy too). Check `email` against the "Email" value. |
| "Too many attempts. Try again in a few minutes." (`TOO_MANY_ATTEMPTS_TRY_LATER`) | Too many failed sign-ins in a row. | Wait a few minutes, then fix the password. |
| "Firestore refused the entry. The email must be the owner's and verified (see step 3)." (`PERMISSION_DENIED`, `403`) | The rules refused the entry: the token's email is not the owner's or is not marked verified, or a field breaks the rules (an amount of 0, say). | Use the "Email" value in step 10. If the app's test says "Your email is not marked verified for password sign-in.", tap "Send verification email", open the link and test again. |
| The app's test works, but the Shortcut still shows an error | The Shortcut differs from the recipe, most often in step 14's header (`Bearer`, a space, the token of step 11) or a typo in step 13. | Compare steps 10 to 14 with the recipe. |
| The entry has the wrong amount, or the write is refused as malformed (`400`) | Steps 2 to 4 did not give plain digits in minor units. 100 times too much: Format Number kept its decimals. 100 times too little: step 2 is missing. | Check steps 2 to 4: × 100, round to "Ones Place", Format Number with 0 decimal places, then Replace Text with `[^0-9]` and "Regular Expression" on. |
| "Added …" shows, but the entry is not in the app | The entry was written, maybe on another day or under another category. | Open it in Firebase Console → Firestore Database → `transactions` (its `source` is `shortcut`) and check its `date` and `categoryId`. |
| A new category is missing from the list, or a renamed one shows its old name | The Shortcut keeps the dictionary you pasted. | After you change categories, copy "Expense categories" (or "Income categories") again and paste it over the text of step 5. An entry made with an older copy is still valid and shows under its category. |
| You want to stop the Shortcut (a lost phone, a shared iCloud account) | | On the page, "Reset password": the old password stops working, so paste the new one into the Shortcuts you keep. Or "Remove": every copy stops until you create a new password. Turning Email/Password off in the console stops it too. |

## Security

- The password lives in the Shortcut, which syncs through your iCloud like any Shortcut. Whoever has the Shortcut has the password, your email and the Web API key, and can sign in as you and read or change all of the app's data. Do not share the Shortcut: the password goes with it.
- The Web API key is public by design. It names the Firebase project and is in the app's own code anyway; on its own it gives no access to the data.
- The rules and the password are what protect the data. The rules accept only the owner's email, marked verified, and only entries that pass their checks; Milestone 4 did not change them.
- Keep new sign-ups off once the password exists: Firebase Console → Authentication → Settings → User actions → "Enable create (sign-up)" off. Turn it on only while you create a password. The rules already make any other account useless; this keeps the user list clean.
- To revoke the Shortcut: "Reset password" or "Remove" on the page, or Email/Password off in the console.
