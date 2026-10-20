import { useId, useRef } from 'react'
import { useToast } from '../context/ToastContext'
import { Button } from './Button'

type Props = {
  label: string
  value: string
  /** Text of several lines, such as JSON: a read-only text area of up to MAX_ROWS rows instead of one line of code. */
  multiline?: boolean
  /** A line under the value. */
  hint?: string
}

/** A taller area would push the next value off a phone's screen; the rest scrolls inside it. */
const MAX_ROWS = 8

/**
 * A value to paste into another app, with a Copy button. The label names the whole group, so a screen reader reads
 * "Project id" and the value together, and the button says what it copies ("Copy Project id").
 */
export function CopyField({ label, value, multiline = false, hint }: Props) {
  const { showToast } = useToast()
  const labelId = useId()
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const codeRef = useRef<HTMLElement>(null)

  // Where the clipboard cannot be used, the text is selected instead, ready for the system's own Copy.
  function select() {
    const area = areaRef.current
    if (area) {
      area.focus()
      // setSelectionRange rather than select(): iOS Safari ignores select() on a read-only field.
      area.setSelectionRange(0, area.value.length)
      return
    }
    const code = codeRef.current
    if (!code) return
    code.focus()
    window.getSelection()?.selectAllChildren(code)
  }

  function copy() {
    // Started within the tap, not after an await: iOS lets a page write to the clipboard only from a user's tap. There is
    // no clipboard at all outside a secure context (the dev server opened by a LAN address).
    const written: Promise<void> = navigator.clipboard ? navigator.clipboard.writeText(value) : Promise.reject(new Error('No clipboard'))
    written.then(
      () => showToast('Copied'),
      () => {
        select()
        showToast('Select and copy the text')
      },
    )
  }

  return (
    <div role="group" aria-labelledby={labelId}>
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">
          {label}
        </span>
        <Button variant="ghost" aria-label={`Copy ${label}`} onClick={copy}>
          Copy
        </Button>
      </div>
      {multiline ? (
        <textarea
          ref={areaRef}
          aria-labelledby={labelId}
          readOnly
          value={value}
          rows={Math.min(MAX_ROWS, value.split('\n').length)}
          // Soft-wrapped, never scrolled sideways: a long name or id breaks onto the next line on a 375 px phone.
          className="mt-2 block w-full resize-none rounded-chip border border-border bg-surface-2 px-3 py-2 font-mono text-text [overflow-wrap:anywhere]"
        />
      ) : (
        // Focusable from script only (tabIndex -1), for the selection fallback; select-all takes the whole value in one tap.
        <code ref={codeRef} tabIndex={-1} className="mt-2 block select-all rounded-chip bg-surface-2 px-3 py-2.5 font-mono text-sm break-all text-text">
          {value}
        </code>
      )}
      {hint ? <p className="mt-1 px-1 text-xs text-muted">{hint}</p> : null}
    </div>
  )
}
