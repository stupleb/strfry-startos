import { chown } from 'node:fs/promises'
import { relayUrl } from '../actions/relayUrl'
import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { appUid, writeConfig, writePolicy } from '../utils'

export const seedFiles = sdk.setupOnInit(async (effects) => {
  await storeJson.merge(effects, {})
  const store = await storeJson.read().once()
  if (!store) throw new Error(i18n('store.json is missing'))
  await writeConfig(store, await relayUrl.bestUsable(effects).once())
  await writePolicy(store)
  await chown(sdk.volumes.main.path, appUid, appUid)
})
