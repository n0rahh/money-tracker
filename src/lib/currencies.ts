export type Currency = { code: string; name: string }

export const CURRENCIES: Currency[] = [
  { code: 'PLN', name: 'Polish złoty' },
  { code: 'EUR', name: 'Euro' },
  { code: 'USD', name: 'US dollar' },
  { code: 'UAH', name: 'Ukrainian hryvnia' },
  { code: 'GBP', name: 'British pound' },
  { code: 'CHF', name: 'Swiss franc' },
  { code: 'CZK', name: 'Czech koruna' },
  { code: 'SEK', name: 'Swedish krona' },
  { code: 'NOK', name: 'Norwegian krone' },
  { code: 'DKK', name: 'Danish krone' },
  { code: 'HUF', name: 'Hungarian forint' },
  { code: 'RON', name: 'Romanian leu' },
  { code: 'BGN', name: 'Bulgarian lev' },
  { code: 'GEL', name: 'Georgian lari' },
  { code: 'TRY', name: 'Turkish lira' },
  { code: 'ILS', name: 'Israeli new shekel' },
  { code: 'AED', name: 'UAE dirham' },
  { code: 'CAD', name: 'Canadian dollar' },
  { code: 'AUD', name: 'Australian dollar' },
  { code: 'NZD', name: 'New Zealand dollar' },
  { code: 'JPY', name: 'Japanese yen' },
  { code: 'KRW', name: 'South Korean won' },
  { code: 'CNY', name: 'Chinese yuan' },
  { code: 'HKD', name: 'Hong Kong dollar' },
  { code: 'SGD', name: 'Singapore dollar' },
  { code: 'INR', name: 'Indian rupee' },
  { code: 'THB', name: 'Thai baht' },
  { code: 'BRL', name: 'Brazilian real' },
  { code: 'MXN', name: 'Mexican peso' },
  { code: 'ZAR', name: 'South African rand' },
]

export function filterCurrencies(query: string, list: Currency[] = CURRENCIES): Currency[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter((c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
}
