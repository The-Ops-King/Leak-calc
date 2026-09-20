/**
 * The breakdown email. Sent from the serverless function after the contact is
 * upserted, never before: a failed send must not cost you the lead.
 *
 * Deliberately light rather than matching the site's dark theme. Dark email
 * backgrounds get mangled by Outlook and by clients running their own dark
 * mode, and a broken first email is worse than an off-brand one.
 */

const ACCENT = '#3f7d5c'
const INK = '#1a1a19'
const MUTED = '#6a6660'
const HAIR = '#e6e3dc'

export const CAUSES = [
  {
    title: 'The lead lands somewhere nobody is watching',
    body: 'A form posts to an inbox, and the inbox gets checked between other work. Nothing is broken, which is why it goes unnoticed for months. The fix is routing the lead to a phone that buzzes, not to a tab someone opens later.',
  },
  {
    title: 'Nobody owns the clock',
    body: 'When two or three people could pick a lead up, the honest answer is that none of them has to. Speed comes from one name against one window, and from everyone knowing what happens when that window is missed.',
  },
  {
    title: 'A human sits between the form and the first touch',
    body: 'Somebody has to notice the lead, open the CRM, find the number and dial it. Every one of those steps is a place the clock keeps running. The first touch should fire on its own, with the human picking up a live conversation instead of starting one.',
  },
]

export function buildBreakdownEmail({ firstName, deal, band, target, funnel }) {
  const { now, improved, leakMonthly, leakAnnual } = funnel
  const subject = `${money(leakMonthly)} a month, and where it is going`

  const rows = [
    ['Leads', count(now.leads), count(improved.leads)],
    [`Booked (${pct(now.bookingRate)} to ${pct(improved.bookingRate)})`, qty(now.booked), qty(improved.booked)],
    ['Showed up', qty(now.showed), qty(improved.showed)],
    ['Bought', qty(now.sold), qty(improved.sold)],
    ['Revenue', money(now.revenue), money(improved.revenue)],
  ]

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f3ee;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ee;">
<tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${HAIR};border-radius:8px;">

<tr><td style="padding:28px 24px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<p style="margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${ACCENT};">Your numbers</p>
<p style="margin:0 0 18px;font-size:16px;line-height:1.55;color:${INK};">${esc(firstName)}, here is the breakdown, and the three things that usually cause it.</p>
</td></tr>

<tr><td style="padding:0 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9f7;border:1px solid #d9e5dd;border-radius:8px;">
<tr><td style="padding:20px 20px 18px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<p style="margin:0;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${ACCENT};">Leaking every month</p>
<p style="margin:4px 0 6px;font-size:40px;line-height:1;font-weight:600;color:${INK};">${money(leakMonthly)}</p>
<p style="margin:0;font-size:14px;color:${MUTED};">That is <strong style="color:${INK};">${money(leakAnnual)}</strong> a year at your current lead volume. You answer ${esc(band.toLowerCase())}.</p>
</td></tr></table>
</td></tr>

<tr><td style="padding:22px 24px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<p style="margin:0 0 10px;font-size:16px;font-weight:600;color:${INK};">Your funnel, both ways</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
<tr>
<td style="padding:0 0 8px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};"></td>
<td align="right" style="padding:0 0 8px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};">Now</td>
<td align="right" style="padding:0 0 8px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:${ACCENT};">${esc(shortTarget(target))}</td>
</tr>
${rows.map(([label, a, b], i) => `<tr>
<td style="padding:9px 0;border-top:1px solid ${HAIR};color:${MUTED};">${esc(label)}</td>
<td align="right" style="padding:9px 0;border-top:1px solid ${HAIR};color:${INK};font-weight:600;${i === rows.length - 1 ? 'font-size:15px;' : ''}">${esc(a)}</td>
<td align="right" style="padding:9px 0;border-top:1px solid ${HAIR};color:${ACCENT};font-weight:600;${i === rows.length - 1 ? 'font-size:15px;' : ''}">${esc(b)}</td>
</tr>`).join('')}
</table>
<p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:${MUTED};">Only the booking rate moves. Your show rate and close rate stay where you put them, because answering faster does not make a rep better on the call. It also books people who were previously on the fence, and those tend to show and buy a little less, so the two effects roughly cancel.</p>
</td></tr>

<tr><td style="padding:24px 24px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<p style="margin:0 0 12px;font-size:16px;font-weight:600;color:${INK};">The three things that usually cause it</p>
${CAUSES.map((c, i) => `<p style="margin:0 0 4px;font-size:14px;font-weight:600;color:${INK};">${i + 1}. ${esc(c.title)}</p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${MUTED};">${esc(c.body)}</p>`).join('')}
</td></tr>

<tr><td style="padding:6px 24px 28px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<a href="https://jtylerray.com/card" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 22px;border-radius:6px;">Talk through your setup</a>
<p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:${MUTED};">These are estimates from published averages (Velocify, MIT/Oldroyd, Harvard Business Review), applied to the numbers you entered. Your business is not an average. Use this to size the problem, not to forecast a quarter.</p>
<p style="margin:10px 0 0;font-size:12px;color:${MUTED};">J. Tyler Ray &middot; <a href="https://jtylerray.com/card" style="color:${ACCENT};">jtylerray.com/card</a></p>
</td></tr>

</table></td></tr></table></body></html>`

  const text = [
    `${firstName}, here is the breakdown.`,
    ``,
    `LEAKING EVERY MONTH: ${money(leakMonthly)}`,
    `That is ${money(leakAnnual)} a year at your current lead volume. You answer ${band.toLowerCase()}.`,
    ``,
    `YOUR FUNNEL, BOTH WAYS`,
    ...rows.map(([label, a, b]) => `  ${label}: ${a} now, ${b} ${shortTarget(target).toLowerCase()}`),
    ``,
    `Only the booking rate moves. Your show rate and close rate stay where you put them, because answering faster does not make a rep better on the call. It also books people who were previously on the fence, and those tend to show and buy a little less, so the two effects roughly cancel.`,
    ``,
    `THE THREE THINGS THAT USUALLY CAUSE IT`,
    ...CAUSES.flatMap((c, i) => [``, `${i + 1}. ${c.title}`, `   ${c.body}`]),
    ``,
    `Talk through your setup: https://jtylerray.com/card`,
    ``,
    `These are estimates from published averages (Velocify, MIT/Oldroyd, Harvard Business Review), applied to the numbers you entered. Your business is not an average.`,
    `Average deal value used: ${money(deal)}.`,
  ].join('\n')

  return { subject, html, text }
}

const shortTarget = (t) => t.replace('inside ', 'In ').replace(' minutes', ' min').replace(' minute', ' min')

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const money = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
const count = (n) => new Intl.NumberFormat('en-US').format(Math.round(n))
const qty = (n) => (n >= 100 ? count(n) : (Math.round(n * 10) / 10).toFixed(1))
const pct = (n) => {
  const r = Math.round(n * 10) / 10
  return `${r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)}%`
}
