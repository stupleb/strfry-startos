import { chown, mkdir } from 'node:fs/promises'
import { relayUrl } from '../actions/relayUrl'
import { signupUrl } from '../actions/signupUrl'
import { signupState } from '../fileModels/signupState.json'
import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { appUid, signupDir, writeConfig, writePolicy } from '../utils'

export const seedFiles = sdk.setupOnInit(async (effects) => {
  await storeJson.merge(effects, {})
  const store = await storeJson.read().once()
  if (!store) throw new Error(i18n('store.json is missing'))
  const signupAddress =
    store.payments.backend === 'off'
      ? null
      : await signupUrl.bestUsable(effects).once()
  await writeConfig(
    { ...store, blocking: store.blockedPubkeys.length > 0 },
    await relayUrl.bestUsable(effects).once(),
    signupAddress,
  )
  await writePolicy(
    store,
    await signupState.read((s) => s.members).once(),
    signupAddress,
  )
  await chown(sdk.volumes.main.path, appUid, appUid)
  await mkdir(signupDir, { recursive: true })
  await chown(signupDir, appUid, appUid)
})
