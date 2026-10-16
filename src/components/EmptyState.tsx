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
