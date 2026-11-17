'use strict'

const $ = (id) => document.getElementById(id)
const { price, periodDays } = document.currentScript.dataset
const sats = `${Number(price).toLocaleString()} sats`
const keyShape = /^(npub1[02-9ac-hj-np-z]{58}|[0-9a-f]{64})$/i
const badKey = 'Enter an npub (npub1…) or a 64-character hex public key.'

let member = null
let lookups = 0
let invoice = null
let shown = 'lightning'
let failures = 0
let notice = ''
let poll = null
let tick = null

const date = (s) =>
  new Date(s * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
const short = (npub) => `${npub.slice(0, 12)}…${npub.slice(-6)}`
const countdown = (s) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

async function api(path, options) {
  const res = await fetch(path, options)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Something went wrong. Try again.')
  return body
}

const say = (text) => ($('status').textContent = text)

function forget() {
  lookups++
  member = null
  $('pay').hidden = true
  say('')
}

async function lookup() {
  const key = $('pubkey').value.trim()
  forget()
  if (!keyShape.test(key)) return key && say(badKey)
  const mine = lookups
  say('Checking…')
  try {
    const m = await api(`api/member/${encodeURIComponent(key)}`)
    if (mine !== lookups) return
    if (m.blocked) return say('This public key may not publish to this relay.')
    if (m.member && m.until === null)
      return say('This public key already has permanent write access.')
    member = m
    if (m.active) {
      say(`This public key can publish until ${date(m.until)}.`)
      $('pay').textContent = Number(periodDays)
        ? `Pay ${sats} to add ${periodDays} days`
        : `Pay ${sats} for permanent access`
    } else {
      say(
        m.member
          ? "This public key's write access has expired."
          : "This public key isn't signed up yet.",
      )
      $('pay').textContent = `Pay ${sats}`
    }
    $('pay').hidden = false
  } catch (e) {
    if (mine === lookups) say(e.message)
  }
}

async function createInvoice(button) {
  const label = button.textContent
  button.disabled = true
  button.textContent = 'Creating invoice…'
  try {
    show(
      await api('api/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pubkey: member.pubkey }),
      }),
    )
  } catch (e) {
    if (!invoice) say(e.message)
    else {
      notice = e.message
      update({})
    }
  } finally {
    button.disabled = false
    button.textContent = label
  }
}

function showOnchain(inv) {
  $('chain-qr').src = inv.onchainQr
  $('chain-qr-link').href = $('chain-link').href = inv.onchainUri
  $('chain-text').value = inv.address
}

async function tab(name) {
  shown = name
  if (name === 'onchain' && !invoice.address) {
    notice = 'Getting an on-chain address…'
    update({})
    try {
      const inv = await api(
        `api/invoice/${encodeURIComponent(invoice.id)}/onchain`,
        { method: 'POST' },
      )
      notice = ''
      if (inv.address) showOnchain(inv)
      update(inv)
    } catch (e) {
      notice = e.message
      shown = 'lightning'
      update({})
    }
    return
  }
  update({})
}

function show(inv) {
  invoice = inv
  shown = inv.bolt11 ? 'lightning' : 'onchain'
  failures = 0
  notice = ''
  $('offer').hidden = true
  $('invoice').hidden = false
  $('invoice-key').textContent = short(member.npub)
  if (inv.bolt11) {
    $('ln-qr').src = inv.lightningQr
    $('ln-qr-link').href = $('ln-link').href = `lightning:${inv.bolt11}`
    $('ln-text').value = inv.bolt11
  }
  if (inv.address) showOnchain(inv)
  update(inv)
  clearInterval(poll)
  clearInterval(tick)
  poll = setInterval(refresh, 3000)
  tick = setInterval(() => update({}), 1000)
}

function update(inv) {
  invoice = { ...invoice, ...inv }
  const { status, bolt11, address, onchainAvailable, until } = invoice
  const left = invoice.expiresAt - Math.floor(Date.now() / 1000)
  const open = status === 'pending' && left > 0

  $('tabs').hidden = !open || !(bolt11 && (address || onchainAvailable))
  $('lightning').hidden = !open || shown !== 'lightning'
  $('onchain').hidden = !open || shown !== 'onchain' || !address
  for (const b of document.querySelectorAll('#tabs button')) {
    b.classList.toggle('active', b.dataset.tab === shown)
    b.setAttribute('aria-pressed', b.dataset.tab === shown)
  }
  $('renew').hidden = !(status === 'expired' || (status === 'pending' && !open))
  $('next-step').hidden = status !== 'paid'
  $('back').textContent =
    status === 'paid' || status === 'processing' ? 'Done' : 'Back'

  const text = open
    ? `Waiting for payment of ${Number(invoice.amountSats).toLocaleString()} sats. This invoice expires in ${countdown(left)}.`
    : {
        pending:
          'This invoice has expired. If you paid it, wait here while the payment is checked; otherwise get a new invoice.',
        processing:
          'Payment received and waiting to confirm. You can close this page; access starts once it confirms.',
        paid:
          until == null
            ? 'Paid. This public key can now publish to the relay.'
            : `Paid. This public key can publish to the relay until ${date(until)}.`,
        expired: 'This invoice expired without a payment.',
      }[status]
  $('invoice-status').textContent = [
    text,
    failures >= 3 && status !== 'paid' && status !== 'expired'
      ? 'The relay is not answering right now; still trying.'
      : '',
    notice,
  ]
    .filter(Boolean)
    .join(' ')

  if (status === 'paid' || status === 'expired') {
    clearInterval(poll)
    clearInterval(tick)
  }
}

async function refresh() {
  try {
    const inv = await api(`api/invoice/${encodeURIComponent(invoice.id)}`)
    failures = 0
    update(inv)
  } catch {
    failures++
    update({})
  }
}

function back() {
  clearInterval(poll)
  clearInterval(tick)
  invoice = null
  $('invoice').hidden = true
  $('offer').hidden = false
  lookup()
}

async function copy(button) {
  const field = $(button.dataset.copy)
  try {
    await navigator.clipboard.writeText(field.value)
  } catch {
    field.select()
    document.execCommand('copy')
  }
  const label = button.textContent
  button.textContent = 'Copied'
  setTimeout(() => (button.textContent = label), 1500)
}

if ($('key-form')) {
  const offerExtension = () => {
    if (window.nostr) $('use-extension').hidden = false
  }
  offerExtension()
  setTimeout(offerExtension, 1000)
  $('use-extension').onclick = async () => {
    try {
      $('pubkey').value = await window.nostr.getPublicKey()
      lookup()
    } catch {
      say('The extension did not share a public key.')
    }
  }
  $('pubkey').oninput = () =>
    keyShape.test($('pubkey').value.trim()) ? lookup() : forget()
  $('pubkey').onblur = () => {
    const key = $('pubkey').value.trim()
    if (key && !keyShape.test(key)) say(badKey)
  }
  $('key-form').onsubmit = (e) => {
    e.preventDefault()
    lookup()
  }
  $('pay').onclick = () => createInvoice($('pay'))
  $('renew').onclick = () => createInvoice($('renew'))
  $('back').onclick = back
  for (const b of document.querySelectorAll('.copy')) b.onclick = () => copy(b)
  for (const b of document.querySelectorAll('#tabs button'))
    b.onclick = () => tab(b.dataset.tab)
  if ($('pubkey').value.trim()) lookup()
}
