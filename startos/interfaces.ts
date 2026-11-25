import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { sdk } from './sdk'
import { relayPort } from './utils'

export const setInterfaces = sdk.setupInterfaces(async ({ effects }) => {
  const paid = await storeJson
    .read((s) => s.payments.backend !== 'off')
    .const(effects)

  const relayMultiOrigin = await sdk.MultiHost.of(
    effects,
    'relay-multi',
  ).bindPort(relayPort, { protocol: 'ws' })

  const relay = sdk.createInterface(effects, {
    name: i18n('Relay'),
    id: 'relay',
    description: paid
      ? i18n(
          'The websocket address Nostr clients connect to. Opened in a browser, it shows the sign-up page, where people pay to publish.',
        )
      : i18n(
          'The websocket address Nostr clients connect to. Opened in a browser, it shows the relay information page.',
        ),
    type: 'api',
    masked: false,
    schemeOverride: null,
    username: null,
    path: '',
    query: {},
  })

  return [await relayMultiOrigin.export([relay])]
})
