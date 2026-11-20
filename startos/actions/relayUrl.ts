import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'

export const relayUrl = sdk.setupPrimaryUrl({
  id: 'set-relay-url',
  hostId: 'relay-multi',
  interfaceId: 'relay',
  metadata: {
    name: i18n('Set Relay URL'),
    description: i18n(
      'Choose the address clients use for this relay. NIP-42 authentication only succeeds for clients connected through this address. strfry restarts to apply the change.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: i18n('Relay'),
    visibility: 'enabled',
  },
  field: { name: i18n('Relay URL'), description: null },
  get: storeJson.read((s) => s.relayUrl),
  set: (effects, url) => storeJson.merge(effects, { relayUrl: url }),
})
