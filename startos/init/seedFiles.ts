import { chown, mkdir } from 'node:fs/promises'
import { relayUrl } from '../actions/relayUrl'
import { signupState } from '../fileModels/signupState.json'
import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { appUid, signupDir, writeConfig, writePolicy } from '../utils'

export const seedFiles = sdk.setupOnInit(async (effects) => {
  await storeJson.merge(effects, {})
  const store = await storeJson.read().once()
  if (!store) throw new Error(i18n('store.json is missing'))
  const relayAddress = await relayUrl.bestUsable(effects).once()
  await writeConfig(
    { ...store, blocking: store.blockedPubkeys.length > 0 },
    relayAddress,
  )
  await writePolicy(
    store,
    await signupState.read((s) => s.members).once(),
    relayAddress,
  )
  await chown(sdk.volumes.main.path, appUid, appUid)
  await mkdir(signupDir, { recursive: true })
  await chown(signupDir, appUid, appUid)
})
