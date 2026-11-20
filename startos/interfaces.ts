import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { sdk } from './sdk'
import { relayPort, signupPort } from './utils'

export const setInterfaces = sdk.setupInterfaces(async ({ effects }) => {
  const relayMultiOrigin = await sdk.MultiHost.of(
    effects,
    'relay-multi',
  ).bindPort(relayPort, { protocol: 'ws' })

  const relay = sdk.createInterface(effects, {
    name: i18n('Relay'),
    id: 'relay',
    description: i18n(
      'The websocket address Nostr clients connect to. Opened in a browser, it shows the relay information page.',
    ),
    type: 'api',
    masked: false,
    schemeOverride: null,
    username: null,
    path: '',
    query: {},
  })

  const receipts = [await relayMultiOrigin.export([relay])]

  const paid = await storeJson
    .read((s) => s.payments.backend !== 'off')
    .const(effects)
  if (paid) {
    const signupMultiOrigin = await sdk.MultiHost.of(
      effects,
      'signup-multi',
    ).bindPort(signupPort, { protocol: 'http' })
    const signup = sdk.createInterface(effects, {
      name: i18n('Sign-up Page'),
      id: 'signup',
      description: i18n(
        'The public page where people pay for write access to the relay. Give it a public domain so they can reach it.',
      ),
      type: 'ui',
      masked: false,
      schemeOverride: null,
      username: null,
      path: '',
      query: {},
    })
    receipts.push(await signupMultiOrigin.export([signup]))
  }

  return receipts
})
