import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'

export const signupUrl = sdk.setupPrimaryUrl({
  id: 'set-signup-url',
  hostId: 'signup-multi',
  interfaceId: 'signup',
  metadata: async ({ effects }) => ({
    name: i18n('Set Sign-up URL'),
    description: i18n(
      'Choose the address of the sign-up page that the relay advertises to clients and names when it turns away a public key that has not paid. strfry restarts to apply the change.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: i18n('Paid Access'),
    visibility: (await storeJson
      .read((s) => s.payments.backend !== 'off')
      .const(effects))
      ? 'enabled'
      : 'hidden',
  }),
  field: { name: i18n('Sign-up URL'), description: null },
  get: storeJson.read((s) => s.signupUrl),
  set: (effects, url) => storeJson.merge(effects, { signupUrl: url }),
})
