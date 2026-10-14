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
