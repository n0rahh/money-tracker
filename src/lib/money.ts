const ZERO_DIGITS = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'])
const THREE_DIGITS = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'])
const FOUR_DIGITS = new Set(['CLF', 'UYW'])

/** ISO 4217 minor-unit digits for a currency code (2 for EUR/PLN, 0 for JPY, 3 for KWD). Static on purpose: Intl's CLDR data differs from ISO 4217 for ~18 currencies and changes between ICU releases, and the scale must be identical on every device that reads an amount. Unknown codes fall back to 2. */
export function minorUnitDigits(currency: string): number {
  const code = currency.trim().toUpperCase()
  if (ZERO_DIGITS.has(code)) return 0
  if (THREE_DIGITS.has(code)) return 3
  if (FOUR_DIGITS.has(code)) return 4
  return 2
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

/** Exact parse of a typed decimal ("12.5") into minor units; null when invalid, when it has too many decimals, or when the result exceeds Number.MAX_SAFE_INTEGER. No floats involved. */
export function parseMinor(text: string, digits: number): number | null {
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text.trim())
  if (!match) return null
  const intPart = match[1] ?? ''
  const fracPart = match[2] ?? ''
  if (intPart === '' && fracPart === '') return null
  if (fracPart.length > digits) return null
  const frac = (fracPart + '0'.repeat(digits)).slice(0, digits)
  const minor = Number(intPart || '0') * 10 ** digits + Number(frac || '0')
  return Number.isSafeInteger(minor) ? minor : null
}

export function minorToDecimalString(minor: number, digits: number): string {
  const sign = minor < 0 ? '-' : ''
  const padded = String(Math.abs(minor)).padStart(digits + 1, '0')
  if (digits === 0) return sign + padded
  return `${sign}${padded.slice(0, -digits)}.${padded.slice(-digits)}`
}
