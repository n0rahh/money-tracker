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
