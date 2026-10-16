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
