import { ICON_KEYS, type IconKey } from './categoryIcons'

export function filterIcons(query: string, keys: IconKey[] = ICON_KEYS): IconKey[] {
  const q = query.trim().toLowerCase()
  if (!q) return keys
  return keys.filter((k) => k.toLowerCase().includes(q))
}
