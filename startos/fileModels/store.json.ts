import { FileHelper, z } from '@start9labs/start-sdk'
import { sdk } from '../sdk'

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

const shape = z.looseObject({
  relayUrl: z.string().optional().catch(undefined),
  info: info.catch(() => info.parse({})),
  writeMode: z.enum(['open', 'whitelist', 'inbox']).catch('whitelist'),
  allowedPubkeys: z.array(z.string().regex(/^[0-9a-f]{64}$/)).catch([]),
  acceptOldEvents: z.boolean().catch(false),
})

export type Store = z.infer<typeof shape>

export const storeJson = FileHelper.json(
  { base: sdk.volumes.startos, subpath: 'store.json' },
  shape,
)
