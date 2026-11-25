import { FileHelper, z } from '@start9labs/start-sdk'
import { sdk } from '../sdk'

const hexKey = z.string().regex(/^[0-9a-f]{64}$/)

const info = z.looseObject({
  name: z.string().catch('strfry default'),
  description: z.string().catch('This is a strfry instance.'),
  pubkey: z.string().catch(''),
  contact: z.string().catch(''),
  icon: z.string().catch(''),
  banner: z.string().catch(''),
  privacy: z.string().catch(''),
  terms: z.string().catch(''),
})

const payments = z.looseObject({
  backend: z.enum(['off', 'lnbits', 'btcpay']).catch('off'),
  // empty: the LNbits or BTCPay Server installed on this server
  url: z.string().catch(''),
  rootCa: z.string().catch(''),
  lnbitsKey: z.string().catch(''),
  btcpayStoreId: z.string().catch(''),
  btcpayKey: z.string().catch(''),
  priceSats: z.number().int().positive().catch(21000),
  // 0: a payment buys access that never expires
  periodDays: z.number().int().nonnegative().catch(365),
})

const shape = z.looseObject({
  relayUrl: z.string().optional().catch(undefined),
  info: info.catch(() => info.parse({})),
  writeMode: z.enum(['open', 'whitelist', 'inbox']).catch('whitelist'),
  allowedPubkeys: z.array(hexKey).catch([]),
  blockedPubkeys: z.array(hexKey).catch([]),
  acceptOldEvents: z.boolean().catch(false),
  payments: payments.catch(() => payments.parse({})),
})

export type Store = z.infer<typeof shape>

export const storeJson = FileHelper.json(
  { base: sdk.volumes.startos, subpath: 'store.json' },
  shape,
)
