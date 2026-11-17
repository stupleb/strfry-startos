import type { SubContainer, T } from '@start9labs/start-sdk'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { signupState, type Members } from './fileModels/signupState.json'
import { storeJson, type Store } from './fileModels/store.json'
import { i18n } from './i18n'
import type { manifest } from './manifest'
import { sdk } from './sdk'

export const relayPort = 7777
export const signupPort = 8080
export const signupAdminPort = 8081
export const appUid = 1000

// host ids and internal ports from lnbits-startos's and btcpayserver-startos's startos/utils.ts
export const backendHosts = {
  lnbits: { packageId: 'lnbits', hostId: 'main', internalPort: 5000 },
  btcpay: { packageId: 'btcpayserver', hostId: 'main', internalPort: 23000 },
} as const

const etcDir = `${sdk.volumes.startos.path}/etc`
export const etcMount = '/etc/strfry'
const confPath = `${etcMount}/strfry.conf`
const policyPath = `${etcMount}/write-policy`

export const mounts = sdk.Mounts.of()
  .mountVolume({
    volumeId: 'main',
    subpath: null,
    mountpoint: '/data',
    readonly: false,
  })
  .mountVolume({
    volumeId: 'startos',
    subpath: 'etc',
    mountpoint: etcMount,
    readonly: true,
  })

export const signupDir = `${sdk.volumes.startos.path}/signup`

export const signupMounts = sdk.Mounts.of()
  .mountVolume({
    volumeId: 'startos',
    subpath: 'signup',
    mountpoint: '/var/lib/signup',
    readonly: false,
  })
  .mountVolume({
    volumeId: 'startos',
    subpath: 'etc',
    mountpoint: etcMount,
    readonly: true,
  })

export const day = (seconds: number) =>
  new Date(seconds * 1000).toISOString().slice(0, 10)

type StrfrySub = SubContainer<typeof manifest>

export const relay: { sub?: StrfrySub } = {}

// LMDB tells readers apart by PID, so a second subcontainer's PID namespace can collide with the relay's
export const withStrfry = <R>(
  effects: T.Effects,
  name: string,
  fn: (sub: StrfrySub) => Promise<R>,
) =>
  relay.sub
    ? fn(relay.sub)
    : sdk.SubContainer.withTemp(
        effects,
        { imageId: 'strfry' },
        mounts,
        name,
        fn,
      )

export const strfry = (...args: string[]) => [
  'strfry',
  `--config=${confPath}`,
  ...args,
]

const threeYears = 94_608_000
// strfry subtracts this from the current time unsigned: a value above it rejects every event
const twentyYears = 630_720_000

export const acceptOldEventsArg = `--set=events.rejectEventsOlderThanSeconds=${twentyYears}`

export const relayUrlPattern = {
  regex: '^wss?://\\S+$',
  description: i18n('Enter a relay address starting with wss:// or ws://'),
}

export const keyPattern = {
  regex: '^(npub1[02-9ac-hj-np-z]{58}|[0-9a-fA-F]{64})$',
  description: i18n('Enter an npub (npub1…) or a 64-character hex public key'),
}

const bech32Charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

const bech32Polymod = (values: number[]) => {
  const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  for (const v of values) {
    const top = chk >> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    gen.forEach((g, i) => {
      if ((top >> i) & 1) chk ^= g
    })
  }
  return chk
}

const bech32Bytes = (value: string, prefix: string) => {
  const data = value.startsWith(`${prefix}1`)
    ? value.slice(prefix.length + 1)
    : ''
  if (!/^[02-9ac-hj-np-z]{7,}$/.test(data)) return undefined
  const words = data.split('').map((c) => bech32Charset.indexOf(c))
  const hrp = prefix.split('').map((c) => c.charCodeAt(0))
  if (
    bech32Polymod([
      ...hrp.map((c) => c >> 5),
      0,
      ...hrp.map((c) => c & 31),
      ...words,
    ]) !== 1
  )
    return undefined
  let acc = 0
  let bits = 0
  const bytes: number[] = []
  for (const w of words.slice(0, -6)) {
    acc = ((acc << 5) | w) & 0xfff
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((acc >> bits) & 0xff)
    }
  }
  return bytes
}

export function toNpub(hex: string) {
  const words: number[] = []
  let acc = 0
  let bits = 0
  for (const byte of Buffer.from(hex, 'hex')) {
    acc = ((acc << 8) | byte) & 0xfff
    bits += 8
    while (bits >= 5) {
      bits -= 5
      words.push((acc >> bits) & 31)
    }
  }
  if (bits) words.push((acc << (5 - bits)) & 31)
  const hrp = 'npub'.split('').map((c) => c.charCodeAt(0))
  const poly =
    bech32Polymod([
      ...hrp.map((c) => c >> 5),
      0,
      ...hrp.map((c) => c & 31),
      ...words,
      0,
      0,
      0,
      0,
      0,
      0,
    ]) ^ 1
  for (let i = 0; i < 6; i++) words.push((poly >> (5 * (5 - i))) & 31)
  return `npub1${words.map((w) => bech32Charset[w]).join('')}`
}

const hex32 = (bytes?: number[]) =>
  bytes?.length === 32 ? Buffer.from(bytes).toString('hex') : undefined

export function toHexPubkey(key: string) {
  const k = key.trim().toLowerCase()
  const hex = /^[0-9a-f]{64}$/.test(k) ? k : hex32(bech32Bytes(k, 'npub'))
  if (!hex)
    throw new Error(i18n('Not a valid npub or hex public key: ${key}', { key }))
  return hex
}

