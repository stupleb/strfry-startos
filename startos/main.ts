import { relayUrl } from './actions/relayUrl'
import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { sdk } from './sdk'
import {
  mounts,
  relay,
  relayPort,
  strfry,
  writeConfig,
  writePolicy,
} from './utils'

export const main = sdk.setupMain(async ({ effects }) => {
  console.info(i18n('Starting strfry!'))

  const store = await storeJson
    .read(({ allowedPubkeys, ...rest }) => rest)
    .const(effects)
  if (!store) throw new Error(i18n('store.json is missing'))

  await writeConfig(store, await relayUrl.bestUsable(effects).const())

  storeJson.read().onChange(effects, async (s) => {
    if (s) await writePolicy(s)
    return { cancel: false }
  })

  const subcontainer = sdk.SubContainer.of(
    effects,
    { imageId: 'strfry' },
    mounts,
    'strfry-sub',
  )
  relay.sub = subcontainer
  effects.onLeaveContext(() => {
    if (relay.sub === subcontainer) relay.sub = undefined
  })

  return sdk.Daemons.of(effects).addDaemon('primary', {
    subcontainer,
    exec: {
      command: [
        'sh',
        '-c',
        `ulimit -n "$(ulimit -Hn)" && exec ${strfry('relay').join(' ')}`,
      ],
    },
    ready: {
      display: i18n('Relay'),
      fn: () =>
        sdk.healthCheck.checkPortListening(effects, relayPort, {
          successMessage: i18n('The relay is accepting connections'),
          errorMessage: i18n('The relay is not accepting connections'),
        }),
    },
    requires: [],
  })
})
