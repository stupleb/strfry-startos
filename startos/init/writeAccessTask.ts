import { writeAccess } from '../actions/writeAccess'
import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'

export const writeAccessTask = sdk.setupOnInit(async (effects) => {
  const nobodyCanWrite = await storeJson
    .read((s) => s.writeMode !== 'open' && !s.allowedPubkeys.length)
    .const(effects)

  if (nobodyCanWrite) {
    await sdk.action.createOwnTask(effects, writeAccess, 'important', {
      reason: i18n('Add the public keys allowed to publish to this relay'),
    })
  } else {
    await sdk.action.clearTask(effects, 'strfry:write-access')
  }
})