// nevent is a TLV list; type 0 holds the 32-byte event ID
const neventId = (bytes?: number[]) => {
  for (let i = 0; bytes && i + 1 < bytes.length; i += 2 + bytes[i + 1])
    if (bytes[i] === 0) return bytes.slice(i + 2, i + 2 + bytes[i + 1])
}

export function toHexEventId(id: string) {
  const k = id.trim().toLowerCase()
  const hex = /^[0-9a-f]{64}$/.test(k)
    ? k
    : hex32(bech32Bytes(k, 'note') ?? neventId(bech32Bytes(k, 'nevent')))
  if (!hex)
    throw new Error(
      i18n('Not a valid note, nevent or hex event ID: ${id}', { id }),
    )
  return hex
}

const writeAtomic = async (name: string, data: string, mode: number) => {
  await mkdir(etcDir, { recursive: true })
  await writeFile(`${etcDir}/.${name}.tmp`, data, { mode })
  await rename(`${etcDir}/.${name}.tmp`, `${etcDir}/${name}`)
}

const sellsAccess = (store: Pick<Store, 'payments' | 'writeMode'>) =>
  store.payments.backend !== 'off' && store.writeMode !== 'open'

const fees = ({ priceSats, periodDays }: Store['payments']) =>
  periodDays
    ? {
        subscription: [
          {
            amount: priceSats * 1000,
            unit: 'msats',
            period: periodDays * 86400,
          },
        ],
      }
    : { admission: [{ amount: priceSats * 1000, unit: 'msats' }] }

export const writeConfig = (
  store: Pick<Store, 'info' | 'writeMode' | 'acceptOldEvents' | 'payments'> & {
    blocking: boolean
  },
  relayUrl: string | null,
  signupUrl: string | null,
) =>
  writeAtomic(
    'strfry.conf',
    JSON.stringify(
      {
        db: '/data/',
        dbParams: {
          // the 10 TB upstream default exceeds the address space of Raspberry Pi kernels
          mapsize:
            process.arch === 'arm64' ? 274_877_906_944 : 10_995_116_277_760,
        },
        events: {
          rejectEventsOlderThanSeconds: store.acceptOldEvents
            ? twentyYears
            : threeYears,
        },
        relay: {
          bind: '0.0.0.0',
          port: relayPort,
          nofiles: 0,
          realIpHeader: 'x-forwarded-for',
          auth: { enabled: true, serviceUrl: relayUrl ?? '' },
          info: {
            ...store.info,
            restrictedWrites: store.writeMode !== 'open' ? 'true' : 'false',
            paymentsUrl: (sellsAccess(store) && signupUrl) || '',
            fees: sellsAccess(store)
              ? JSON.stringify(fees(store.payments))
              : '',
          },
          writePolicy: {
            plugin:
              store.writeMode === 'open' && !store.blocking ? '' : policyPath,
          },
        },
      },
      null,
      2,
    ),
    0o644,
  )

const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

export const writePolicy = async (
  store: Store,
  members: Members | null,
  signupUrl: string | null,
) => {
  const now = Date.now() / 1000
  const allow = {
    listed: Object.fromEntries(store.allowedPubkeys.map((k) => [k, true])),
    paid: Object.fromEntries(
      Object.entries(members ?? {})
        .filter(([, m]) => m.until === null || m.until > now)
        .map(([k, m]) => [k, m.until ?? true]),
    ),
  }
  const block = Object.fromEntries(store.blockedPubkeys.map((k) => [k, true]))
  const msg =
    sellsAccess(store) && signupUrl
      ? `restricted: pay for write access at ${signupUrl}`
      : 'blocked: this relay does not accept events from this pubkey'
  const allowed =
    store.writeMode === 'open'
      ? 'true'
      : `member($e.pubkey)${
          store.writeMode === 'inbox'
            ? ' or any($e.tags[]?; .[0] == "p" and ($allow[0].listed[.[1] | tostring] // false))'
            : ''
        }`
  const program = [
    'def member($k): ($allow[0].listed[$k] // $allow[0].paid[$k] // false) as $v | $v == true or (($v | type) == "number" and $v > now);',
    'select(.type == "new")',
    '| .event as $e',
    '| if (.sourceType | IN("IP4", "IP6") | not) then {id: $e.id, action: "accept"}',
    '  elif ($block[0][$e.pubkey] // false) then {id: $e.id, action: "reject", msg: "blocked: this pubkey may not publish to this relay"}',
    `  elif ${allowed} then {id: $e.id, action: "accept"}`,
    '  else {id: $e.id, action: "reject", msg: $msg}',
    '  end',
  ].join('\n')
  await writeAtomic('allowed.json', JSON.stringify(allow), 0o644)
  await writeAtomic('blocked.json', JSON.stringify(block), 0o644)
  // strfry restarts the plugin, which rereads both lists, when this file's mtime changes
  await writeAtomic(
    'write-policy',
    `#!/bin/sh\nexec jq -c --unbuffered --slurpfile allow ${etcMount}/allowed.json --slurpfile block ${etcMount}/blocked.json --arg msg ${shellQuote(msg)} ${shellQuote(`\n${program}\n`)}\n`,
    0o755,
  )
}

let policyWrites = Promise.resolve()

// the store and the sign-up state change independently, and both rewrite one file
export const refreshPolicy = (signupUrl: string | null) =>
  (policyWrites = policyWrites
    .catch(() => {})
    .then(async () => {
      const store = await storeJson.read().once()
      if (store)
        await writePolicy(
          store,
          await signupState.read((s) => s.members).once(),
          signupUrl,
        )
    }))

export const countEvents = async (sub: StrfrySub, filter = '{}') =>
  Number(
    String(
      (
        await sub.execFail(strfry('scan', '--count', filter), {
          timeout: null,
        })
      ).stdout,
    ).trim(),
  )
