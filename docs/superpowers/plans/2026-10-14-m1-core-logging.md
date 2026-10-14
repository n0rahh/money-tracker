# Money Tracker — Milestone 1 (Core Logging) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first usable version of Money Tracker: Google sign-in locked to one email, seeded categories you can manage, add/edit/delete expenses and income with a custom keypad, a month view with totals and a category breakdown, installed on the iPhone home screen and deployed to Firebase Hosting for $0.

**Architecture:** A static React/TypeScript/Vite single-page app on Firebase Hosting talks directly to Firestore through the Firebase JS SDK with persistent offline cache; there is no server code. All aggregation is done on the client from one month of transactions. Firestore security rules (owner email + schema validation) are the only enforcement layer. The Add sheet never awaits a Firestore write, so the UI stays instant offline.

**Tech Stack:** React 19, TypeScript (strict), Vite, Tailwind CSS v4, Firebase JS SDK v12 (Auth + Firestore), react-router v7, vite-plugin-pwa (Workbox), lucide-react, @fontsource-variable/dm-sans, Vitest + Testing Library + jsdom, @firebase/rules-unit-testing with the Firestore emulator, oxlint, npm.

**Spec:** `docs/superpowers/specs/2026-10-14-money-tracker-design.md` (read §4–§9 and §11 before starting; this plan implements the "M1 — Core logging" row of §10).

## Global Constraints

- Node 22+ and npm; `firebase-tools` is a devDependency (npm scripts find `firebase`; use `npx firebase` in a shell) and a JDK must be on PATH for the emulators (on this Mac: `export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"`).
- Until the Firebase project exists, everything runs against the Auth + Firestore emulators with project id `demo-money-tracker` (Task 4, Step 9).
- Firebase project id `money-tracker-vlad`, app URL `https://money-tracker-vlad.web.app`, Spark plan only: no Cloud Functions, no Cloud Storage.
- Owner email, verbatim, in rules and `.env`: `vlad.herasymovychh@gmail.com`.
- Amounts are integers in minor units (cents); `date` is a local `YYYY-MM-DD` string; `at` is a Firestore `Timestamp`.
- Root collections `categories`, `transactions`, `settings` (document `settings/main`); one composite index on `transactions`: `date DESC, at DESC`.
- Design tokens exactly as spec §8: bg `#0a0a0d`, surface `#131318`, surface-2 `#1b1b22`, border `#26262f`, text `#f4f4f6`, muted `#8c8c9a`, accent `#c6f432`, accent-ink `#0a0a0d`, expense `#ff6b7a`, danger `#ff5c5c`; radii 20 px (cards) and 14 px (chips/keys).
- Touch targets ≥ 44 × 44 px everywhere (`min-h-11`/`size-11` minimum on every button, chip, swatch and icon control), keypad keys 56 px tall, every input 16 px font, `viewport-fit=cover` with safe-area padding, `prefers-reduced-motion` respected.
- UI code never `await`s a Firestore write before updating the screen; it calls the write, attaches `.catch` → toast, and closes immediately.
- The service worker must not intercept `/__/*` (Firebase Auth handler): `navigateFallbackDenylist: [/^\/__\//]`.
- Production JS ≤ 250 kB gzipped (check in Task 16).
- Conventional commit messages; commit after every task.

## Review Focus

1. A keypad expression that evaluates to zero or below (`10 − 15`): the display shows 0 and Save stays disabled; nothing negative is ever written. Pinned by Task 8 (`keypadMinor` clamps) and Task 12 (sheet test "Save stays disabled when the expression evaluates to zero").
2. Day arithmetic across a DST change (Europe switches on 2026-03-29): "Yesterday", the date chips and month ranges must not skip or repeat a day. Pinned by Task 7 (noon-anchored `addDays`/`parseIsoDate` test on that date).
3. A transaction whose category was archived or deleted by hand: the row still shows the stored name (or "Uncategorized"), pickers exclude archived categories, the Add sheet never silently reassigns. Pinned by Task 9 (`orderCategoriesByRecency` excludes archived), Task 10 (`mapTransaction` keeps an unknown `categoryId`) and Task 13 (`byId` includes archived categories).
4. Saving offline or on a slow network: the sheet closes at once and the entry appears in the list; no spinner waits for the server. Pinned by Task 12 (test with a never-resolving write promise).
5. The owner's email claim without `email_verified` (what an unverified password sign-up would carry): every read and write is denied. Pinned by Task 5 (rules test "owner email without email_verified is denied").

---

## File structure

| Path | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vite.config.ts`, `.oxlintrc.json`, `vitest.rules.config.ts` | Tooling: scripts, strict TS, Vite + Tailwind + PWA plugin, Vitest (jsdom for `src/**`, node for `tests/rules/**`) |
| `index.html`, `public/logo.svg`, `public/*.png` | App shell HTML with iOS web-app meta tags; icon source and generated icons |
| `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json` | Hosting config, project alias, security rules, composite index |
| `src/index.css` | Tailwind import, design tokens (`@theme`), base styles, safe-area helpers |
| `src/main.tsx`, `src/App.tsx` | Bootstrap and route table with providers |
| `src/lib/types.ts` | Domain types: `Kind`, `Category`, `Transaction`, `Settings`, inputs |
| `src/lib/categoryColors.ts`, `src/lib/categoryIcons.ts`, `src/lib/iconSearch.ts`, `src/lib/defaultCategories.ts` | Palette, curated Lucide icon map, icon search, seed categories |
| `src/lib/money.ts` | Minor-unit digits, exact decimal parsing, `Intl` formatting |
| `src/lib/dates.ts` | ISO date/month helpers, local-time safe |
| `src/lib/keypad.ts` | Keypad expression engine (`12.5+3`), integer-safe evaluation |
| `src/lib/stats.ts` | Totals by kind/category/day, day grouping, recency ordering |
| `src/lib/currencies.ts` | Currency list and search |
| `src/lib/platform.ts` | `isStandalone()` |
| `src/lib/firebase.ts` | Firebase app/auth/db singletons, env config, emulator switch |
| `src/lib/mappers.ts` | Firestore document → domain object (defensive), `transactionAt` |
| `src/lib/firestore.ts` | All reads (subscriptions) and writes; the only module that touches `db` |
| `src/hooks/useCategories.ts`, `useTransactions.ts`, `useSettings.ts` | React subscriptions to the data layer |
| `src/context/AuthContext.tsx`, `AddSheetContext.tsx`, `ToastContext.tsx` | Auth session, global Add/Edit sheet state, toasts |
| `src/components/*` | One component per file (listed per task) |
| `src/pages/LoginPage.tsx`, `HomePage.tsx`, `CategoriesPage.tsx`, `SettingsPage.tsx` | Route screens |
| `src/test/setup.ts` | jest-dom matchers for Vitest |
| `tests/rules/firestore.rules.test.ts` | Security-rules tests against the emulator |
| `docs/device-checklist.md` | Manual iPhone verification list |

---

### Task 1: Project scaffold and tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `.oxlintrc.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/vite-env.d.ts`, `src/test/setup.ts`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `preview`, `typecheck`, `lint`, `test`, `test:watch`, `test:rules`, `deploy`; the global `__APP_VERSION__` constant; Vitest configured with jsdom and jest-dom for `src/**/*.test.{ts,tsx}`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "money-tracker",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "oxlint",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:rules": "firebase emulators:exec --only firestore --project demo-money-tracker \"vitest run --config vitest.rules.config.ts\"",
    "deploy": "npm run build && firebase deploy --project money-tracker-vlad --non-interactive"
  }
}
```

- [ ] **Step 2: Install dependencies** (versions resolve to current releases; `package.json` records them)

```bash
cd ~/Projects/money-tracker
npm install react react-dom react-router-dom firebase lucide-react @fontsource-variable/dm-sans
npm install -D typescript vite @vitejs/plugin-react tailwindcss @tailwindcss/vite vite-plugin-pwa oxlint vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/react @types/react-dom @types/node @firebase/rules-unit-testing firebase-tools
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "verbatimModuleSyntax": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "tests", "vite.config.ts", "vitest.rules.config.ts", "pwa-assets.config.ts"]
}
```

- [ ] **Step 4: Write `vite.config.ts`** (the PWA manifest is final here; icon files arrive in Task 16)

```ts
/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo.svg'],
      manifest: {
        name: 'Money Tracker',
        short_name: 'Money',
        description: 'Personal income and expense tracker',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0a0a0d',
        background_color: '#0a0a0d',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/__\//],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
```

- [ ] **Step 5: Write the remaining scaffold files**

`.oxlintrc.json`:
```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "ignorePatterns": ["dist/", "dev-dist/", "node_modules/"]
}
```

`index.html` (temporary; Task 3 replaces it):
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Money Tracker</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`src/App.tsx` (temporary; Task 3 replaces it):
```tsx
export default function App() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Money Tracker</h1>
    </main>
  )
}
```

`src/index.css` (temporary; Task 3 replaces it):
```css
@import 'tailwindcss';
```

`src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
  readonly VITE_ALLOWED_EMAIL?: string
  readonly VITE_USE_EMULATORS?: string
}
```

`src/test/setup.ts` (Vitest globals are off, so Testing Library's automatic `afterEach(cleanup)` never registers; register it here or rendered DOM leaks between tests):
```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)
```

- [ ] **Step 6: Verify the toolchain**

Run: `npm run typecheck && npm run lint && npx vitest run --passWithNoTests && npm run build`
Expected: all four succeed; `dist/` contains `index.html`, `sw.js`, `manifest.webmanifest`.

Run: `npm run dev` and open http://localhost:5173
Expected: the heading "Money Tracker" renders.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + React + TypeScript + Tailwind + PWA toolchain"
```

---

### Task 2: Domain types, palette, icon map, default categories

**Files:**
- Create: `src/lib/types.ts`, `src/lib/categoryColors.ts`, `src/lib/categoryIcons.ts`, `src/lib/defaultCategories.ts`
- Test: `src/lib/categoryColors.test.ts`, `src/lib/defaultCategories.test.ts`

**Interfaces:**
- Produces: `Kind`, `KINDS`, `IsoDate`, `IsoMonth`, `Category`, `CategoryInput`, `Transaction`, `TransactionInput`, `Settings` (types.ts); `COLOR_KEYS`, `ColorKey`, `CATEGORY_COLORS: Record<ColorKey, string>`, `colorTint(hex: string, alpha?: number): string`, `isColorKey(v: unknown): v is ColorKey`; `CATEGORY_ICONS`, `IconKey`, `ICON_KEYS: IconKey[]`, `isIconKey(v: unknown): v is IconKey`, `FALLBACK_ICON`; `DEFAULT_CATEGORIES: CategoryInput[]`.

- [ ] **Step 1: Write the failing tests**

`src/lib/categoryColors.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { CATEGORY_COLORS, COLOR_KEYS, colorTint, isColorKey } from './categoryColors'

describe('categoryColors', () => {
  it('has a hex color for every key', () => {
    for (const key of COLOR_KEYS) expect(CATEGORY_COLORS[key]).toMatch(/^#[0-9a-f]{6}$/)
  })
  it('tints a hex color to an rgba string', () => {
    expect(colorTint('#fb7185')).toBe('rgba(251, 113, 133, 0.16)')
    expect(colorTint('#000000', 0.5)).toBe('rgba(0, 0, 0, 0.5)')
  })
  it('recognises keys', () => {
    expect(isColorKey('amber')).toBe(true)
    expect(isColorKey('magenta')).toBe(false)
    expect(isColorKey(42)).toBe(false)
  })
})
```

`src/lib/defaultCategories.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { isColorKey } from './categoryColors'
import { CATEGORY_ICONS, ICON_KEYS, isIconKey } from './categoryIcons'
import { DEFAULT_CATEGORIES } from './defaultCategories'

describe('icon map', () => {
  it('every key resolves to a real Lucide component', () => {
    for (const key of ICON_KEYS) expect(CATEGORY_ICONS[key]).toBeTruthy()
  })
})

describe('DEFAULT_CATEGORIES', () => {
  it('uses only known icons and colors', () => {
    for (const c of DEFAULT_CATEGORIES) {
      expect(isIconKey(c.icon)).toBe(true)
      expect(isColorKey(c.color)).toBe(true)
      expect(c.archived).toBe(false)
    }
  })
  it('has unique names and orders within each kind', () => {
    for (const kind of ['expense', 'income'] as const) {
      const ofKind = DEFAULT_CATEGORIES.filter((c) => c.kind === kind)
      expect(new Set(ofKind.map((c) => c.name)).size).toBe(ofKind.length)
      expect(new Set(ofKind.map((c) => c.order)).size).toBe(ofKind.length)
    }
    expect(DEFAULT_CATEGORIES.filter((c) => c.kind === 'expense').length).toBeGreaterThanOrEqual(15)
    expect(DEFAULT_CATEGORIES.filter((c) => c.kind === 'income').length).toBeGreaterThanOrEqual(5)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/lib/types.ts`**

```ts
import type { Timestamp } from 'firebase/firestore'
import type { ColorKey } from './categoryColors'
import type { IconKey } from './categoryIcons'

export type Kind = 'expense' | 'income'
export const KINDS: Kind[] = ['expense', 'income']

/** 'YYYY-MM-DD' in the device's local time zone. */
export type IsoDate = string
/** 'YYYY-MM'. */
export type IsoMonth = string

export type Category = {
  id: string
  name: string
  icon: IconKey
  color: ColorKey
  kind: Kind
  order: number
  archived: boolean
  createdAt?: Timestamp
  updatedAt?: Timestamp
}
export type CategoryInput = Omit<Category, 'id' | 'createdAt' | 'updatedAt'>

export type Transaction = {
  id: string
  kind: Kind
  /** Integer minor units (cents). Always > 0; the sign is implied by `kind`. */
  amount: number
  categoryId: string
  note: string
  date: IsoDate
  at: Timestamp
  source: 'app' | 'shortcut' | 'import'
  createdAt?: Timestamp
  updatedAt?: Timestamp
}
export type TransactionInput = {
  kind: Kind
  amount: number
  categoryId: string
  note: string
  date: IsoDate
  /** Explicit moment within the day; when omitted the data layer derives it from `date`. */
  at?: Date
}

export type Settings = {
  currency: string
  locale: string | null
}
```

- [ ] **Step 4: Write `src/lib/categoryColors.ts`**

```ts
export const COLOR_KEYS = [
  'rose', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'fuchsia', 'pink', 'slate',
] as const

export type ColorKey = (typeof COLOR_KEYS)[number]

/** Foreground hex per key, bright enough to read on #0a0a0d. */
export const CATEGORY_COLORS: Record<ColorKey, string> = {
  rose: '#fb7185', red: '#f87171', orange: '#fb923c', amber: '#fbbf24', yellow: '#facc15',
  lime: '#a3e635', green: '#4ade80', emerald: '#34d399', teal: '#2dd4bf', cyan: '#22d3ee',
  sky: '#38bdf8', blue: '#60a5fa', indigo: '#818cf8', violet: '#a78bfa', fuchsia: '#e879f9',
  pink: '#f472b6', slate: '#94a3b8',
}

/** Translucent background tint for chips and icon badges. */
export function colorTint(hex: string, alpha = 0.16): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function isColorKey(v: unknown): v is ColorKey {
  return typeof v === 'string' && (COLOR_KEYS as readonly string[]).includes(v)
}
```

- [ ] **Step 5: Write `src/lib/categoryIcons.ts`**

If `npm run typecheck` later reports that an icon name is not exported by the installed `lucide-react`, replace that one name with the closest icon from https://lucide.dev/icons (PascalCase) and keep the key count the same.

```ts
import {
  Apple, Baby, Backpack, Banknote, Beer, Bike, Book, Briefcase, Bus, Cake, Camera, Car, Cat,
  CircleEllipsis, Clapperboard, Coffee, CreditCard, Dog, Droplets, Dumbbell, FileText, Flower2,
  Fuel, Gamepad2, Gem, Gift, Glasses, Globe, GraduationCap, HandCoins, Headphones, HeartHandshake,
  HeartPulse, Hotel, House, Landmark, Laptop, Lightbulb, Monitor, Music, Palette, PawPrint,
  PiggyBank, Pill, Pizza, Plane, Receipt, Salad, Scissors, Shield, Shirt, ShoppingBag,
  ShoppingCart, Smartphone, Sofa, Sparkles, Stethoscope, Tent, Ticket, TrainFront, TrendingUp,
  Tv, Umbrella, Undo2, Users, Utensils, Watch, Wifi, Wine, Wrench, Zap,
  type LucideIcon,
} from 'lucide-react'

export const CATEGORY_ICONS = {
  Apple, Baby, Backpack, Banknote, Beer, Bike, Book, Briefcase, Bus, Cake, Camera, Car, Cat,
  CircleEllipsis, Clapperboard, Coffee, CreditCard, Dog, Droplets, Dumbbell, FileText, Flower2,
  Fuel, Gamepad2, Gem, Gift, Glasses, Globe, GraduationCap, HandCoins, Headphones, HeartHandshake,
  HeartPulse, Hotel, House, Landmark, Laptop, Lightbulb, Monitor, Music, Palette, PawPrint,
  PiggyBank, Pill, Pizza, Plane, Receipt, Salad, Scissors, Shield, Shirt, ShoppingBag,
  ShoppingCart, Smartphone, Sofa, Sparkles, Stethoscope, Tent, Ticket, TrainFront, TrendingUp,
  Tv, Umbrella, Undo2, Users, Utensils, Watch, Wifi, Wine, Wrench, Zap,
} satisfies Record<string, LucideIcon>

export type IconKey = keyof typeof CATEGORY_ICONS
export const ICON_KEYS = Object.keys(CATEGORY_ICONS) as IconKey[]
export const FALLBACK_ICON: IconKey = 'CircleEllipsis'

export function isIconKey(v: unknown): v is IconKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CATEGORY_ICONS, v)
}
```

- [ ] **Step 6: Write `src/lib/defaultCategories.ts`**

```ts
import type { CategoryInput } from './types'

const expense = (name: string, icon: CategoryInput['icon'], color: CategoryInput['color'], order: number): CategoryInput =>
  ({ name, icon, color, kind: 'expense', order, archived: false })
const income = (name: string, icon: CategoryInput['icon'], color: CategoryInput['color'], order: number): CategoryInput =>
  ({ name, icon, color, kind: 'income', order, archived: false })

export const DEFAULT_CATEGORIES: CategoryInput[] = [
  expense('Groceries', 'ShoppingCart', 'emerald', 0),
  expense('Eating out', 'Utensils', 'orange', 1),
  expense('Coffee', 'Coffee', 'amber', 2),
  expense('Transport', 'Bus', 'sky', 3),
  expense('Taxi', 'Car', 'yellow', 4),
  expense('Housing', 'House', 'indigo', 5),
  expense('Utilities', 'Zap', 'violet', 6),
  expense('Phone & Internet', 'Wifi', 'cyan', 7),
  expense('Health', 'HeartPulse', 'rose', 8),
  expense('Sport', 'Dumbbell', 'lime', 9),
  expense('Clothes', 'Shirt', 'pink', 10),
  expense('Entertainment', 'Clapperboard', 'fuchsia', 11),
  expense('Subscriptions', 'Tv', 'blue', 12),
  expense('Travel', 'Plane', 'teal', 13),
  expense('Gifts', 'Gift', 'red', 14),
  expense('Education', 'GraduationCap', 'green', 15),
  expense('Beauty', 'Sparkles', 'violet', 16),
  expense('Pets', 'PawPrint', 'amber', 17),
  expense('Other', 'CircleEllipsis', 'slate', 18),
  income('Salary', 'Banknote', 'emerald', 0),
  income('Freelance', 'Laptop', 'cyan', 1),
  income('Gift', 'Gift', 'pink', 2),
  income('Investments', 'TrendingUp', 'lime', 3),
  income('Refund', 'Undo2', 'sky', 4),
  income('Other', 'CircleEllipsis', 'slate', 5),
]
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `npx vitest run src/lib && npm run typecheck`
Expected: 5 tests PASS; no type errors (fix any missing icon export as described in Step 5).

- [ ] **Step 8: Commit**

```bash
git add src/lib
git commit -m "feat: domain types, category palette, icon map and default categories"
```

---

### Task 3: Theme, app shell, routing, toast and Add-sheet contexts

**Files:**
- Create: `public/logo.svg`, `src/components/Button.tsx`, `src/components/Button.test.tsx`, `src/components/Sheet.tsx`, `src/components/Sheet.test.tsx`, `src/context/ToastContext.tsx`, `src/context/AddSheetContext.tsx`, `src/components/AppShell.tsx`, `src/pages/HomePage.tsx`, `src/pages/CategoriesPage.tsx`, `src/pages/SettingsPage.tsx`
- Replace: `index.html`, `src/index.css`, `src/App.tsx`

**Interfaces:**
- Consumes: `Transaction` from Task 2.
- Produces: `Button({ variant?: 'primary'|'ghost'|'danger', ...buttonProps })`; `Sheet({ open, title, onClose, children, footer?, full?, headerRight?, dismissible? })`; `ToastProvider`, `useToast(): { showToast(message: string): void }`; `AddSheetProvider`, `useAddSheet(): { state: { open: boolean; editing: Transaction | null }; openAdd(): void; openEdit(tx: Transaction): void; close(): void }`; `AppShell` route layout with bottom tabs and the floating + button; placeholder pages replaced in Tasks 13–15. Tailwind tokens `bg-bg`, `bg-surface`, `bg-surface-2`, `border-border`, `text-text`, `text-muted`, `bg-accent`, `text-accent-ink`, `text-expense`, `text-danger`, `rounded-card`, `rounded-chip`, helper classes `tnum`, `safe-pt`, `safe-pb`.

- [ ] **Step 1: Write the failing Button test** (`src/components/Button.test.tsx`)

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('defaults to type="button" and calls onClick', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)
    const btn = screen.getByRole('button', { name: 'Save' })
    expect(btn).toHaveAttribute('type', 'button')
    await userEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
  it('does not fire when disabled', async () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>Save</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).not.toHaveBeenCalled()
  })
})
```

Run: `npx vitest run src/components` → Expected: FAIL (module not found).

- [ ] **Step 2: Write `src/index.css`** (replace the whole file)

```css
@import 'tailwindcss';
@import '@fontsource-variable/dm-sans';

