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
