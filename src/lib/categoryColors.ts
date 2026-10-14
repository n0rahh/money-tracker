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