@theme {
  --color-bg: #0a0a0d;
  --color-surface: #131318;
  --color-surface-2: #1b1b22;
  --color-border: #26262f;
  --color-text: #f4f4f6;
  --color-muted: #8c8c9a;
  --color-accent: #c6f432;
  --color-accent-ink: #0a0a0d;
  --color-expense: #ff6b7a;
  --color-danger: #ff5c5c;
  --font-sans: 'DM Sans Variable', ui-sans-serif, system-ui, -apple-system, sans-serif;
  --radius-card: 20px;
  --radius-chip: 14px;
}

html, body, #root { height: 100%; }

body {
  margin: 0;
  font-family: var(--font-sans);
  background: var(--color-bg);
  color: var(--color-text);
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
  overscroll-behavior: none;
}

@layer base {
  button { touch-action: manipulation; }
  button:not(:disabled) { cursor: pointer; }
}

input, select, textarea { font-size: 16px; } /* unlayered on purpose: must beat text-* utilities so iOS never zooms on focus */

.tnum { font-variant-numeric: tabular-nums; }
.safe-pt { padding-top: max(0.5rem, env(safe-area-inset-top)); }
.safe-pb { padding-bottom: max(0.75rem, env(safe-area-inset-bottom)); }

:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
```

- [ ] **Step 3: Write `index.html`** (replace the whole file) and `public/logo.svg`

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0a0a0d" />
    <meta name="color-scheme" content="dark" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Money" />
    <link rel="icon" type="image/svg+xml" href="/logo.svg" />
    <title>Money Tracker</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`public/logo.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#131318"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#c6f432" stroke-width="40"/>
  <rect x="226" y="176" width="60" height="160" rx="30" fill="#c6f432"/>
</svg>
```

- [ ] **Step 4: Write `src/components/Button.tsx`**

```tsx
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'ghost' | 'danger'
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }

const styles: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink font-semibold hover:brightness-110',
  ghost: 'bg-surface-2 text-text hover:bg-border',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25',
}

export function Button({ variant = 'primary', className = '', type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-chip px-4 text-[15px] transition active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100 ${styles[variant]} ${className}`}
      {...rest}
    />
  )
}
```

Run: `npx vitest run src/components` → Expected: 2 tests PASS.

- [ ] **Step 5: Write `src/components/Sheet.tsx`**

```tsx
import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

type Props = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Full-height sheet on phones (used by the Add/Edit form). */
  full?: boolean
  headerRight?: ReactNode
  /** When false, no close button and the backdrop does not close (first-run flows). */
  dismissible?: boolean
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Sheet({ open, title, onClose, children, footer, full = false, headerRight, dismissible = true }: Props) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dismissible) onClose()
        return
      }
      const dialog = dialogRef.current
      if (e.key !== 'Tab' || !dialog) return
      // Trap Tab inside the dialog: wrap at both ends, and pull focus back in if it ever left.
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) {
        e.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const outside = !dialog.contains(active)
      if (e.shiftKey && (outside || active === first || active === dialog)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (outside || active === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, dismissible])

  // Kept apart from the effect above: that one re-runs whenever `onClose` changes identity and must not re-steal focus.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement
    dialogRef.current?.focus({ preventScroll: true })
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [open])

  if (!open) return null

  const shape = full
    ? 'h-dvh rounded-none md:h-auto md:max-h-[90vh] md:rounded-card'
    : 'max-h-[92dvh] rounded-t-card md:max-h-[85vh] md:rounded-card'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/60 transition-opacity duration-200 starting:opacity-0"
        onClick={dismissible ? onClose : undefined}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative z-10 flex w-full max-w-lg flex-col border border-border bg-surface outline-none! transition-transform duration-200 ease-out starting:translate-y-full md:starting:translate-y-4 ${shape}`}
      >
        <div className="safe-pt flex items-center justify-between px-4 pb-2">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <div className="flex items-center gap-2">
            {headerRight}
            {dismissible ? (
              <button type="button" aria-label="Close" onClick={onClose} className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-muted">
                <X size={18} />
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer ? <div className="safe-pb border-t border-border px-4 pt-3">{footer}</div> : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Write `src/context/ToastContext.tsx`**

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

type ToastApi = { showToast: (message: string) => void }
const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const showToast = useCallback((m: string) => {
    setMessage(m)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMessage(null), 3000)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])
  const api = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {message ? (
        <div role="status" className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4">
          <div className="rounded-full border border-border bg-surface-2 px-4 py-2 text-sm text-text shadow-lg">{message}</div>
        </div>
      ) : null}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
```

- [ ] **Step 7: Write `src/context/AddSheetContext.tsx`**

```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Transaction } from '../lib/types'

export type AddSheetState = { open: boolean; editing: Transaction | null }
type AddSheetApi = {
  state: AddSheetState
  openAdd: () => void
  openEdit: (tx: Transaction) => void
  close: () => void
}
const AddSheetContext = createContext<AddSheetApi | null>(null)

export function AddSheetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AddSheetState>({ open: false, editing: null })
  const openAdd = useCallback(() => setState({ open: true, editing: null }), [])
  const openEdit = useCallback((tx: Transaction) => setState({ open: true, editing: tx }), [])
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), [])
  const api = useMemo(() => ({ state, openAdd, openEdit, close }), [state, openAdd, openEdit, close])
  return <AddSheetContext.Provider value={api}>{children}</AddSheetContext.Provider>
}

export function useAddSheet(): AddSheetApi {
  const ctx = useContext(AddSheetContext)
  if (!ctx) throw new Error('useAddSheet must be used within AddSheetProvider')
  return ctx
}
```

- [ ] **Step 8: Write `src/components/AppShell.tsx`**

```tsx
import { House, Plus, Settings, Tags } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAddSheet } from '../context/AddSheetContext'

const links = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/categories', label: 'Categories', icon: Tags, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
]

export function AppShell() {
  const { openAdd } = useAddSheet()
  return (
    <div className="min-h-dvh bg-bg text-text">
      <div className="mx-auto flex min-h-dvh max-w-5xl">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-border px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-6 md:flex">
          <p className="mb-8 text-xl font-semibold tracking-tight text-accent">Money</p>
          <nav className="flex flex-1 flex-col gap-1">
            {links.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex min-h-11 items-center gap-3 rounded-chip px-3 text-sm font-medium ${isActive ? 'bg-surface-2 text-accent' : 'text-muted hover:bg-surface-2 hover:text-text'}`
                }
              >
                <Icon size={18} /> {label}
              </NavLink>
            ))}
          </nav>
          <button type="button" onClick={openAdd} className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-chip bg-accent font-semibold text-accent-ink">
            <Plus size={18} /> Add
          </button>
        </aside>

        <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
          <main className="safe-pt flex-1 px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] md:px-8 md:pb-8">
            <div className="mx-auto w-full max-w-[640px]">
              <Outlet />
            </div>
          </main>

          <button
            type="button"
            aria-label="Add transaction"
            onClick={openAdd}
            className="fixed right-4 z-40 flex size-14 items-center justify-center rounded-full bg-accent text-accent-ink shadow-lg transition active:scale-95 md:hidden"
            style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
          >
            <Plus size={28} />
          </button>

          <nav className="safe-pb fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur md:hidden">
            <div className="mx-auto flex max-w-5xl">
              {links.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${isActive ? 'text-accent' : 'text-muted'}`
                  }
                >
                  <Icon size={22} /> {label}
                </NavLink>
              ))}
            </div>
          </nav>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 9: Write placeholder pages and `src/App.tsx`**

`src/pages/HomePage.tsx`, `src/pages/CategoriesPage.tsx`, `src/pages/SettingsPage.tsx` (same shape; change the name and heading):
```tsx
export function HomePage() {
  return <h1 className="py-3 text-lg font-semibold">Home</h1>
}
```

`src/App.tsx` (replace the whole file):
```tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AddSheetProvider } from './context/AddSheetContext'
import { ToastProvider } from './context/ToastContext'
import { CategoriesPage } from './pages/CategoriesPage'
import { HomePage } from './pages/HomePage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  return (
    <ToastProvider>
      <AddSheetProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<HomePage />} />
              <Route path="categories" element={<CategoriesPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AddSheetProvider>
    </ToastProvider>
  )
}
```

- [ ] **Step 10: Verify**

Run: `npm run typecheck && npm test`
Expected: PASS.

Run: `npm run dev`, open http://localhost:5173 in Chrome's device toolbar (iPhone size).
Expected: dark page, three bottom tabs switch pages, a lime + button bottom-right, DM Sans renders (check in the Elements panel that `font-family` resolves to "DM Sans Variable").

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: dark theme tokens, app shell with tabs, toast and add-sheet contexts"
```

---

### Task 4: Firebase project, security rules, Google sign-in

**Files:**
- Create: `.firebaserc`, `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `.env.example`, `.env.local` (not committed), `src/lib/platform.ts`, `src/lib/firebase.ts`, `src/context/AuthContext.tsx`, `src/pages/LoginPage.tsx`, `src/components/RequireAuth.tsx`
- Replace: `src/App.tsx`

**Interfaces:**
- Produces: `auth`, `db`, `googleProvider`, `isFirebaseConfigured`, `ALLOWED_EMAIL` (firebase.ts); `isStandalone(): boolean` (platform.ts, used by the install hint in Task 15); `AuthProvider`, `useAuth(): { user: User | null; loading: boolean; configured: boolean; error: string | null; signIn(): Promise<void>; logOut(): Promise<void> }`; `RequireAuth` route guard; `/login` route.

- [ ] **Step 1: Milestone 0 console work (manual, ≈ 20 min)**

1. https://console.firebase.google.com → Add project → name `money-tracker-vlad` (confirm the id is exactly that; otherwise use the id the console gives you everywhere this plan says `money-tracker-vlad`). Disable Google Analytics. Stay on the Spark plan.
2. Build → Authentication → Get started → Sign-in method → Google → Enable, set the support email → Save.
3. Build → Firestore Database → Create database → **Standard edition** → location **`eur3`** (or `nam5` if you live in North America; this cannot be changed later) → Start in production mode → Create.
4. Project settings (gear) → Your apps → Web (`</>`) → nickname "Money Tracker", do not tick Hosting → Register → copy the `firebaseConfig` values into `.env.local` (Step 3 below).
5. Nothing to do in Google Cloud Console: popup sign-in uses the default `firebaseapp.com` auth domain, exactly like food-tracker.
6. Firebase → Authentication → Settings → Authorized domains: confirm `localhost`, `money-tracker-vlad.web.app` and `money-tracker-vlad.firebaseapp.com` are listed; add `money-tracker-vlad.web.app` if missing.
7. Terminal: `npx firebase login`.

- [ ] **Step 2: Write the Firebase config files**

`.firebaserc`:
```json
{ "projects": { "default": "money-tracker-vlad" } }
```

`firebase.json`:
```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }],
    "headers": [
      { "source": "/assets/**", "headers": [{ "key": "Cache-Control", "value": "public,max-age=31536000,immutable" }] },
      { "source": "/sw.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
      { "source": "/manifest.webmanifest", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] }
    ]
  },
  "emulators": {
    "firestore": { "port": 8080 },
    "auth": { "port": 9099 },
    "ui": { "enabled": false }
  }
}
```

`firestore.indexes.json`:
```json
{
  "indexes": [
    {
      "collectionGroup": "transactions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "date", "order": "DESCENDING" },
        { "fieldPath": "at", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

`firestore.rules`:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isOwner() {
      return request.auth != null
        && request.auth.token.email == 'vlad.herasymovychh@gmail.com'
        && request.auth.token.email_verified == true;
    }
    function isKind(k) {
      return k == 'expense' || k == 'income';
    }
    function isIsoDate(s) {
      return s is string && s.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
    }
    function validCategory(d) {
      return d.name is string && d.name.size() >= 1 && d.name.size() <= 40
        && d.icon is string
        && d.color is string
        && isKind(d.kind)
        && d.order is number
        && d.archived is bool;
    }
    function validTransaction(d) {
      return isKind(d.kind)
        && d.amount is int && d.amount > 0 && d.amount < 100000000000
        && d.categoryId is string && d.categoryId.size() >= 1
        && d.note is string && d.note.size() <= 200
        && isIsoDate(d.date)
        && d.at is timestamp;
    }

    match /categories/{id} {
      allow read, delete: if isOwner();
      allow create, update: if isOwner() && validCategory(request.resource.data);
    }
    match /transactions/{id} {
      allow read, delete: if isOwner();
      allow create, update: if isOwner() && validTransaction(request.resource.data);
    }
    match /settings/{id} {
      allow read, write: if isOwner();
    }
  }
}
```

