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
