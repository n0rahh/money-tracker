/** Number of minor-unit digits for an ISO 4217 code (2 for EUR, 0 for JPY). */
export function minorUnitDigits(currency: string): number {
  try {
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits
    return typeof digits === 'number' ? digits : 2
  } catch {
    return 2
  }
}

export function formatMoney(
  minor: number,
  currency: string,
  locale?: string | null,
  options: { signed?: boolean } = {},
): string {
  const digits = minorUnitDigits(currency)
  const value = minor / 10 ** digits
  return new Intl.NumberFormat(locale ?? undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: options.signed ? 'exceptZero' : 'auto',
  }).format(value)
}

/** Exact parse of a typed decimal ("12.5") into minor units; null when invalid. No floats involved. */
export function parseMinor(text: string, digits: number): number | null {
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text.trim())
  if (!match) return null
  const intPart = match[1] ?? ''
  const fracPart = match[2] ?? ''
  if (intPart === '' && fracPart === '') return null
  if (fracPart.length > digits) return null
  const frac = (fracPart + '0'.repeat(digits)).slice(0, digits)
  return Number(intPart || '0') * 10 ** digits + Number(frac || '0')
}

export function minorToDecimalString(minor: number, digits: number): string {
  const sign = minor < 0 ? '-' : ''
  const padded = String(Math.abs(minor)).padStart(digits + 1, '0')
  if (digits === 0) return sign + padded
  return `${sign}${padded.slice(0, -digits)}.${padded.slice(-digits)}`
}