- [ ] **Step 3: Environment files**

`.env.example` (committed):
```
# Copy to .env.local and fill from Firebase Console → Project settings → Your apps → Web app.
VITE_FIREBASE_API_KEY=YOUR_API_KEY
# Default auth domain; popup sign-in works with it in the home-screen app (verified with food-tracker).
VITE_FIREBASE_AUTH_DOMAIN=money-tracker-vlad.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=money-tracker-vlad
VITE_FIREBASE_APP_ID=YOUR_APP_ID
VITE_ALLOWED_EMAIL=vlad.herasymovychh@gmail.com
# Set to 1 to point the dev server at local emulators (firebase emulators:start).
VITE_USE_EMULATORS=0
```

Create `.env.local` with the real `apiKey` and `appId` from the console; `.gitignore` already excludes it.

- [ ] **Step 4: Write `src/lib/platform.ts` and `src/lib/firebase.ts`**

`src/lib/platform.ts`:
```ts
/** True when running as an installed home-screen web app (iOS or desktop). */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  if (nav.standalone === true) return true
  return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
}
```

`src/lib/firebase.ts`:
```ts
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'

const env = import.meta.env
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}

export const ALLOWED_EMAIL: string = env.VITE_ALLOWED_EMAIL ?? 'vlad.herasymovychh@gmail.com'

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId && !String(firebaseConfig.apiKey).includes('YOUR_'),
)

let app: FirebaseApp | null = null
let authInstance: Auth | null = null
let dbInstance: Firestore | null = null

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig)
  authInstance = getAuth(app)
  dbInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  })
  if (env.VITE_USE_EMULATORS === '1') {
    connectAuthEmulator(authInstance, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFirestoreEmulator(dbInstance, '127.0.0.1', 8080)
  }
}

export const auth = authInstance as Auth
export const db = dbInstance as Firestore
export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ login_hint: ALLOWED_EMAIL })
```

- [ ] **Step 5: Write `src/context/AuthContext.tsx`**

```tsx
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ALLOWED_EMAIL, auth, googleProvider, isFirebaseConfigured } from '../lib/firebase'

type AuthContextValue = {
  user: User | null
  loading: boolean
  configured: boolean
  error: string | null
  signIn: () => Promise<void>
  logOut: () => Promise<void>
}
const AuthContext = createContext<AuthContextValue | null>(null)

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : 'Sign-in failed'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false)
      return
    }
    return onAuthStateChanged(auth, (u) => {
      if (u && u.email !== ALLOWED_EMAIL) {
        setError(`This app only accepts ${ALLOWED_EMAIL}`)
        void signOut(auth)
        setUser(null)
      } else {
        setUser(u)
      }
      setLoading(false)
    })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      configured: isFirebaseConfigured,
      error,
      async signIn() {
        setError(null)
        try {
          await signInWithPopup(auth, googleProvider)
        } catch (e) {
          setError(describeError(e))
          throw e
        }
      },
      async logOut() {
        await signOut(auth)
      },
    }),
    [user, loading, error],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
```

- [ ] **Step 6: Write `src/pages/LoginPage.tsx` and `src/components/RequireAuth.tsx`**

`src/pages/LoginPage.tsx`:
```tsx
import { useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { useAuth } from '../context/AuthContext'
import { ALLOWED_EMAIL } from '../lib/firebase'

function Centered({ children }: { children: ReactNode }) {
  return <div className="safe-pt safe-pb flex min-h-dvh items-center justify-center bg-bg px-6 text-center">{children}</div>
}

export function LoginPage() {
  const { user, loading, configured, error, signIn } = useAuth()
  const [busy, setBusy] = useState(false)

  if (!configured) {
    return (
      <Centered>
        <div className="max-w-md space-y-3">
          <h1 className="text-2xl font-semibold text-accent">Firebase not configured</h1>
          <p className="text-sm text-muted">
            Copy <code className="text-text">.env.example</code> to <code className="text-text">.env.local</code>, fill in the web app keys, then restart the dev server.
          </p>
        </div>
      </Centered>
    )
  }
  if (loading) return <Centered><p className="text-muted">Loading…</p></Centered>
  if (user) return <Navigate to="/" replace />

  async function handleSignIn() {
    setBusy(true)
    try {
      await signIn()
    } catch {
      // the message is already in `error`
    } finally {
      setBusy(false)
    }
  }

  return (
    <Centered>
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-2">
          <p className="text-4xl font-semibold tracking-tight text-accent">Money</p>
          <p className="text-sm text-muted">Fast, dark, yours.</p>
        </div>
        <Button className="w-full" onClick={() => void handleSignIn()} disabled={busy}>
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </Button>
        <p className="text-xs text-muted">Only {ALLOWED_EMAIL} can sign in.</p>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    </Centered>
  )
}
```

`src/components/RequireAuth.tsx`:
```tsx
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function RequireAuth() {
  const { user, loading, configured } = useAuth()
  if (!configured || (!loading && !user)) return <Navigate to="/login" replace />
  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center bg-bg text-muted">Loading…</div>
  }
  return <Outlet />
}
```

- [ ] **Step 7: Replace `src/App.tsx`**

```tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { RequireAuth } from './components/RequireAuth'
import { AddSheetProvider } from './context/AddSheetContext'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import { CategoriesPage } from './pages/CategoriesPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AddSheetProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<RequireAuth />}>
                <Route element={<AppShell />}>
                  <Route index element={<HomePage />} />
                  <Route path="categories" element={<CategoriesPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AddSheetProvider>
      </AuthProvider>
    </ToastProvider>
  )
}
```

- [ ] **Step 8: Deploy rules and the index, then verify sign-in**

Run (once the Firebase project exists): `npx firebase deploy --only firestore --project money-tracker-vlad`
Expected: "Deploy complete!"; the console shows the rules text and the index (index builds in a minute or two).

Run: `npm run typecheck && npm run dev`, open http://localhost:5173.
Expected: redirected to `/login`; "Continue with Google" opens the popup; after choosing your account you land on Home. Firebase Console → Authentication → Users lists your account. (Before the project exists, do Step 9 instead and verify the same flow against the Auth emulator.)

Then, in Firebase Console → Authentication → Settings → User actions: untick **Enable create (sign-up)** → Save, so no further accounts can be created (rules already make them useless).

- [ ] **Step 9: Local development without the Firebase project (emulators)**

Until the Firebase project exists, run against the emulators. `.env.local`:
```
VITE_FIREBASE_API_KEY=demo-key
VITE_FIREBASE_AUTH_DOMAIN=localhost
VITE_FIREBASE_PROJECT_ID=demo-money-tracker
VITE_FIREBASE_APP_ID=demo-app
VITE_ALLOWED_EMAIL=vlad.herasymovychh@gmail.com
VITE_USE_EMULATORS=1
```

Terminal 1: `export PATH="/opt/homebrew/opt/openjdk/bin:$PATH" && npx firebase emulators:start --only auth,firestore --project demo-money-tracker --import=./.emulator-data --export-on-exit=./.emulator-data`
Terminal 2: `npm run dev`

Sign in: "Continue with Google" opens the emulator's account page → "Add new account" → any display name, email `vlad.herasymovychh@gmail.com` → Sign in with Google.com. The emulator marks fake Google accounts as verified, which the rules require. Data persists in `.emulator-data/` (git-ignored) between runs.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: Firebase config, security rules, Google sign-in locked to the owner email"
```

---

### Task 5: Security-rules tests against the Firestore emulator

**Files:**
- Create: `vitest.rules.config.ts`, `tests/rules/firestore.rules.test.ts`

**Interfaces:**
- Consumes: `firestore.rules` and `firebase.json` emulator config from Task 4.
- Produces: `npm run test:rules` green.

- [ ] **Step 1: Prerequisites**

Run: `export PATH="/opt/homebrew/opt/openjdk/bin:$PATH" && java -version`
Expected: OpenJDK 21 or newer (Homebrew's `openjdk` keg is already installed on this Mac; put the export in `~/.zshrc` to make it permanent). Without it the emulator fails with "Unable to locate a Java Runtime".

- [ ] **Step 2: Write `vitest.rules.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
})
```

- [ ] **Step 3: Write the failing tests** (`tests/rules/firestore.rules.test.ts`)

```ts
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc, Timestamp, updateDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const OWNER = 'vlad.herasymovychh@gmail.com'
let env: RulesTestEnvironment

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-money-tracker',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})
afterAll(async () => {
  await env.cleanup()
})
beforeEach(async () => {
  await env.clearFirestore()
})

const owner = () => env.authenticatedContext('owner-uid', { email: OWNER, email_verified: true }).firestore()
const stranger = () => env.authenticatedContext('other-uid', { email: 'someone.else@gmail.com', email_verified: true }).firestore()
const unverifiedOwner = () => env.authenticatedContext('owner-uid', { email: OWNER, email_verified: false }).firestore()
const anon = () => env.unauthenticatedContext().firestore()

const validTx = () => ({ kind: 'expense', amount: 1250, categoryId: 'c1', note: '', date: '2026-10-14', at: Timestamp.now(), source: 'app' })
const validCategory = () => ({ name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 2, archived: false })

describe('transactions', () => {
  it('owner can create, read, update and delete a valid transaction', async () => {
    const ref = doc(owner(), 'transactions/t1')
    await assertSucceeds(setDoc(ref, validTx()))
    await assertSucceeds(getDoc(ref))
    await assertSucceeds(updateDoc(ref, { note: 'lunch' }))
    await assertSucceeds(deleteDoc(ref))
  })

  it('another verified Google account is denied', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'transactions/t1'), validTx()))
    await assertFails(getDoc(doc(stranger(), 'transactions/t1')))
    await assertFails(setDoc(doc(stranger(), 'transactions/t2'), validTx()))
  })

  it('the owner email without email_verified is denied', async () => {
    await assertFails(setDoc(doc(unverifiedOwner(), 'transactions/t1'), validTx()))
    await assertFails(getDoc(doc(unverifiedOwner(), 'transactions/t1')))
  })

  it('anonymous is denied', async () => {
    await assertFails(getDoc(doc(anon(), 'transactions/t1')))
    await assertFails(setDoc(doc(anon(), 'transactions/t1'), validTx()))
  })

  it('rejects schema violations on create', async () => {
    const db = owner()
    await assertFails(setDoc(doc(db, 'transactions/bad1'), { ...validTx(), amount: 0 }))
    await assertFails(setDoc(doc(db, 'transactions/bad2'), { ...validTx(), amount: 12.5 }))
    await assertFails(setDoc(doc(db, 'transactions/bad3'), { ...validTx(), kind: 'transfer' }))
    await assertFails(setDoc(doc(db, 'transactions/bad4'), { ...validTx(), date: '14/10/2026' }))
    await assertFails(setDoc(doc(db, 'transactions/bad5'), { ...validTx(), note: 'x'.repeat(201) }))
    await assertFails(setDoc(doc(db, 'transactions/bad6'), { ...validTx(), at: '2026-10-14T10:00:00Z' }))
    await assertFails(setDoc(doc(db, 'transactions/bad7'), { ...validTx(), categoryId: '' }))
  })

  it('rejects an update that breaks the schema', async () => {
    const ref = doc(owner(), 'transactions/t2')
    await assertSucceeds(setDoc(ref, validTx()))
    await assertFails(updateDoc(ref, { amount: -5 }))
  })
})

describe('categories', () => {
  it('owner can create a valid category and archive it', async () => {
    const ref = doc(owner(), 'categories/c1')
    await assertSucceeds(setDoc(ref, validCategory()))
    await assertSucceeds(updateDoc(ref, { archived: true }))
  })
  it('rejects an empty or too-long name', async () => {
    await assertFails(setDoc(doc(owner(), 'categories/c2'), { ...validCategory(), name: '' }))
    await assertFails(setDoc(doc(owner(), 'categories/c3'), { ...validCategory(), name: 'x'.repeat(41) }))
  })
  it('stranger cannot read categories', async () => {
    await assertFails(getDoc(doc(stranger(), 'categories/c1')))
  })
})

describe('settings', () => {
  it('owner can write settings/main; stranger cannot', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'settings/main'), { currency: 'EUR', locale: null }))
    await assertFails(setDoc(doc(stranger(), 'settings/main'), { currency: 'USD', locale: null }))
  })
})

describe('other collections', () => {
  it('nobody can write to an unknown collection', async () => {
    await assertFails(setDoc(doc(owner(), 'secrets/x'), { a: 1 }))
  })
})
```

- [ ] **Step 4: Run the rules tests**

Run: `export PATH="/opt/homebrew/opt/openjdk/bin:$PATH" && npm run test:rules`
Expected: the emulator starts, 11 tests PASS, emulator stops. If a test fails, fix `firestore.rules` (not the test) until the behaviour matches spec §6.

- [ ] **Step 5: Commit**

```bash
git add vitest.rules.config.ts tests
git commit -m "test: Firestore security rules against the emulator"
```

---

### Task 6: Money utilities (minor units, exact parsing, Intl formatting)

**Files:**
- Create: `src/lib/money.ts`
- Test: `src/lib/money.test.ts`

**Interfaces:**
- Produces: `minorUnitDigits(currency: string): number`; `formatMoney(minor: number, currency: string, locale?: string | null, options?: { signed?: boolean }): string`; `parseMinor(text: string, digits: number): number | null`; `minorToDecimalString(minor: number, digits: number): string`.

- [ ] **Step 1: Write the failing tests** (`src/lib/money.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import { formatMoney, minorToDecimalString, minorUnitDigits, parseMinor } from './money'

describe('minorUnitDigits', () => {
  it('knows 2-digit and 0-digit currencies and falls back to 2', () => {
    expect(minorUnitDigits('EUR')).toBe(2)
    expect(minorUnitDigits('JPY')).toBe(0)
    expect(minorUnitDigits('NOPE')).toBe(2)
  })
})

describe('formatMoney', () => {
  it('formats minor units with the currency symbol', () => {
    expect(formatMoney(123456, 'EUR', 'en')).toBe('€1,234.56')
    expect(formatMoney(500, 'JPY', 'en')).toBe('¥500')
    expect(formatMoney(5, 'USD', 'en')).toBe('$0.05')
  })
  it('shows an explicit sign when asked, except for zero', () => {
    expect(formatMoney(250, 'USD', 'en', { signed: true })).toBe('+$2.50')
    expect(formatMoney(-250, 'USD', 'en', { signed: true })).toBe('-$2.50')
    expect(formatMoney(0, 'USD', 'en', { signed: true })).toBe('$0.00')
  })
})

describe('parseMinor', () => {
  it('parses decimal strings exactly', () => {
    expect(parseMinor('12.5', 2)).toBe(1250)
    expect(parseMinor('12', 2)).toBe(1200)
    expect(parseMinor('.5', 2)).toBe(50)
    expect(parseMinor('0.07', 2)).toBe(7)
    expect(parseMinor('5', 0)).toBe(5)
  })
  it('rejects too many decimals, empty and junk', () => {
    expect(parseMinor('12.345', 2)).toBeNull()
    expect(parseMinor('5.0', 0)).toBeNull()
    expect(parseMinor('', 2)).toBeNull()
    expect(parseMinor('1,5', 2)).toBeNull()
    expect(parseMinor('abc', 2)).toBeNull()
  })
})

