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
