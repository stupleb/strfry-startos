import type { SubContainer, T } from '@start9labs/start-sdk'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import type { Store } from './fileModels/store.json'
import { i18n } from './i18n'
import type { manifest } from './manifest'
import { sdk } from './sdk'

export const relayPort = 7777
export const appUid = 1000

const etcDir = `${sdk.volumes.startos.path}/etc`
const confPath = '/etc/strfry/strfry.conf'
const policyPath = '/etc/strfry/write-policy'

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
    mountpoint: '/etc/strfry',
    readonly: true,
  })

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

export const writeConfig = (
  store: Omit<Store, 'allowedPubkeys'>,
  relayUrl: string | null,
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
          info: store.info,
          writePolicy: {
            plugin: store.writeMode === 'open' ? '' : policyPath,
          },
        },
      },
      null,
      2,
    ),
    0o644,
  )

export const writePolicy = (store: Store) => {
  const allow = JSON.stringify(
    Object.fromEntries(store.allowedPubkeys.map((k) => [k, true])),
  )
  const inbox =
    store.writeMode === 'inbox'
      ? ' or any($e.tags[]?; .[0] == "p" and ($allow[.[1] | tostring] // false))'
      : ''
  const program = [
    'select(.type == "new")',
    '| .event as $e',
    `| if (.sourceType | IN("IP4", "IP6") | not) or ($allow[$e.pubkey] // false)${inbox}`,
    '  then {id: $e.id, action: "accept"}',
    '  else {id: $e.id, action: "reject", msg: "blocked: this relay does not accept events from this pubkey"}',
    '  end',
  ].join('\n')
  return writeAtomic(
    'write-policy',
    `#!/bin/sh\nexec jq -c --unbuffered --argjson allow '${allow}' '\n${program}\n'\n`,
    0o755,
  )
}

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