describe('minorToDecimalString', () => {
  it('renders minor units as a plain decimal', () => {
    expect(minorToDecimalString(1550, 2)).toBe('15.50')
    expect(minorToDecimalString(5, 2)).toBe('0.05')
    expect(minorToDecimalString(500, 0)).toBe('500')
    expect(minorToDecimalString(-1550, 2)).toBe('-15.50')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/money.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/lib/money.ts`**

```ts
/** Number of minor-unit digits for an ISO 4217 code (2 for EUR, 0 for JPY). */
export function minorUnitDigits(currency: string): number {
  try {
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits
    return typeof digits === 'number' ? digits : 2
  } catch {
    return 2
  }
}

export function formatMoney(
  minor: number,
  currency: string,
  locale?: string | null,
  options: { signed?: boolean } = {},
): string {
  const digits = minorUnitDigits(currency)
  const value = minor / 10 ** digits
  return new Intl.NumberFormat(locale ?? undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: options.signed ? 'exceptZero' : 'auto',
  }).format(value)
}

/** Exact parse of a typed decimal ("12.5") into minor units; null when invalid. No floats involved. */
export function parseMinor(text: string, digits: number): number | null {
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text.trim())
  if (!match) return null
  const intPart = match[1] ?? ''
  const fracPart = match[2] ?? ''
  if (intPart === '' && fracPart === '') return null
  if (fracPart.length > digits) return null
  const frac = (fracPart + '0'.repeat(digits)).slice(0, digits)
  return Number(intPart || '0') * 10 ** digits + Number(frac || '0')
}

export function minorToDecimalString(minor: number, digits: number): string {
  const sign = minor < 0 ? '-' : ''
  const padded = String(Math.abs(minor)).padStart(digits + 1, '0')
  if (digits === 0) return sign + padded
  return `${sign}${padded.slice(0, -digits)}.${padded.slice(-digits)}`
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/money.test.ts` → Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/money.ts src/lib/money.test.ts
git commit -m "feat: money utilities with exact minor-unit parsing"
```

---

### Task 7: Date utilities (local ISO dates and months)

**Files:**
- Create: `src/lib/dates.ts`
- Test: `src/lib/dates.test.ts`

**Interfaces:**
- Produces: `toIsoDate(d: Date): IsoDate`; `todayIso(now?: Date): IsoDate`; `parseIsoDate(date: IsoDate): Date` (local noon); `monthOf(date: IsoDate): IsoMonth`; `currentMonth(now?: Date): IsoMonth`; `daysInMonth(month: IsoMonth): number`; `monthRange(month: IsoMonth): { from: IsoDate; to: IsoDate }`; `addMonths(month: IsoMonth, delta: number): IsoMonth`; `addDays(date: IsoDate, delta: number): IsoDate`; `monthLabel(month: IsoMonth, locale?: string | null): string`; `dayLabel(date: IsoDate, today: IsoDate, locale?: string | null): string`; `lastMonths(end: IsoMonth, count: number): IsoMonth[]`.

- [ ] **Step 1: Write the failing tests** (`src/lib/dates.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import {
  addDays, addMonths, currentMonth, dayLabel, daysInMonth, lastMonths, monthLabel, monthOf,
  monthRange, parseIsoDate, toIsoDate, todayIso,
} from './dates'

describe('dates', () => {
  it('formats and parses local ISO dates at noon', () => {
    expect(toIsoDate(new Date(2026, 9, 14, 23, 59))).toBe('2026-10-14')
    const d = parseIsoDate('2026-10-14')
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 14, 12])
    expect(todayIso(new Date(2026, 0, 1))).toBe('2026-01-01')
    expect(monthOf('2026-10-14')).toBe('2026-10')
    expect(currentMonth(new Date(2026, 9, 14))).toBe('2026-10')
  })

  it('knows month lengths and ranges, including leap years', () => {
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2024-02')).toBe(29)
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
  })

  it('adds months across year boundaries', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-10', -12)).toBe('2025-10')
    expect(lastMonths('2026-10', 3)).toEqual(['2026-08', '2026-09', '2026-10'])
  })

  it('adds days without DST or month-boundary surprises', () => {
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30') // Europe DST switch day
    expect(addDays('2026-03-29', -1)).toBe('2026-03-28')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26') // Europe DST end
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('labels months and days', () => {
    expect(monthLabel('2026-10', 'en')).toBe('October 2026')
    expect(dayLabel('2026-10-14', '2026-10-14', 'en')).toBe('Today')
    expect(dayLabel('2026-10-13', '2026-10-14', 'en')).toBe('Yesterday')
    expect(dayLabel('2026-10-01', '2026-10-14', 'en')).toBe('Thu, Oct 1')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/dates.test.ts` → Expected: FAIL.

- [ ] **Step 3: Write `src/lib/dates.ts`**

```ts
import type { IsoDate, IsoMonth } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

export function toIsoDate(d: Date): IsoDate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(now)
}

/** Local noon of the given day: immune to DST shifts when adding/subtracting days. */
export function parseIsoDate(date: IsoDate): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}

export function monthOf(date: IsoDate): IsoMonth {
  return date.slice(0, 7)
}

export function currentMonth(now: Date = new Date()): IsoMonth {
  return monthOf(toIsoDate(now))
}

export function daysInMonth(month: IsoMonth): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

export function monthRange(month: IsoMonth): { from: IsoDate; to: IsoDate } {
  return { from: `${month}-01`, to: `${month}-${pad(daysInMonth(month))}` }
}

export function addMonths(month: IsoMonth, delta: number): IsoMonth {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function addDays(date: IsoDate, delta: number): IsoDate {
  const d = parseIsoDate(date)
  d.setDate(d.getDate() + delta)
  return toIsoDate(d)
}

export function monthLabel(month: IsoMonth, locale?: string | null): string {
  const [y, m] = month.split('-').map(Number)
  return new Intl.DateTimeFormat(locale ?? undefined, { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1))
}

export function dayLabel(date: IsoDate, today: IsoDate, locale?: string | null): string {
  if (date === today) return 'Today'
  if (date === addDays(today, -1)) return 'Yesterday'
  return new Intl.DateTimeFormat(locale ?? undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(parseIsoDate(date))
}

/** `count` months ending at `end`, oldest first. */
export function lastMonths(end: IsoMonth, count: number): IsoMonth[] {
  return Array.from({ length: count }, (_, i) => addMonths(end, i - (count - 1)))
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/dates.test.ts` → Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dates.ts src/lib/dates.test.ts
git commit -m "feat: local-time ISO date helpers"
```

---

### Task 8: Keypad expression engine

**Files:**
- Create: `src/lib/keypad.ts`
- Test: `src/lib/keypad.test.ts`

**Interfaces:**
- Consumes: `parseMinor`, `minorToDecimalString` from Task 6.
- Produces: `KeypadKey` (`'0'`–`'9'`, `'.'`, `'+'`, `'-'`, `'back'`, `'clear'`, `'equals'`); `KeypadState = { expr: string }`; `EMPTY_KEYPAD`; `pressKey(state, key, digits?): KeypadState`; `keypadMinor(state, digits?): number` (≥ 0, capped at 99,999,999,999); `hasOperator(state): boolean`; `keypadFromMinor(minor, digits): KeypadState`.

- [ ] **Step 1: Write the failing tests** (`src/lib/keypad.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import { EMPTY_KEYPAD, hasOperator, keypadFromMinor, keypadMinor, pressKey, type KeypadKey } from './keypad'

const press = (keys: string, digits = 2) =>
  keys.split('').reduce((s, k) => pressKey(s, k as KeypadKey, digits), EMPTY_KEYPAD)

describe('pressKey', () => {
  it('types digits and a decimal point', () => expect(press('12.5').expr).toBe('12.5'))
  it('ignores a second decimal point in the same term', () => expect(press('1.2.3').expr).toBe('1.23'))
  it('caps decimals at the currency digits', () => {
    expect(press('1.234').expr).toBe('1.23')
    expect(press('1.5', 0).expr).toBe('15')
  })
  it('replaces a leading zero', () => expect(press('07').expr).toBe('7'))
  it('starts a decimal with 0.', () => expect(press('.5').expr).toBe('0.5'))
  it('cannot start with an operator', () => expect(press('+5').expr).toBe('5'))
  it('replaces an operator with another operator', () => expect(press('5+-3').expr).toBe('5-3'))
  it('drops a dangling decimal point before an operator', () => expect(press('5.+3').expr).toBe('5+3'))
  it('caps integer digits at 9', () => expect(press('1234567890').expr).toBe('123456789'))
  it('backspace removes the last character', () => expect(pressKey(press('12+'), 'back').expr).toBe('12'))
  it('clear empties the expression', () => expect(pressKey(press('12'), 'clear')).toEqual(EMPTY_KEYPAD))
  it('equals collapses the expression to its value', () => {
    expect(pressKey(press('12.5+3'), 'equals').expr).toBe('15.5')
    expect(pressKey(press('10-15'), 'equals').expr).toBe('')
  })
})

describe('keypadMinor', () => {
  it('evaluates sums in minor units without floats', () => {
    expect(keypadMinor(press('12.5+3'))).toBe(1550)
    expect(keypadMinor(press('0.1+0.2'))).toBe(30)
    expect(keypadMinor(press('10-2.25'))).toBe(775)
  })
  it('ignores a trailing operator and empty input', () => {
    expect(keypadMinor(press('5+'))).toBe(500)
    expect(keypadMinor(EMPTY_KEYPAD)).toBe(0)
  })
  it('clamps negative results to zero', () => expect(keypadMinor(press('10-15'))).toBe(0))
})

describe('helpers', () => {
  it('hasOperator', () => {
    expect(hasOperator(press('12'))).toBe(false)
    expect(hasOperator(press('12+3'))).toBe(true)
  })
  it('keypadFromMinor prefills for editing without trailing zeros', () => {
    expect(keypadFromMinor(1250, 2).expr).toBe('12.5')
    expect(keypadFromMinor(1200, 2).expr).toBe('12')
    expect(keypadFromMinor(500, 0).expr).toBe('500')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/keypad.test.ts` → Expected: FAIL.

- [ ] **Step 3: Write `src/lib/keypad.ts`**

```ts
import { minorToDecimalString, parseMinor } from './money'

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | '+' | '-' | 'back' | 'clear' | 'equals'
export type KeypadState = { expr: string }

export const EMPTY_KEYPAD: KeypadState = { expr: '' }
const MAX_INT_DIGITS = 9
const MAX_MINOR = 99_999_999_999 // rules require amount < 100000000000

function currentTerm(expr: string): string {
  const lastOp = Math.max(expr.lastIndexOf('+'), expr.lastIndexOf('-'))
  return expr.slice(lastOp + 1)
}

function trimZeros(decimal: string): string {
  return decimal.includes('.') ? decimal.replace(/0+$/, '').replace(/\.$/, '') : decimal
}

export function pressKey(state: KeypadState, key: KeypadKey, digits = 2): KeypadState {
  const { expr } = state
  if (key === 'clear') return EMPTY_KEYPAD
  if (key === 'back') return { expr: expr.slice(0, -1) }
  if (key === 'equals') {
    const minor = keypadMinor(state, digits)
    return { expr: minor === 0 ? '' : trimZeros(minorToDecimalString(minor, digits)) }
  }

  const term = currentTerm(expr)
  if (key === '+' || key === '-') {
    if (expr === '') return state
    if (term === '' || term.endsWith('.')) return { expr: expr.slice(0, -1) + key }
    return { expr: expr + key }
  }
  if (key === '.') {
    if (digits === 0 || term.includes('.')) return state
    return { expr: expr + (term === '' ? '0.' : '.') }
  }

  const [intPart, fracPart] = term.split('.')
  if (fracPart !== undefined) {
    if (fracPart.length >= digits) return state
    return { expr: expr + key }
  }
  if (intPart === '0') return { expr: expr.slice(0, -1) + key }
  if (intPart.length >= MAX_INT_DIGITS) return state
  return { expr: expr + key }
}

/** Evaluates the expression exactly in minor units; never below 0, never above MAX_MINOR. */
export function keypadMinor(state: KeypadState, digits = 2): number {
  let total = 0
  let sign = 1
  let term = ''
  const flush = () => {
    const value = parseMinor(term, digits)
    if (value !== null) total += sign * value
    term = ''
  }
  for (const ch of state.expr) {
    if (ch === '+' || ch === '-') {
      flush()
      sign = ch === '+' ? 1 : -1
    } else {
      term += ch
    }
  }
  flush()
  return Math.min(Math.max(0, total), MAX_MINOR)
}

export function hasOperator(state: KeypadState): boolean {
  return /[+-]/.test(state.expr)
}

export function keypadFromMinor(minor: number, digits: number): KeypadState {
  return { expr: trimZeros(minorToDecimalString(minor, digits)) }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/keypad.test.ts` → Expected: 17 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/keypad.ts src/lib/keypad.test.ts
git commit -m "feat: keypad expression engine with exact minor-unit evaluation"
```

---

### Task 9: Statistics (totals, grouping, recency ordering)

**Files:**
- Create: `src/lib/stats.ts`
- Test: `src/lib/stats.test.ts`

**Interfaces:**
- Consumes: `Transaction`, `Category`, `Kind`, `IsoMonth` (Task 2); `daysInMonth` (Task 7).
- Produces: `KindTotals = { expense: number; income: number; net: number }`; `totalsByKind(txs): KindTotals`; `CategoryTotal = { categoryId: string; total: number; count: number; share: number }`; `totalsByCategory(txs, kind): CategoryTotal[]` (sorted desc); `totalsByDay(txs, month, kind): number[]` (index 0 = day 1); `DayGroup = { date: IsoDate; items: Transaction[]; totals: KindTotals }`; `groupByDay(txs): DayGroup[]` (newest day first, items by `at` desc); `orderCategoriesByRecency(categories, txs, kind): Category[]` (active categories of `kind`, most recently used first, then by `order`).

- [ ] **Step 1: Write the failing tests** (`src/lib/stats.test.ts`)

```ts
import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import { groupByDay, orderCategoriesByRecency, totalsByCategory, totalsByDay, totalsByKind } from './stats'
import type { Category, Transaction } from './types'

let seq = 0
const tx = (p: Partial<Transaction> & { amount: number }): Transaction => ({
  id: `t${++seq}`,
  kind: 'expense',
  categoryId: 'c1',
  note: '',
  date: '2026-10-14',
  at: Timestamp.fromDate(new Date(2026, 9, 14, 10, 0)),
  source: 'app',
  ...p,
})
const cat = (id: string, order: number, p: Partial<Category> = {}): Category => ({
  id, name: id, icon: 'Coffee', color: 'amber', kind: 'expense', order, archived: false, ...p,
})

describe('totalsByKind', () => {
  it('sums expenses and income and computes net', () => {
    const t = totalsByKind([tx({ amount: 1250 }), tx({ amount: 300 }), tx({ amount: 10000, kind: 'income' })])
    expect(t).toEqual({ expense: 1550, income: 10000, net: 8450 })
  })
})

describe('totalsByCategory', () => {
  it('groups by category for one kind, sorted by total, with shares', () => {
    const rows = totalsByCategory(
      [tx({ amount: 100, categoryId: 'a' }), tx({ amount: 300, categoryId: 'b' }), tx({ amount: 100, categoryId: 'b' }), tx({ amount: 999, kind: 'income', categoryId: 'z' })],
      'expense',
    )
    expect(rows).toEqual([
      { categoryId: 'b', total: 400, count: 2, share: 0.8 },
      { categoryId: 'a', total: 100, count: 1, share: 0.2 },
    ])
  })
  it('returns an empty list when nothing matches', () => expect(totalsByCategory([], 'income')).toEqual([]))
})

describe('totalsByDay', () => {
  it('returns one bucket per day of the month', () => {
    const days = totalsByDay([tx({ amount: 100, date: '2026-10-14' }), tx({ amount: 50, date: '2026-10-14' }), tx({ amount: 7, date: '2026-10-01' }), tx({ amount: 1, date: '2026-09-30' })], '2026-10', 'expense')
    expect(days).toHaveLength(31)
    expect(days[0]).toBe(7)
    expect(days[13]).toBe(150)
    expect(days[30]).toBe(0)
  })
})

describe('groupByDay', () => {
  it('groups newest day first and newest entry first within a day', () => {
    const early = tx({ amount: 1, date: '2026-10-13', at: Timestamp.fromDate(new Date(2026, 9, 13, 8)) })
    const late = tx({ amount: 2, date: '2026-10-13', at: Timestamp.fromDate(new Date(2026, 9, 13, 20)) })
    const today = tx({ amount: 3, date: '2026-10-14', kind: 'income' })
    const groups = groupByDay([early, today, late])
    expect(groups.map((g) => g.date)).toEqual(['2026-10-14', '2026-10-13'])
    expect(groups[1].items.map((t) => t.amount)).toEqual([2, 1])
    expect(groups[0].totals).toEqual({ expense: 0, income: 3, net: 3 })
    expect(groups[1].totals).toEqual({ expense: 3, income: 0, net: -3 })
  })
})

describe('orderCategoriesByRecency', () => {
  it('puts recently used first, then by order; excludes archived and other kinds', () => {
    const cats = [cat('a', 0), cat('b', 1), cat('c', 2), cat('old', 3, { archived: true }), cat('inc', 0, { kind: 'income' })]
    const txs = [
      tx({ amount: 1, categoryId: 'c', at: Timestamp.fromDate(new Date(2026, 9, 14, 9)) }),
      tx({ amount: 1, categoryId: 'b', at: Timestamp.fromDate(new Date(2026, 9, 14, 11)) }),
      tx({ amount: 1, categoryId: 'old', at: Timestamp.fromDate(new Date(2026, 9, 14, 12)) }),
    ]
    expect(orderCategoriesByRecency(cats, txs, 'expense').map((c) => c.id)).toEqual(['b', 'c', 'a'])
    expect(orderCategoriesByRecency(cats, [], 'income').map((c) => c.id)).toEqual(['inc'])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/stats.test.ts` → Expected: FAIL.

- [ ] **Step 3: Write `src/lib/stats.ts`**

```ts
import { daysInMonth } from './dates'
import type { Category, IsoDate, IsoMonth, Kind, Transaction } from './types'

export type KindTotals = { expense: number; income: number; net: number }

export function totalsByKind(txs: Transaction[]): KindTotals {
  let expense = 0
  let income = 0
  for (const t of txs) {
    if (t.kind === 'expense') expense += t.amount
    else income += t.amount
  }
  return { expense, income, net: income - expense }
}

export type CategoryTotal = { categoryId: string; total: number; count: number; share: number }

export function totalsByCategory(txs: Transaction[], kind: Kind): CategoryTotal[] {
  const acc = new Map<string, { total: number; count: number }>()
  let sum = 0
  for (const t of txs) {
    if (t.kind !== kind) continue
    const entry = acc.get(t.categoryId) ?? { total: 0, count: 0 }
    entry.total += t.amount
    entry.count += 1
    acc.set(t.categoryId, entry)
    sum += t.amount
  }
  return [...acc]
    .map(([categoryId, e]) => ({ categoryId, total: e.total, count: e.count, share: sum === 0 ? 0 : e.total / sum }))
    .sort((a, b) => b.total - a.total || a.categoryId.localeCompare(b.categoryId))
}

export function totalsByDay(txs: Transaction[], month: IsoMonth, kind: Kind): number[] {
  const days = new Array<number>(daysInMonth(month)).fill(0)
  for (const t of txs) {
    if (t.kind !== kind || !t.date.startsWith(`${month}-`)) continue
    days[Number(t.date.slice(8, 10)) - 1] += t.amount
  }
  return days
}

export type DayGroup = { date: IsoDate; items: Transaction[]; totals: KindTotals }

export function groupByDay(txs: Transaction[]): DayGroup[] {
  const byDate = new Map<IsoDate, Transaction[]>()
  for (const t of txs) {
    const list = byDate.get(t.date)
    if (list) list.push(t)
    else byDate.set(t.date, [t])
  }
  return [...byDate]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, items]) => {
      const sorted = [...items].sort((a, b) => b.at.toMillis() - a.at.toMillis())
      return { date, items: sorted, totals: totalsByKind(sorted) }
    })
}

export function orderCategoriesByRecency(categories: Category[], txs: Transaction[], kind: Kind): Category[] {
  const lastUse = new Map<string, number>()
  for (const t of txs) {
    if (t.kind !== kind) continue
    const ms = t.at.toMillis()
    if ((lastUse.get(t.categoryId) ?? -1) < ms) lastUse.set(t.categoryId, ms)
  }
  return categories
    .filter((c) => c.kind === kind && !c.archived)
    .sort((a, b) => (lastUse.get(b.id) ?? -1) - (lastUse.get(a.id) ?? -1) || a.order - b.order)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/stats.test.ts` → Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stats.ts src/lib/stats.test.ts
git commit -m "feat: month statistics and category recency ordering"
```

---

### Task 10: Data layer (mappers, Firestore reads/writes, hooks)

**Files:**
- Create: `src/lib/mappers.ts`, `src/lib/firestore.ts`, `src/hooks/useCategories.ts`, `src/hooks/useTransactions.ts`, `src/hooks/useSettings.ts`
- Test: `src/lib/mappers.test.ts`

**Interfaces:**
- Consumes: Task 2 types/icons/colors/defaults; Task 4 `db`; Task 7 `parseIsoDate`, `todayIso`.
- Produces (mappers.ts): `mapCategory(id, data): Category`; `mapTransaction(id, data): Transaction`; `mapSettings(data): Settings`; `transactionAt(input: { date: IsoDate; at?: Date }, now?: Date): Timestamp`.
- Produces (firestore.ts): `subscribeCategories(onData, onError?): Unsubscribe`; `createCategory(input: CategoryInput): { id: string; done: Promise<void> }`; `updateCategory(id, patch: Partial<CategoryInput>): Promise<void>`; `swapCategoryOrder(a: Category, b: Category): Promise<void>`; `seedDefaultCategories(): Promise<number>`; `subscribeTransactionsInRange(from, to, onData, onError?): Unsubscribe`; `createTransaction(input: TransactionInput): { id: string; done: Promise<void> }`; `updateTransaction(id, input: TransactionInput): Promise<void>`; `deleteTransaction(id): Promise<void>`; `subscribeSettings(onData: (s: Settings | null, fromCache: boolean) => void, onError?): Unsubscribe`; `saveSettings(settings: Settings): Promise<void>`.
- Produces (hooks): `useCategories(): { categories: Category[]; byId: Map<string, Category>; loading: boolean; error: Error | null }`; `useTransactions(from: IsoDate, to: IsoDate): { transactions: Transaction[]; loading: boolean; error: Error | null }`; `useSettings(): { settings: Settings | null; loading: boolean; fromCache: boolean; error: Error | null }`.

Why `{ id, done }` for creates: `setDoc` on a pre-made `doc()` ref gives the id synchronously and resolves `done` only when the server acknowledges, which never happens offline. The UI closes immediately and only uses `done.catch` for errors.

- [ ] **Step 1: Write the failing mapper tests** (`src/lib/mappers.test.ts`)

```ts
import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import { mapCategory, mapSettings, mapTransaction, transactionAt } from './mappers'

describe('mapCategory', () => {
  it('maps a well-formed document', () => {
    const c = mapCategory('c1', { name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 2, archived: false })
    expect(c).toMatchObject({ id: 'c1', name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 2, archived: false })
  })
  it('falls back for unknown icon/color and missing fields', () => {
    const c = mapCategory('c2', { name: 'X', icon: 'NotAnIcon', color: 'magenta', kind: 'income' })
    expect(c).toMatchObject({ icon: 'CircleEllipsis', color: 'slate', kind: 'income', order: 0, archived: false })
  })
})

describe('mapTransaction', () => {
  it('maps a well-formed document and keeps an unknown categoryId', () => {
    const at = Timestamp.fromDate(new Date(2026, 9, 14, 10))
    const t = mapTransaction('t1', { kind: 'income', amount: 1250, categoryId: 'gone', note: 'n', date: '2026-10-14', at, source: 'shortcut' })
    expect(t).toMatchObject({ id: 't1', kind: 'income', amount: 1250, categoryId: 'gone', note: 'n', date: '2026-10-14', source: 'shortcut' })
    expect(t.at.isEqual(at)).toBe(true)
  })
  it('derives `at` from the date when missing and defaults the rest', () => {
    const t = mapTransaction('t2', { amount: 5, date: '2026-10-01' })
    expect(t).toMatchObject({ kind: 'expense', categoryId: '', note: '', source: 'app' })
    expect(t.at.toDate().getDate()).toBe(1)
    expect(t.at.toDate().getHours()).toBe(12)
  })
})

describe('mapSettings', () => {
  it('validates the currency code and locale', () => {
    expect(mapSettings({ currency: 'EUR', locale: 'uk-UA' })).toEqual({ currency: 'EUR', locale: 'uk-UA' })
    expect(mapSettings({ currency: 'nope', locale: 7 })).toEqual({ currency: 'USD', locale: null })
  })
})

describe('transactionAt', () => {
  const now = new Date(2026, 9, 14, 15, 30)
  it('uses the explicit moment when given', () => {
    const at = new Date(2026, 9, 10, 9, 0)
    expect(transactionAt({ date: '2026-10-10', at }, now).toMillis()).toBe(at.getTime())
  })
  it('uses "now" for today and local noon for other days', () => {
    expect(transactionAt({ date: '2026-10-14' }, now).toMillis()).toBe(now.getTime())
    const d = transactionAt({ date: '2026-10-02' }, now).toDate()
    expect([d.getDate(), d.getHours()]).toEqual([2, 12])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/mappers.test.ts` → Expected: FAIL.

- [ ] **Step 3: Write `src/lib/mappers.ts`**

```ts
import { Timestamp } from 'firebase/firestore'
import { isColorKey } from './categoryColors'
import { FALLBACK_ICON, isIconKey } from './categoryIcons'
import { parseIsoDate, todayIso } from './dates'
import type { Category, IsoDate, Kind, Settings, Transaction } from './types'

type Data = Record<string, unknown>

const asKind = (v: unknown): Kind => (v === 'income' ? 'income' : 'expense')
const asTimestamp = (v: unknown): Timestamp | undefined => (v instanceof Timestamp ? v : undefined)

export function mapCategory(id: string, data: Data): Category {
  return {
    id,
    name: typeof data.name === 'string' ? data.name : 'Unnamed',
    icon: isIconKey(data.icon) ? data.icon : FALLBACK_ICON,
    color: isColorKey(data.color) ? data.color : 'slate',
    kind: asKind(data.kind),
    order: typeof data.order === 'number' ? data.order : 0,
    archived: data.archived === true,
    createdAt: asTimestamp(data.createdAt),
    updatedAt: asTimestamp(data.updatedAt),
  }
}

export function mapTransaction(id: string, data: Data): Transaction {
  const date = typeof data.date === 'string' ? data.date : '1970-01-01'
  const source = data.source === 'shortcut' || data.source === 'import' ? data.source : 'app'
  return {
    id,
    kind: asKind(data.kind),
    amount: typeof data.amount === 'number' ? Math.round(data.amount) : 0,
    categoryId: typeof data.categoryId === 'string' ? data.categoryId : '',
    note: typeof data.note === 'string' ? data.note : '',
    date,
    at: asTimestamp(data.at) ?? Timestamp.fromDate(parseIsoDate(date)),
    source,
    createdAt: asTimestamp(data.createdAt),
    updatedAt: asTimestamp(data.updatedAt),
  }
}

export function mapSettings(data: Data): Settings {
  return {
    currency: typeof data.currency === 'string' && /^[A-Z]{3}$/.test(data.currency) ? data.currency : 'USD',
    locale: typeof data.locale === 'string' ? data.locale : null,
  }
}

/** The moment a transaction is ordered by inside its day. */
export function transactionAt(input: { date: IsoDate; at?: Date }, now: Date = new Date()): Timestamp {
  if (input.at) return Timestamp.fromDate(input.at)
  if (input.date === todayIso(now)) return Timestamp.fromDate(now)
  return Timestamp.fromDate(parseIsoDate(input.date))
}
```

Run: `npx vitest run src/lib/mappers.test.ts` → Expected: 7 tests PASS.

- [ ] **Step 4: Write `src/lib/firestore.ts`** (not unit-tested: it only wires the SDK; rules tests and the device checklist cover it)

```ts
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore'
import { DEFAULT_CATEGORIES } from './defaultCategories'
import { db } from './firebase'
import { mapCategory, mapSettings, mapTransaction, transactionAt } from './mappers'
import type { Category, CategoryInput, IsoDate, Settings, Transaction, TransactionInput } from './types'

const categoriesCol = () => collection(db, 'categories')
const transactionsCol = () => collection(db, 'transactions')
const settingsDoc = () => doc(db, 'settings', 'main')

// ---- categories ----

export function subscribeCategories(onData: (categories: Category[]) => void, onError?: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    query(categoriesCol(), orderBy('order')),
    (snap) => onData(snap.docs.map((d) => mapCategory(d.id, d.data()))),
    (e) => onError?.(e),
  )
}

export function createCategory(input: CategoryInput): { id: string; done: Promise<void> } {
  const ref = doc(categoriesCol())
  const done = setDoc(ref, { ...input, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  return { id: ref.id, done }
}

export function updateCategory(id: string, patch: Partial<CategoryInput>): Promise<void> {
  return updateDoc(doc(db, 'categories', id), { ...patch, updatedAt: serverTimestamp() })
}

export function swapCategoryOrder(a: Category, b: Category): Promise<void> {
  const batch = writeBatch(db)
  batch.update(doc(db, 'categories', a.id), { order: b.order, updatedAt: serverTimestamp() })
  batch.update(doc(db, 'categories', b.id), { order: a.order, updatedAt: serverTimestamp() })
  return batch.commit()
}

/** Writes the default categories once; returns how many were written (0 when any category exists). */
export async function seedDefaultCategories(): Promise<number> {
  const existing = await getDocs(query(categoriesCol(), limit(1)))
  if (!existing.empty) return 0
  const batch = writeBatch(db)
  for (const c of DEFAULT_CATEGORIES) {
    batch.set(doc(categoriesCol()), { ...c, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  }
  await batch.commit()
  return DEFAULT_CATEGORIES.length
}

// ---- transactions ----

export function subscribeTransactionsInRange(
  from: IsoDate,
  to: IsoDate,
  onData: (transactions: Transaction[]) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  const q = query(
    transactionsCol(),
    where('date', '>=', from),
    where('date', '<=', to),
    orderBy('date', 'desc'),
    orderBy('at', 'desc'),
  )
  return onSnapshot(q, (snap) => onData(snap.docs.map((d) => mapTransaction(d.id, d.data()))), (e) => onError?.(e))
}

function transactionData(input: TransactionInput) {
  return {
    kind: input.kind,
    amount: input.amount,
    categoryId: input.categoryId,
    note: input.note,
    date: input.date,
    at: transactionAt(input),
  }
}

export function createTransaction(input: TransactionInput): { id: string; done: Promise<void> } {
  const ref = doc(transactionsCol())
  const done = setDoc(ref, { ...transactionData(input), source: 'app', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  return { id: ref.id, done }
}

export function updateTransaction(id: string, input: TransactionInput): Promise<void> {
  return updateDoc(doc(db, 'transactions', id), { ...transactionData(input), updatedAt: serverTimestamp() })
}

export function deleteTransaction(id: string): Promise<void> {
  return deleteDoc(doc(db, 'transactions', id))
}

// ---- settings ----

export function subscribeSettings(onData: (settings: Settings | null, fromCache: boolean) => void, onError?: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    settingsDoc(),
    (snap) => onData(snap.exists() ? mapSettings(snap.data()) : null, snap.metadata.fromCache),
    (e) => onError?.(e),
  )
}

export function saveSettings(settings: Settings): Promise<void> {
  return setDoc(settingsDoc(), { ...settings, updatedAt: serverTimestamp() }, { merge: true })
}
```

- [ ] **Step 5: Write the hooks**

`src/hooks/useCategories.ts`:
```ts
import { useEffect, useMemo, useState } from 'react'
import { subscribeCategories } from '../lib/firestore'
import type { Category } from '../lib/types'

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(
    () =>
      subscribeCategories(
        (c) => {
          setCategories(c)
          setLoading(false)
        },
        setError,
      ),
    [],
  )

  // Includes archived categories on purpose: old transactions still need their names.
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  return { categories, byId, loading, error }
}
```

`src/hooks/useTransactions.ts`:
```ts
import { useEffect, useState } from 'react'
import { subscribeTransactionsInRange } from '../lib/firestore'
import type { IsoDate, Transaction } from '../lib/types'

export function useTransactions(from: IsoDate, to: IsoDate) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    setLoading(true)
    return subscribeTransactionsInRange(
      from,
      to,
      (t) => {
        setTransactions(t)
        setLoading(false)
      },
      setError,
    )
  }, [from, to])

  return { transactions, loading, error }
}
```

`src/hooks/useSettings.ts`:
```ts
import { useEffect, useState } from 'react'
import { subscribeSettings } from '../lib/firestore'
import type { Settings } from '../lib/types'

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [fromCache, setFromCache] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(
    () =>
      subscribeSettings(
        (s, cached) => {
          setSettings(s)
          setFromCache(cached)
          setLoading(false)
        },
        setError,
      ),
    [],
  )

  return { settings, loading, fromCache, error }
}
```

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test` → Expected: PASS.

```bash
git add src/lib/mappers.ts src/lib/mappers.test.ts src/lib/firestore.ts src/hooks
git commit -m "feat: Firestore data layer, defensive mappers and subscription hooks"
```

---

### Task 11: Keypad and amount display components

**Files:**
- Create: `src/components/Keypad.tsx`, `src/components/AmountDisplay.tsx`
- Test: `src/components/Keypad.test.tsx`, `src/components/AmountDisplay.test.tsx`

**Interfaces:**
- Consumes: Task 8 keypad engine, Task 6 money.
- Produces: `Keypad({ onPress: (key: KeypadKey) => void; disableDecimal?: boolean })`; `AmountDisplay({ state: KeypadState; currency: string; locale: string | null; kind: Kind })`.

- [ ] **Step 1: Write the failing tests**

`src/components/Keypad.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Keypad } from './Keypad'

describe('Keypad', () => {
  it('reports every key press', async () => {
    const onPress = vi.fn()
    render(<Keypad onPress={onPress} />)
    await userEvent.click(screen.getByRole('button', { name: '7' }))
    await userEvent.click(screen.getByRole('button', { name: 'Decimal point' }))
    await userEvent.click(screen.getByRole('button', { name: 'Plus' }))
    await userEvent.click(screen.getByRole('button', { name: 'Backspace' }))
    await userEvent.click(screen.getByRole('button', { name: 'Equals' }))
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onPress.mock.calls.map((c) => c[0])).toEqual(['7', '.', '+', 'back', 'equals', 'clear'])
  })
  it('renders 16 keys and can disable the decimal point', () => {
    render(<Keypad onPress={() => {}} disableDecimal />)
    expect(screen.getAllByRole('button')).toHaveLength(16)
    expect(screen.getByRole('button', { name: 'Decimal point' })).toBeDisabled()
  })
})
```

`src/components/AmountDisplay.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AmountDisplay } from './AmountDisplay'

describe('AmountDisplay', () => {
  it('shows the expression and its evaluated value', () => {
    render(<AmountDisplay state={{ expr: '12.5+3' }} currency="EUR" locale="en" kind="expense" />)
    expect(screen.getByTestId('amount-expr')).toHaveTextContent('12.5 + 3')
    expect(screen.getByTestId('amount-total')).toHaveTextContent('= €15.50')
  })
  it('shows 0 for an empty expression without an equals sign', () => {
    render(<AmountDisplay state={{ expr: '' }} currency="EUR" locale="en" kind="expense" />)
    expect(screen.getByTestId('amount-expr')).toHaveTextContent('0')
    expect(screen.getByTestId('amount-total')).toHaveTextContent('€0.00')
    expect(screen.getByTestId('amount-total')).not.toHaveTextContent('=')
  })
})
```

Run: `npx vitest run src/components` → Expected: the two new files FAIL.

- [ ] **Step 2: Write `src/components/Keypad.tsx`**

```tsx
import { Delete } from 'lucide-react'
import type { KeypadKey } from '../lib/keypad'

const KEYS: KeypadKey[] = ['1', '2', '3', 'back', '4', '5', '6', '+', '7', '8', '9', '-', 'clear', '0', '.', 'equals']
const LABELS: Partial<Record<KeypadKey, string>> = { '+': '+', '-': '−', equals: '=', clear: 'C' }
const ARIA: Partial<Record<KeypadKey, string>> = { back: 'Backspace', '+': 'Plus', '-': 'Minus', equals: 'Equals', clear: 'Clear', '.': 'Decimal point' }
const OPERATORS = new Set<KeypadKey>(['back', '+', '-', 'clear', 'equals'])

type Props = { onPress: (key: KeypadKey) => void; disableDecimal?: boolean }

export function Keypad({ onPress, disableDecimal = false }: Props) {
  return (
    <div className="grid grid-cols-4 gap-2" role="group" aria-label="Keypad">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          aria-label={ARIA[key] ?? key}
          disabled={key === '.' && disableDecimal}
          onClick={() => onPress(key)}
          className={`tnum flex h-14 items-center justify-center rounded-chip text-xl font-medium transition active:scale-95 disabled:opacity-30 ${
            key === 'equals' ? 'bg-accent/15 text-accent' : OPERATORS.has(key) ? 'bg-surface text-muted' : 'bg-surface-2 text-text'
          }`}
        >
          {key === 'back' ? <Delete size={22} /> : (LABELS[key] ?? key)}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Write `src/components/AmountDisplay.tsx`**

```tsx
import { hasOperator, keypadMinor, type KeypadState } from '../lib/keypad'
import { formatMoney, minorUnitDigits } from '../lib/money'
import type { Kind } from '../lib/types'

type Props = { state: KeypadState; currency: string; locale: string | null; kind: Kind }

export function AmountDisplay({ state, currency, locale, kind }: Props) {
  const digits = minorUnitDigits(currency)
  const minor = keypadMinor(state, digits)
  const expr = state.expr === '' ? '0' : state.expr.replace(/\+/g, ' + ').replace(/-/g, ' − ')
  return (
    <div className="py-2 text-center">
      <div data-testid="amount-expr" aria-live="polite" className={`tnum truncate text-[40px] font-semibold leading-tight ${kind === 'income' ? 'text-accent' : 'text-text'}`}>
        {expr}
      </div>
      <div data-testid="amount-total" className="tnum mt-1 text-sm text-muted">
        {hasOperator(state) ? '= ' : ''}
        {formatMoney(minor, currency, locale)}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run src/components && npm run typecheck` → Expected: PASS.

```bash
git add src/components/Keypad.tsx src/components/Keypad.test.tsx src/components/AmountDisplay.tsx src/components/AmountDisplay.test.tsx
git commit -m "feat: keypad and amount display components"
```

---

### Task 12: Add/Edit transaction sheet

**Files:**
- Create: `src/components/SegmentedControl.tsx`, `src/components/CategoryChip.tsx`, `src/components/DateChips.tsx`, `src/components/AddTransactionSheet.tsx`
- Modify: `src/components/AppShell.tsx` (render the sheet)
- Test: `src/components/AddTransactionSheet.test.tsx`

**Interfaces:**
- Consumes: Tasks 3, 7, 8, 9, 10, 11.
- Produces: `SegmentedControl<T extends string>({ value: T; options: { value: T; label: string }[]; onChange(v: T): void; ariaLabel: string })`; `CategoryChip({ category, selected?, onClick? })` and `CategoryIcon({ category: Category | undefined; size?: number })`; `DateChips({ value: IsoDate; onChange(d: IsoDate): void })`; `AddTransactionSheet()` (reads `useAddSheet()`; renders nothing when closed).

- [ ] **Step 1: Write the failing test** (`src/components/AddTransactionSheet.test.tsx`)

```tsx
import { Timestamp } from 'firebase/firestore'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AddSheetProvider, useAddSheet } from '../context/AddSheetContext'
import { ToastProvider } from '../context/ToastContext'
import { todayIso } from '../lib/dates'
import type { Category } from '../lib/types'
import { AddTransactionSheet } from './AddTransactionSheet'

const CATS: Category[] = [
  { id: 'c1', name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 0, archived: false },
  { id: 'c2', name: 'Salary', icon: 'Banknote', color: 'emerald', kind: 'income', order: 0, archived: false },
]

const { createTransaction, updateTransaction, deleteTransaction } = vi.hoisted(() => ({
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}))
vi.mock('../lib/firestore', () => ({ createTransaction, updateTransaction, deleteTransaction }))
vi.mock('../hooks/useCategories', () => ({
  useCategories: () => ({ categories: CATS, byId: new Map(CATS.map((c) => [c.id, c])), loading: false, error: null }),
}))
vi.mock('../hooks/useSettings', () => ({
  useSettings: () => ({ settings: { currency: 'EUR', locale: 'en' }, loading: false, fromCache: false, error: null }),
}))
vi.mock('../hooks/useTransactions', () => ({
  useTransactions: () => ({ transactions: [], loading: false, error: null }),
}))

function Harness() {
  const { state, openAdd, openEdit } = useAddSheet()
  return (
    <>
      {!state.open ? <button onClick={openAdd}>open-add</button> : null}
      {!state.open ? (
        <button
          onClick={() =>
            openEdit({ id: 't9', kind: 'expense', amount: 350, categoryId: 'c1', note: 'flat white', date: '2026-10-01', at: Timestamp.fromDate(new Date(2026, 9, 1, 12)), source: 'app' })
          }
        >
          open-edit
        </button>
      ) : null}
      <AddTransactionSheet />
    </>
  )
}

const setup = () => render(<ToastProvider><AddSheetProvider><Harness /></AddSheetProvider></ToastProvider>)

beforeEach(() => {
  vi.clearAllMocks()
  createTransaction.mockReturnValue({ id: 'new', done: new Promise<void>(() => {}) }) // never resolves: offline
  updateTransaction.mockReturnValue(new Promise<void>(() => {}))
})

describe('AddTransactionSheet', () => {
  it('adds an expense without waiting for the server', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-add'))
    expect(screen.getByRole('button', { name: /enter amount/i })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '1' }))
    await user.click(screen.getByRole('button', { name: '2' }))
    await user.click(screen.getByRole('button', { name: 'Coffee' }))
    const save = screen.getByRole('button', { name: /add €12\.00 · coffee/i })
    expect(save).toBeEnabled()
    await user.click(save)
    expect(createTransaction).toHaveBeenCalledWith({ kind: 'expense', amount: 1200, categoryId: 'c1', note: '', date: todayIso() })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps Save disabled when the expression evaluates to zero', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-add'))
    await user.click(screen.getByRole('button', { name: 'Coffee' }))
    for (const key of ['5', 'Minus', '9']) await user.click(screen.getByRole('button', { name: key }))
    expect(screen.getByRole('button', { name: /enter amount/i })).toBeDisabled()
    expect(createTransaction).not.toHaveBeenCalled()
  })

  it('hides expense categories when switching to income', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-add'))
    await user.click(screen.getByRole('radio', { name: 'Income' }))
    expect(screen.queryByRole('button', { name: 'Coffee' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salary' })).toBeInTheDocument()
  })

  it('prefills and updates an existing transaction', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-edit'))
    expect(screen.getByTestId('amount-expr')).toHaveTextContent('3.5')
    expect(screen.getByLabelText('Note')).toHaveValue('flat white')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    for (const key of ['3', '5']) await user.click(screen.getByRole('button', { name: key }))
    await user.click(screen.getByRole('button', { name: /save €35\.00 · coffee/i }))
    expect(updateTransaction).toHaveBeenCalledWith('t9', expect.objectContaining({ amount: 3500, categoryId: 'c1', note: 'flat white', date: '2026-10-01' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
```

Run: `npx vitest run src/components/AddTransactionSheet.test.tsx` → Expected: FAIL (module not found).

- [ ] **Step 2: Write `src/components/SegmentedControl.tsx`**

```tsx
type Option<T extends string> = { value: T; label: string }
type Props<T extends string> = { value: T; options: Option<T>[]; onChange: (v: T) => void; ariaLabel: string }

export function SegmentedControl<T extends string>({ value, options, onChange, ariaLabel }: Props<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex rounded-full bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`min-h-11 flex-1 rounded-full text-sm font-medium transition ${o.value === value ? 'bg-surface text-text' : 'text-muted'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Write `src/components/CategoryChip.tsx`**

```tsx
import { CATEGORY_COLORS, colorTint } from '../lib/categoryColors'
import { CATEGORY_ICONS } from '../lib/categoryIcons'
import type { Category } from '../lib/types'

type ChipProps = { category: Category; selected?: boolean; onClick?: () => void }

export function CategoryChip({ category, selected = false, onClick }: ChipProps) {
  const Icon = CATEGORY_ICONS[category.icon]
  const color = CATEGORY_COLORS[category.color]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="flex min-h-11 shrink-0 items-center gap-2 rounded-chip border px-3 text-sm font-medium transition active:scale-95"
      style={selected ? { background: color, borderColor: color, color: '#0a0a0d' } : { background: colorTint(color), borderColor: 'transparent', color }}
    >
      <Icon size={18} />
      <span className="whitespace-nowrap">{category.name}</span>
    </button>
  )
}

/** Round icon badge used in lists; tolerates a missing (deleted) category. */
export function CategoryIcon({ category, size = 36 }: { category: Category | undefined; size?: number }) {
  const Icon = category ? CATEGORY_ICONS[category.icon] : CATEGORY_ICONS.CircleEllipsis
  const color = category ? CATEGORY_COLORS[category.color] : CATEGORY_COLORS.slate
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full" style={{ width: size, height: size, background: colorTint(color), color }} aria-hidden>
      <Icon size={Math.round(size * 0.5)} />
    </span>
  )
}
```

- [ ] **Step 4: Write `src/components/DateChips.tsx`**

```tsx
import { addDays, todayIso } from '../lib/dates'
import type { IsoDate } from '../lib/types'

type Props = { value: IsoDate; onChange: (d: IsoDate) => void }

export function DateChips({ value, onChange }: Props) {
  const today = todayIso()
  const yesterday = addDays(today, -1)
  const custom = value !== today && value !== yesterday
  const chip = (label: string, date: IsoDate) => (
    <button
      key={label}
      type="button"
      aria-pressed={value === date}
      onClick={() => onChange(date)}
      className={`min-h-11 rounded-full px-3 text-sm font-medium ${value === date ? 'bg-text text-bg' : 'bg-surface-2 text-muted'}`}
    >
      {label}
    </button>
  )
  return (
    <div className="flex items-center gap-2">
      {chip('Today', today)}
      {chip('Yesterday', yesterday)}
      <label className={`relative flex min-h-11 items-center rounded-full px-3 text-sm font-medium ${custom ? 'bg-text text-bg' : 'bg-surface-2 text-muted'}`}>
        {custom ? value : 'Pick…'}
        <input
          type="date"
          aria-label="Pick a date"
          value={value}
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value)
          }}
          className="absolute inset-0 opacity-0"
        />
      </label>
    </div>
  )
}
```

- [ ] **Step 5: Write `src/components/AddTransactionSheet.tsx`**

```tsx
import { Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useAddSheet } from '../context/AddSheetContext'
import { useToast } from '../context/ToastContext'
import { useCategories } from '../hooks/useCategories'
import { useSettings } from '../hooks/useSettings'
import { useTransactions } from '../hooks/useTransactions'
import { currentMonth, monthRange, todayIso } from '../lib/dates'
import { createTransaction, deleteTransaction, updateTransaction } from '../lib/firestore'
import { EMPTY_KEYPAD, keypadFromMinor, keypadMinor, pressKey, type KeypadState } from '../lib/keypad'
import { formatMoney, minorUnitDigits } from '../lib/money'
import { orderCategoriesByRecency } from '../lib/stats'
import type { IsoDate, Kind, Transaction } from '../lib/types'
import { AmountDisplay } from './AmountDisplay'
import { Button } from './Button'
import { CategoryChip } from './CategoryChip'
import { DateChips } from './DateChips'
import { Keypad } from './Keypad'
import { SegmentedControl } from './SegmentedControl'
import { Sheet } from './Sheet'

export function AddTransactionSheet() {
  const { state, close } = useAddSheet()
  if (!state.open) return null
  // key resets all form state for every open
  return <AddTransactionForm key={state.editing?.id ?? 'new'} editing={state.editing} onClose={close} />
}

function AddTransactionForm({ editing, onClose }: { editing: Transaction | null; onClose: () => void }) {
  const { showToast } = useToast()
  const { categories } = useCategories()
  const { settings } = useSettings()
  const { from, to } = monthRange(currentMonth())
  const { transactions: recent } = useTransactions(from, to)

  const currency = settings?.currency ?? 'USD'
  const locale = settings?.locale ?? null
  const digits = minorUnitDigits(currency)

  const [kind, setKind] = useState<Kind>(editing?.kind ?? 'expense')
  const [keypad, setKeypad] = useState<KeypadState>(() => (editing ? keypadFromMinor(editing.amount, digits) : EMPTY_KEYPAD))
  const [categoryId, setCategoryId] = useState<string | null>(editing?.categoryId ?? null)
  const [date, setDate] = useState<IsoDate>(editing?.date ?? todayIso())
  const [note, setNote] = useState(editing?.note ?? '')

  const ordered = useMemo(() => orderCategoriesByRecency(categories, recent, kind), [categories, recent, kind])
  const selected = categories.find((c) => c.id === categoryId)
  const amount = keypadMinor(keypad, digits)
  const canSave = amount > 0 && selected !== undefined && selected.kind === kind

  useEffect(() => {
    if (selected && selected.kind !== kind) setCategoryId(null)
  }, [kind, selected])

  const fail = (what: string) => (e: unknown) => showToast(e instanceof Error ? `${what}: ${e.message}` : what)

  function save() {
    if (!canSave || !selected) return
    const input = { kind, amount, categoryId: selected.id, note: note.trim(), date }
    const pending = editing
      ? updateTransaction(editing.id, { ...input, at: editing.date === date ? editing.at.toDate() : undefined })
      : createTransaction(input).done
    pending.catch(fail('Could not save'))
    onClose() // never wait for the server: the local cache already applied the write
  }

  function remove() {
    if (!editing || !window.confirm('Delete this transaction?')) return
    deleteTransaction(editing.id).catch(fail('Could not delete'))
    onClose()
  }

  const saveLabel = canSave && selected
    ? `${editing ? 'Save' : 'Add'} ${formatMoney(amount, currency, locale)} · ${selected.name}`
    : 'Enter amount and pick a category'

  return (
    <Sheet
      open
      full
      title={editing ? 'Edit' : 'Add'}
      onClose={onClose}
      headerRight={
        editing ? (
          <button type="button" aria-label="Delete" onClick={remove} className="flex size-11 items-center justify-center rounded-full bg-danger/15 text-danger">
            <Trash2 size={18} />
          </button>
        ) : null
      }
      footer={
        <Button className="w-full" disabled={!canSave} onClick={save}>
          {saveLabel}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <SegmentedControl ariaLabel="Kind" value={kind} onChange={setKind} options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]} />
        <AmountDisplay state={keypad} currency={currency} locale={locale} kind={kind} />
        <DateChips value={date} onChange={setDate} />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder="Note (optional)"
          aria-label="Note"
          className="min-h-11 rounded-chip border border-border bg-surface-2 px-3 text-text placeholder:text-muted"
        />
        <div className="-mx-4 overflow-x-auto px-4" aria-label="Category">
          <div className="grid grid-flow-col grid-rows-2 gap-2">
            {ordered.map((c) => (
              <CategoryChip key={c.id} category={c} selected={c.id === categoryId} onClick={() => setCategoryId(c.id)} />
            ))}
          </div>
        </div>
        <Keypad onPress={(k) => setKeypad((s) => pressKey(s, k, digits))} disableDecimal={digits === 0} />
      </div>
    </Sheet>
  )
}
```

- [ ] **Step 6: Render the sheet in the shell** (modify `src/components/AppShell.tsx`)

Add the import at the top:
```tsx
import { AddTransactionSheet } from './AddTransactionSheet'
```
and render it as the last child of the outer `<div className="min-h-dvh bg-bg text-text">`, right before its closing tag:
```tsx
      <AddTransactionSheet />
```

- [ ] **Step 7: Verify and commit**

Run: `npx vitest run src/components && npm run typecheck` → Expected: all PASS (4 sheet tests).

Run: `npm run dev` → sign in → press + → type `12.5 + 3`, pick a category, Save → the sheet closes instantly (the Home page is still a placeholder; the document appears in Firebase Console → Firestore).

```bash
git add -A
git commit -m "feat: add/edit transaction sheet with keypad, categories and date chips"
```

---

### Task 13: Home page (month view) and first-run currency setup

**Files:**
- Create: `src/lib/currencies.ts`, `src/lib/currencies.test.ts`, `src/components/CurrencySheet.tsx`, `src/components/FirstRunGate.tsx`, `src/components/MonthSwitcher.tsx`, `src/components/SummaryCard.tsx`, `src/components/BreakdownList.tsx`, `src/components/TransactionList.tsx`, `src/components/EmptyState.tsx`
- Replace: `src/pages/HomePage.tsx`
- Modify: `src/components/AppShell.tsx` (render `FirstRunGate`)

**Interfaces:**
- Consumes: Tasks 3, 6, 7, 9, 10, 12 (`CategoryIcon`).
- Produces: `CURRENCIES: { code: string; name: string }[]`, `filterCurrencies(query: string, list?): Currency[]`; `CurrencySheet({ open, current: string | null, onSelect(code): void, onClose?, dismissible?, title?, note? })`; `FirstRunGate()`; `MonthSwitcher({ month, locale, onChange })`; `SummaryCard({ totals, currency, locale })`; `BreakdownList({ rows, byId, currency, locale })`; `TransactionList({ groups, byId, currency, locale, today, onSelect })`; `EmptyState({ title, body?, action? })`.

- [ ] **Step 1: Write the failing currency test** (`src/lib/currencies.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import { CURRENCIES, filterCurrencies } from './currencies'

describe('currencies', () => {
  it('lists unique ISO codes with names', () => {
    expect(CURRENCIES.length).toBeGreaterThanOrEqual(25)
    expect(new Set(CURRENCIES.map((c) => c.code)).size).toBe(CURRENCIES.length)
    for (const c of CURRENCIES) expect(c.code).toMatch(/^[A-Z]{3}$/)
  })
  it('filters by code or name, case-insensitively', () => {
    expect(filterCurrencies('hryv').map((c) => c.code)).toEqual(['UAH'])
    expect(filterCurrencies('usd').map((c) => c.code)).toEqual(['USD'])
    expect(filterCurrencies('')).toEqual(CURRENCIES)
    expect(filterCurrencies('zzz')).toEqual([])
  })
})
```

Run: `npx vitest run src/lib/currencies.test.ts` → Expected: FAIL.

- [ ] **Step 2: Write `src/lib/currencies.ts`**

```ts
export type Currency = { code: string; name: string }

export const CURRENCIES: Currency[] = [
  { code: 'PLN', name: 'Polish złoty' },
  { code: 'EUR', name: 'Euro' },
  { code: 'USD', name: 'US dollar' },
  { code: 'UAH', name: 'Ukrainian hryvnia' },
  { code: 'GBP', name: 'British pound' },
  { code: 'CHF', name: 'Swiss franc' },
  { code: 'CZK', name: 'Czech koruna' },
  { code: 'SEK', name: 'Swedish krona' },
  { code: 'NOK', name: 'Norwegian krone' },
  { code: 'DKK', name: 'Danish krone' },
  { code: 'HUF', name: 'Hungarian forint' },
  { code: 'RON', name: 'Romanian leu' },
  { code: 'BGN', name: 'Bulgarian lev' },
  { code: 'GEL', name: 'Georgian lari' },
  { code: 'TRY', name: 'Turkish lira' },
  { code: 'ILS', name: 'Israeli new shekel' },
  { code: 'AED', name: 'UAE dirham' },
  { code: 'CAD', name: 'Canadian dollar' },
  { code: 'AUD', name: 'Australian dollar' },
  { code: 'NZD', name: 'New Zealand dollar' },
  { code: 'JPY', name: 'Japanese yen' },
  { code: 'KRW', name: 'South Korean won' },
  { code: 'CNY', name: 'Chinese yuan' },
  { code: 'HKD', name: 'Hong Kong dollar' },
  { code: 'SGD', name: 'Singapore dollar' },
  { code: 'INR', name: 'Indian rupee' },
  { code: 'THB', name: 'Thai baht' },
  { code: 'BRL', name: 'Brazilian real' },
  { code: 'MXN', name: 'Mexican peso' },
  { code: 'ZAR', name: 'South African rand' },
]

export function filterCurrencies(query: string, list: Currency[] = CURRENCIES): Currency[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter((c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
}
```

Run: `npx vitest run src/lib/currencies.test.ts` → Expected: 2 tests PASS.

- [ ] **Step 3: Write `src/components/CurrencySheet.tsx` and `src/components/FirstRunGate.tsx`**

`src/components/CurrencySheet.tsx`:
```tsx
import { useState } from 'react'
import { filterCurrencies } from '../lib/currencies'
import { Sheet } from './Sheet'

type Props = {
  open: boolean
  current: string | null
  onSelect: (code: string) => void
  onClose?: () => void
  dismissible?: boolean
  title?: string
  note?: string
}

export function CurrencySheet({ open, current, onSelect, onClose, dismissible = true, title = 'Choose currency', note }: Props) {
  const [query, setQuery] = useState('')
  const list = filterCurrencies(query)
  return (
    <Sheet open={open} title={title} onClose={onClose ?? (() => {})} dismissible={dismissible}>
      {note ? <p className="mb-3 text-sm text-muted">{note}</p> : null}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search"
        aria-label="Search currency"
        className="mb-3 min-h-11 w-full rounded-chip border border-border bg-surface-2 px-3 text-text placeholder:text-muted"
      />
      <ul className="flex flex-col gap-1">
        {list.map((c) => (
          <li key={c.code}>
            <button
              type="button"
              onClick={() => onSelect(c.code)}
              className={`flex min-h-12 w-full items-center justify-between rounded-chip px-3 text-left ${c.code === current ? 'bg-surface-2 text-accent' : 'active:bg-surface-2'}`}
            >
              <span>{c.name}</span>
              <span className="tnum text-sm text-muted">{c.code}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
```

`src/components/FirstRunGate.tsx`:
```tsx
import { useToast } from '../context/ToastContext'
import { useSettings } from '../hooks/useSettings'
import { saveSettings, seedDefaultCategories } from '../lib/firestore'
import { CurrencySheet } from './CurrencySheet'

/** Shown once: no settings document on the server yet. Cached "nothing" (fromCache) does not count. */
export function FirstRunGate() {
  const { settings, loading, fromCache } = useSettings()
  const { showToast } = useToast()
  if (loading || fromCache || settings !== null) return null
  return (
    <CurrencySheet
      open
      dismissible={false}
      current="PLN"
      title="Welcome! Pick your currency"
      note="All amounts are shown in this currency. You can change it later in Settings."
      onSelect={(code) => {
        saveSettings({ currency: code, locale: null }).catch((e: unknown) => showToast(e instanceof Error ? e.message : 'Could not save settings'))
        seedDefaultCategories()
          .then((n) => {
            if (n > 0) showToast(`Added ${n} default categories`)
          })
          .catch((e: unknown) => showToast(e instanceof Error ? e.message : 'Could not seed categories'))
      }}
    />
  )
}
```

- [ ] **Step 4: Write the Home page components**

`src/components/MonthSwitcher.tsx`:
```tsx
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addMonths, currentMonth, monthLabel } from '../lib/dates'
import type { IsoMonth } from '../lib/types'

type Props = { month: IsoMonth; locale: string | null; onChange: (m: IsoMonth) => void }

export function MonthSwitcher({ month, locale, onChange }: Props) {
  const isCurrent = month === currentMonth()
  return (
    <div className="flex items-center justify-between py-3">
      <button type="button" aria-label="Previous month" onClick={() => onChange(addMonths(month, -1))} className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-text">
        <ChevronLeft size={20} />
      </button>
      <h1 className="text-lg font-semibold">{monthLabel(month, locale)}</h1>
      <button type="button" aria-label="Next month" disabled={isCurrent} onClick={() => onChange(addMonths(month, 1))} className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-text disabled:opacity-30">
        <ChevronRight size={20} />
      </button>
    </div>
  )
}
```

`src/components/SummaryCard.tsx`:
```tsx
import { formatMoney } from '../lib/money'
import type { KindTotals } from '../lib/stats'

type Props = { totals: KindTotals; currency: string; locale: string | null }

export function SummaryCard({ totals, currency, locale }: Props) {
  return (
    <section className="rounded-card border border-border bg-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">Spent</p>
      <p className="tnum mt-1 truncate text-[40px] font-semibold leading-none">{formatMoney(totals.expense, currency, locale)}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Income</p>
          <p className="tnum mt-0.5 text-lg font-medium text-accent">{formatMoney(totals.income, currency, locale)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Net</p>
          <p className={`tnum mt-0.5 text-lg font-medium ${totals.net < 0 ? 'text-expense' : 'text-text'}`}>{formatMoney(totals.net, currency, locale, { signed: true })}</p>
        </div>
      </div>
    </section>
  )
}
```

`src/components/BreakdownList.tsx`:
```tsx
import { CATEGORY_COLORS } from '../lib/categoryColors'
import { formatMoney } from '../lib/money'
import type { CategoryTotal } from '../lib/stats'
import type { Category } from '../lib/types'
import { CategoryIcon } from './CategoryChip'

type Props = { rows: CategoryTotal[]; byId: Map<string, Category>; currency: string; locale: string | null }

export function BreakdownList({ rows, byId, currency, locale }: Props) {
  if (rows.length === 0) return null
  const max = rows[0].total
  return (
    <section className="mt-4">
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted">By category</h2>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => {
          const category = byId.get(r.categoryId)
          const color = category ? CATEGORY_COLORS[category.color] : CATEGORY_COLORS.slate
          return (
            <li key={r.categoryId} className="rounded-chip bg-surface px-3 py-2">
              <div className="flex items-center gap-3">
                <CategoryIcon category={category} size={32} />
                <span className="flex-1 truncate text-[15px]">{category?.name ?? 'Uncategorized'}</span>
                <span className="tnum text-[15px] font-medium">{formatMoney(r.total, currency, locale)}</span>
                <span className="tnum w-10 text-right text-xs text-muted">{Math.round(r.share * 100)}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full" style={{ width: `${(r.total / max) * 100}%`, background: color }} />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
```

`src/components/TransactionList.tsx`:
```tsx
import { dayLabel } from '../lib/dates'
import { formatMoney } from '../lib/money'
import type { DayGroup } from '../lib/stats'
import type { Category, IsoDate, Transaction } from '../lib/types'
import { CategoryIcon } from './CategoryChip'

type Props = {
  groups: DayGroup[]
  byId: Map<string, Category>
  currency: string
  locale: string | null
  today: IsoDate
  onSelect: (tx: Transaction) => void
}

export function TransactionList({ groups, byId, currency, locale, today, onSelect }: Props) {
  return (
    <section className="mt-4">
      {groups.map((g) => (
        <div key={g.date} className="mb-3">
          <div className="flex items-baseline justify-between px-1 py-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{dayLabel(g.date, today, locale)}</h3>
            <span className="tnum text-xs text-muted">
              {g.totals.expense > 0 ? `−${formatMoney(g.totals.expense, currency, locale)}` : ''}
              {g.totals.income > 0 ? ` +${formatMoney(g.totals.income, currency, locale)}` : ''}
            </span>
          </div>
          <ul className="overflow-hidden rounded-card bg-surface">
            {g.items.map((t) => {
              const category = byId.get(t.categoryId)
              return (
                <li key={t.id}>
                  <button type="button" onClick={() => onSelect(t)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-surface-2">
                    <CategoryIcon category={category} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{category?.name ?? 'Uncategorized'}</span>
                      {t.note ? <span className="block truncate text-xs text-muted">{t.note}</span> : null}
                    </span>
                    <span className={`tnum text-[15px] font-medium ${t.kind === 'income' ? 'text-accent' : 'text-text'}`}>
                      {t.kind === 'income' ? '+' : ''}
                      {formatMoney(t.amount, currency, locale)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </section>
  )
}
```

`src/components/EmptyState.tsx`:
```tsx
import type { ReactNode } from 'react'

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="mt-10 flex flex-col items-center gap-3 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {body ? <p className="max-w-xs text-sm text-muted">{body}</p> : null}
      {action}
    </div>
  )
}
```

- [ ] **Step 5: Replace `src/pages/HomePage.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { BreakdownList } from '../components/BreakdownList'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { MonthSwitcher } from '../components/MonthSwitcher'
import { SummaryCard } from '../components/SummaryCard'
import { TransactionList } from '../components/TransactionList'
import { useAddSheet } from '../context/AddSheetContext'
import { useCategories } from '../hooks/useCategories'
import { useSettings } from '../hooks/useSettings'
import { useTransactions } from '../hooks/useTransactions'
import { currentMonth, monthLabel, monthRange, todayIso } from '../lib/dates'
import { groupByDay, totalsByCategory, totalsByKind } from '../lib/stats'
import type { IsoMonth } from '../lib/types'

export function HomePage() {
  const [month, setMonth] = useState<IsoMonth>(() => currentMonth())
  const { from, to } = monthRange(month)
  const { transactions, loading, error } = useTransactions(from, to)
  const { byId } = useCategories()
  const { settings } = useSettings()
  const { openAdd, openEdit } = useAddSheet()

  const currency = settings?.currency ?? 'USD'
  const locale = settings?.locale ?? null
  const totals = useMemo(() => totalsByKind(transactions), [transactions])
  const breakdown = useMemo(() => totalsByCategory(transactions, 'expense'), [transactions])
  const groups = useMemo(() => groupByDay(transactions), [transactions])

  return (
    <>
      <MonthSwitcher month={month} locale={locale} onChange={setMonth} />
      <SummaryCard totals={totals} currency={currency} locale={locale} />
      {error ? <p className="mt-4 text-center text-sm text-danger">{error.message}</p> : null}
      {!loading && transactions.length === 0 ? (
        <EmptyState
          title={`Nothing in ${monthLabel(month, locale)}`}
          body="Add your first expense with the + button."
          action={<Button onClick={openAdd}>Add expense</Button>}
        />
      ) : (
        <>
          <BreakdownList rows={breakdown} byId={byId} currency={currency} locale={locale} />
          <TransactionList groups={groups} byId={byId} currency={currency} locale={locale} today={todayIso()} onSelect={openEdit} />
        </>
      )}
    </>
  )
}
```

- [ ] **Step 6: Render `FirstRunGate` in the shell** (modify `src/components/AppShell.tsx`)

Add `import { FirstRunGate } from './FirstRunGate'` and render `<FirstRunGate />` next to `<AddTransactionSheet />`.

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm test` → Expected: PASS.

Run: `npm run dev` → fresh sign-in shows the currency sheet once → defaults appear under Categories (Task 14 lists them; for now check Firestore Console) → add a few expenses and an income → Home shows the hero total, income, net, category bars and day groups; tapping a row opens the edit sheet prefilled; the month arrows move through months; a month with nothing shows the empty state. Open a second browser profile: the currency sheet must NOT flash (settings exist on the server).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: home month view with summary, category breakdown and first-run currency setup"
```

---

### Task 14: Categories page (list, create, edit, archive, reorder)

**Files:**
- Create: `src/lib/iconSearch.ts`, `src/lib/iconSearch.test.ts`, `src/components/IconPicker.tsx`, `src/components/ColorPicker.tsx`, `src/components/CategoryEditSheet.tsx`
- Replace: `src/pages/CategoriesPage.tsx`

**Interfaces:**
- Consumes: Tasks 2, 3, 10, 12.
- Produces: `filterIcons(query: string, keys?: IconKey[]): IconKey[]`; `IconPicker({ value: IconKey; onChange(k): void; color: string })`; `ColorPicker({ value: ColorKey; onChange(c): void })`; `CategoryEditSheet({ open, kind, editing: Category | null, siblings: Category[], onClose })`.

- [ ] **Step 1: Write the failing icon-search test** (`src/lib/iconSearch.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import { ICON_KEYS } from './categoryIcons'
import { filterIcons } from './iconSearch'

describe('filterIcons', () => {
  it('returns everything for an empty query and matches case-insensitively', () => {
    expect(filterIcons('')).toEqual(ICON_KEYS)
    expect(filterIcons('coff')).toEqual(['Coffee'])
    expect(filterIcons('HEART')).toEqual(expect.arrayContaining(['HeartPulse', 'HeartHandshake']))
    expect(filterIcons('zzz')).toEqual([])
  })
})
```

Run: `npx vitest run src/lib/iconSearch.test.ts` → Expected: FAIL.

- [ ] **Step 2: Write `src/lib/iconSearch.ts`**

```ts
import { ICON_KEYS, type IconKey } from './categoryIcons'

export function filterIcons(query: string, keys: IconKey[] = ICON_KEYS): IconKey[] {
  const q = query.trim().toLowerCase()
  if (!q) return keys
  return keys.filter((k) => k.toLowerCase().includes(q))
}
```

Run: `npx vitest run src/lib/iconSearch.test.ts` → Expected: PASS.

- [ ] **Step 3: Write the pickers**

`src/components/IconPicker.tsx`:
```tsx
import { useState } from 'react'
import { CATEGORY_ICONS, type IconKey } from '../lib/categoryIcons'
import { filterIcons } from '../lib/iconSearch'

type Props = { value: IconKey; onChange: (k: IconKey) => void; color: string }

export function IconPicker({ value, onChange, color }: Props) {
  const [query, setQuery] = useState('')
  const keys = filterIcons(query)
  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search icons"
        aria-label="Search icons"
        className="mb-2 min-h-11 w-full rounded-chip border border-border bg-surface-2 px-3 text-text placeholder:text-muted"
      />
      <div className="grid grid-cols-6 gap-2" role="listbox" aria-label="Icon">
        {keys.map((k) => {
          const Icon = CATEGORY_ICONS[k]
          const selected = k === value
          return (
            <button
              key={k}
              type="button"
              role="option"
              aria-selected={selected}
              aria-label={k}
              onClick={() => onChange(k)}
              className="flex aspect-square items-center justify-center rounded-chip transition active:scale-95"
              style={selected ? { background: color, color: '#0a0a0d' } : { background: 'var(--color-surface-2)', color: 'var(--color-text)' }}
            >
              <Icon size={22} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

`src/components/ColorPicker.tsx`:
```tsx
import { CATEGORY_COLORS, COLOR_KEYS, type ColorKey } from '../lib/categoryColors'

export function ColorPicker({ value, onChange }: { value: ColorKey; onChange: (c: ColorKey) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
      {COLOR_KEYS.map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={k === value}
          aria-label={k}
          onClick={() => onChange(k)}
          className="size-11 rounded-full border-2 transition active:scale-95"
          style={{ background: CATEGORY_COLORS[k], borderColor: k === value ? '#f4f4f6' : 'transparent' }}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Write `src/components/CategoryEditSheet.tsx`**

```tsx
import { useState } from 'react'
import { useToast } from '../context/ToastContext'
import { CATEGORY_COLORS, COLOR_KEYS, type ColorKey } from '../lib/categoryColors'
import { FALLBACK_ICON, type IconKey } from '../lib/categoryIcons'
import { createCategory, swapCategoryOrder, updateCategory } from '../lib/firestore'
import type { Category, Kind } from '../lib/types'
import { Button } from './Button'
import { CategoryChip } from './CategoryChip'
import { ColorPicker } from './ColorPicker'
import { IconPicker } from './IconPicker'
import { Sheet } from './Sheet'

type Props = {
  open: boolean
  kind: Kind
  editing: Category | null
  /** Active categories of `kind`, sorted by `order` (used for Move up/down and the next order). */
  siblings: Category[]
  onClose: () => void
}

export function CategoryEditSheet({ open, kind, editing, siblings, onClose }: Props) {
  const { showToast } = useToast()
  const [name, setName] = useState(editing?.name ?? '')
  const [icon, setIcon] = useState<IconKey>(editing?.icon ?? FALLBACK_ICON)
  const [color, setColor] = useState<ColorKey>(editing?.color ?? COLOR_KEYS[0])

  const trimmed = name.trim()
  const canSave = trimmed.length > 0 && trimmed.length <= 40
  const preview: Category = { id: editing?.id ?? 'preview', name: trimmed || 'Preview', icon, color, kind, order: 0, archived: false }
  const current = editing ? (siblings.find((c) => c.id === editing.id) ?? editing) : null
  const index = current ? siblings.findIndex((c) => c.id === current.id) : -1
  const fail = (e: unknown) => showToast(e instanceof Error ? `Could not save: ${e.message}` : 'Could not save')

  function save() {
    if (!canSave) return
    if (editing) {
      updateCategory(editing.id, { name: trimmed, icon, color }).catch(fail)
    } else {
      const order = siblings.reduce((max, c) => Math.max(max, c.order), -1) + 1
      createCategory({ name: trimmed, icon, color, kind, order, archived: false }).done.catch(fail)
    }
    onClose()
  }

  function move(delta: -1 | 1) {
    const neighbor = siblings[index + delta]
    if (!current || !neighbor) return
    swapCategoryOrder(current, neighbor).catch(fail)
  }

  function toggleArchived() {
    if (!editing) return
    updateCategory(editing.id, { archived: !editing.archived }).catch(fail)
    onClose()
  }

  return (
    <Sheet
      open={open}
      title={editing ? 'Edit category' : 'New category'}
      onClose={onClose}
      footer={
        <Button className="w-full" disabled={!canSave} onClick={save}>
          {editing ? 'Save' : 'Create'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex justify-center">
          <CategoryChip category={preview} selected />
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="Name"
          aria-label="Name"
          className="min-h-11 rounded-chip border border-border bg-surface-2 px-3 text-text placeholder:text-muted"
        />
        <ColorPicker value={color} onChange={setColor} />
        <IconPicker value={icon} onChange={setIcon} color={CATEGORY_COLORS[color]} />
        {editing ? (
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" disabled={index <= 0} onClick={() => move(-1)}>Move up</Button>
            <Button variant="ghost" className="flex-1" disabled={index < 0 || index >= siblings.length - 1} onClick={() => move(1)}>Move down</Button>
            <Button variant={editing.archived ? 'ghost' : 'danger'} className="flex-1" onClick={toggleArchived}>
              {editing.archived ? 'Unarchive' : 'Archive'}
            </Button>
          </div>
        ) : null}
      </div>
    </Sheet>
  )
}
```

- [ ] **Step 5: Replace `src/pages/CategoriesPage.tsx`**

```tsx
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/Button'
import { CategoryIcon } from '../components/CategoryChip'
import { CategoryEditSheet } from '../components/CategoryEditSheet'
import { SegmentedControl } from '../components/SegmentedControl'
import { useCategories } from '../hooks/useCategories'
import type { Category, Kind } from '../lib/types'

type SheetState = { open: boolean; editing: Category | null; nonce: number }

export function CategoriesPage() {
  const { categories, loading } = useCategories()
  const [kind, setKind] = useState<Kind>('expense')
  const [sheet, setSheet] = useState<SheetState>({ open: false, editing: null, nonce: 0 })

  const active = categories.filter((c) => c.kind === kind && !c.archived).sort((a, b) => a.order - b.order)
  const archived = categories.filter((c) => c.kind === kind && c.archived)
  const open = (editing: Category | null) => setSheet((s) => ({ open: true, editing, nonce: s.nonce + 1 }))
  const close = () => setSheet((s) => ({ ...s, open: false }))

  const row = (c: Category) => (
    <li key={c.id}>
      <button type="button" onClick={() => open(c)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-surface-2">
        <CategoryIcon category={c} />
        <span className="flex-1 truncate text-[15px]">{c.name}</span>
      </button>
    </li>
  )

  return (
    <>
      <div className="flex items-center justify-between py-3">
        <h1 className="text-lg font-semibold">Categories</h1>
        <Button variant="ghost" onClick={() => open(null)}>
          <Plus size={18} /> New
        </Button>
      </div>
      <SegmentedControl ariaLabel="Kind" value={kind} onChange={setKind} options={[{ value: 'expense', label: 'Expenses' }, { value: 'income', label: 'Income' }]} />
      {loading ? <p className="mt-6 text-center text-sm text-muted">Loading…</p> : null}
      <ul className="mt-4 overflow-hidden rounded-card bg-surface">{active.map(row)}</ul>
      {archived.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer px-1 text-xs font-semibold uppercase tracking-wider text-muted">Archived ({archived.length})</summary>
          <ul className="mt-2 overflow-hidden rounded-card bg-surface opacity-70">{archived.map(row)}</ul>
        </details>
      ) : null}
      <CategoryEditSheet
        key={`${sheet.editing?.id ?? 'new'}-${sheet.nonce}`}
        open={sheet.open}
        kind={kind}
        editing={sheet.editing}
        siblings={active}
        onClose={close}
      />
    </>
  )
}
```

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test` → Expected: PASS.

Run: `npm run dev` → Categories lists the seeded defaults in order; New creates one at the bottom with the chosen icon/color; Move up/down reorders live; Archive moves it to the collapsed section and it disappears from the Add sheet's chips while old transactions still show its name on Home.

```bash
git add -A
git commit -m "feat: categories page with icon/color pickers, archive and reorder"
```

---

### Task 15: Settings page (currency, install hint, sign out, version)

**Files:**
- Create: `src/components/InstallHint.tsx`
- Replace: `src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: Task 4 `useAuth`, `isStandalone`; Task 10 `useSettings`, `saveSettings`; Task 13 `CurrencySheet`; `__APP_VERSION__` from Task 1.
- Produces: `InstallHint()` (renders only on iOS Safari when not installed).

- [ ] **Step 1: Write `src/components/InstallHint.tsx`**

```tsx
import { Share } from 'lucide-react'
import { isStandalone } from '../lib/platform'

export function InstallHint() {
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent)
  if (!isIos || isStandalone()) return null
  return (
    <section className="mb-4 rounded-card border border-accent/30 bg-accent/10 p-4 text-sm">
      <p className="font-semibold text-accent">Install as an app</p>
      <p className="mt-1 text-muted">
        Tap <Share size={14} className="inline align-[-2px]" /> Share in Safari, then “Add to Home Screen”. The app then opens full-screen, keeps you signed in and works offline.
      </p>
    </section>
  )
}
```

- [ ] **Step 2: Replace `src/pages/SettingsPage.tsx`**

```tsx
import { useState } from 'react'
import { Button } from '../components/Button'
import { CurrencySheet } from '../components/CurrencySheet'
import { InstallHint } from '../components/InstallHint'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useSettings } from '../hooks/useSettings'
import { saveSettings } from '../lib/firestore'

export function SettingsPage() {
  const { user, logOut } = useAuth()
  const { settings } = useSettings()
  const { showToast } = useToast()
  const [currencyOpen, setCurrencyOpen] = useState(false)

  return (
    <>
      <h1 className="py-3 text-lg font-semibold">Settings</h1>
      <InstallHint />
      <section className="overflow-hidden rounded-card bg-surface">
        <button type="button" onClick={() => setCurrencyOpen(true)} className="flex min-h-12 w-full items-center justify-between px-4 text-left active:bg-surface-2">
          <span>Currency</span>
          <span className="tnum text-muted">{settings?.currency ?? '—'}</span>
        </button>
        <div className="flex min-h-12 items-center justify-between border-t border-border px-4">
          <span>Signed in as</span>
          <span className="truncate pl-4 text-sm text-muted">{user?.email}</span>
        </div>
      </section>
      <Button variant="ghost" className="mt-4 w-full" onClick={() => void logOut()}>
        Sign out
      </Button>
      <p className="mt-6 text-center text-xs text-muted">Money Tracker v{__APP_VERSION__}</p>
      <CurrencySheet
        open={currencyOpen}
        current={settings?.currency ?? null}
        title="Currency"
        note="Changing the currency only changes the symbol and formatting. Existing amounts are not converted."
        onClose={() => setCurrencyOpen(false)}
        onSelect={(code) => {
          saveSettings({ currency: code, locale: settings?.locale ?? null }).catch((e: unknown) => showToast(e instanceof Error ? e.message : 'Could not save'))
          setCurrencyOpen(false)
        }}
      />
    </>
  )
}
```

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck && npm test && npm run lint` → Expected: PASS.

Run: `npm run dev` → Settings shows the currency; changing it reformats Home immediately; Sign out returns to `/login`; the version reads `v0.1.0`. In Chrome's device toolbar with an iPhone user agent the install hint shows; in a desktop tab it does not.

```bash
git add -A
git commit -m "feat: settings page with currency, install hint and sign out"
```

---

### Task 16: PWA assets, deploy, device verification

**Files:**
- Create: `pwa-assets.config.ts`, `public/pwa-64x64.png`, `public/pwa-192x192.png`, `public/pwa-512x512.png`, `public/maskable-icon-512x512.png`, `public/apple-touch-icon-180x180.png`, `public/favicon.ico` (generated), `docs/device-checklist.md`
- Modify: `index.html` (icon links)

**Interfaces:**
- Consumes: the manifest and Workbox config from Task 1, `public/logo.svg` from Task 3, Hosting config from Task 4.
- Produces: the deployed app at `https://money-tracker-vlad.web.app`, installable on iOS with a proper icon.

- [ ] **Step 1: Generate the icons**

```bash
npm install -D @vite-pwa/assets-generator
```

`pwa-assets.config.ts`:
```ts
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#0a0a0d' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#0a0a0d' } },
  },
  images: ['public/logo.svg'],
})
```

Run: `npx pwa-assets-generator`
Expected: `public/` now contains `pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`, `favicon.ico`. Open `apple-touch-icon-180x180.png`: dark background, lime ring, no white edges.

- [ ] **Step 2: Add the icon links to `index.html`** (inside `<head>`, after the existing `<link rel="icon" ...>` line)

```html
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png" sizes="180x180" />
```

- [ ] **Step 3: Build and check the bundle budget**

Run: `npm run build`
Expected: Vite prints each asset with its gzip size. Add up the `.js` gzip sizes: they must total ≤ 250 kB. If over, the usual culprit is importing all of `lucide-react` somewhere (only `CATEGORY_ICONS` and named icons are allowed) — fix and rebuild.

Run: `npm run preview` → open http://localhost:4173 → DevTools → Application → Manifest shows the icons; Service Workers shows `sw.js` activated; Network → set "Offline" → reload → the app still opens and shows cached data.

- [ ] **Step 4: Deploy**

```bash
npm run deploy
```
Expected: "Hosting URL: https://money-tracker-vlad.web.app". Open it on the Mac, sign in with Google (popup) → Home loads.

Optional CI (needs a GitHub repo): `gh repo create n0rahh/money-tracker --private --source=. --push`, then `npx firebase init hosting:github` and accept the defaults (deploy on merge to `main`, preview on PRs); commit the generated `.github/workflows/*.yml`.

- [ ] **Step 5: Write `docs/device-checklist.md`** and run it on the iPhone

```markdown
# iPhone verification checklist (run after every deploy that touches auth, PWA or layout)

Device: iPhone, iOS 26+, Safari. URL: https://money-tracker-vlad.web.app

## Install
- [ ] Open the URL in Safari → Share → Add to Home Screen. The dialog shows the lime icon and the name "Money".
- [ ] The home-screen icon is the generated PNG (not a screenshot). Launching shows a dark splash, no white flash, no Safari chrome.

## Sign-in (decides spec §5)
- [ ] In the installed app: Continue with Google → Google screen → back in the app, signed in (popup flow, same as food-tracker).
- [ ] Force-quit and relaunch: still signed in, Home loads from cache instantly.
- [ ] If sign-in ever fails in the installed app but works in Safari: see the fallbacks in spec §5.

## Layout
- [ ] Status bar area is dark and the month header is not hidden under the notch/Dynamic Island.
- [ ] The bottom tab bar sits above the home indicator; the + button is reachable with the thumb.
- [ ] Tapping the Note field does not zoom the page.
- [ ] The Add sheet fits on the screen with the keypad fully visible (scroll the sheet body on small phones).

## Behaviour
- [ ] Add an expense: +, "12.5", "+", "3", category, Save → the sheet closes at once; Home shows €15.50 under the right category.
- [ ] Airplane mode on → add another expense → it appears in the list → airplane mode off → within seconds Firebase Console shows the document.
- [ ] Edit a transaction's amount and date; delete one (confirm dialog appears).
- [ ] Switch to last month and back; the empty state shows for an empty month.
- [ ] Categories: create, recolor, archive, reorder; archived category still labels its old transactions.
- [ ] Settings: change currency → Home reformats; Sign out → login screen; sign in again.
```

- [ ] **Step 6: Commit and tag**

```bash
git add -A
git commit -m "feat: PWA icons, deploy configuration and device checklist"
git tag m1
```

Milestone 1 is done when every box in `docs/device-checklist.md` is ticked on the phone.

---

## Plan self-review (done while writing)

- **Spec coverage (M1 row of §10):** scaffold (T1), theme (T3), auth (T4), rules + rules tests (T4, T5), categories seed + manage (T10, T13, T14), add/edit/delete with keypad (T8, T11, T12), Home month view with breakdown and day-grouped list (T9, T13), month switcher (T13), currency first-run (T13), PWA manifest/icons/service worker (T1, T16), deploy (T16), device checklist (T16). Not in M1 by design: Trends, pace line, daily strip, suggestions, budgets, recurring, export/import, Siri/Watch (later milestones).
- **Placeholders:** none; every code step carries full file content or an exact insertion.
- **Type consistency:** `createTransaction`/`createCategory` return `{ id, done }` everywhere; `useSettings` exposes `fromCache` (consumed by `FirstRunGate`, mocked in the sheet test); `Sheet` has `dismissible`; `CategoryIcon` lives in `CategoryChip.tsx`; `isStandalone` lives in `src/lib/platform.ts`.
- **Review Focus:** each of the five lines names the task whose test pins it (T8+T12, T7, T9+T10+T13, T12, T5).
