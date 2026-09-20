const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

export const money = (n) => usd.format(n)
export const count = (n) => new Intl.NumberFormat('en-US').format(n)

export const pct = (n) => {
  const rounded = Math.round(n * 10) / 10
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}%`
}

export const mult = (n) => `${(Math.floor(n * 100) / 100).toFixed(2)}x`

// "1.45x" reads as arithmetic. "+45% more sales" is what an operator hears.
export const liftPct = (n) => `+${Math.round((n - 1) * 100)}%`
