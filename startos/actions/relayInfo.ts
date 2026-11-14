import { utils } from '@start9labs/start-sdk'
import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { keyPattern, toHexPubkey } from '../utils'

const { InputSpec, Value } = sdk

const urlField = (name: string, description: string) =>
  Value.text({
    name,
    description,
    required: false,
    default: null,
    placeholder: 'https://',
    patterns: [
      {
        regex: utils.Patterns.url.regex,
        description: i18n(
          'Enter a full web address, such as https://example.com/image.png',
        ),
      },
    ],
  })

export const inputSpec = InputSpec.of({
  name: Value.text({
    name: i18n('Name'),
    description: i18n('A short name for the relay, under 30 characters'),
    required: true,
    default: null,
    maxLength: 30,
  }),
  description: Value.textarea({
    name: i18n('Description'),
    description: i18n('What the relay is for and who may use it'),
    required: false,
    default: null,
  }),
  pubkey: Value.text({
    name: i18n('Admin Public Key'),
    description: i18n("The Nostr public key of the relay's administrator"),
    required: false,
    default: null,
    placeholder: 'npub1…',
    patterns: [keyPattern],
  }),
  contact: Value.text({
    name: i18n('Contact'),
    description: i18n(
      'Another way to reach the administrator, such as mailto:you@example.com or a web address',
    ),
    required: false,
    default: null,
  }),
  icon: urlField(
    i18n('Icon URL'),
    i18n('An image clients show as the relay icon'),
  ),
  banner: urlField(
    i18n('Banner URL'),
    i18n('An image clients show as the relay banner'),
  ),
  privacy: urlField(
    i18n('Privacy Policy URL'),
    i18n("A link to the relay's privacy policy"),
  ),
  terms: urlField(
    i18n('Terms of Service URL'),
    i18n("A link to the relay's terms of service"),
  ),
})

export const relayInfo = sdk.Action.withInput(
  // id
  'relay-info',

  // metadata
  async ({ effects }) => ({
    name: i18n('Relay Info'),
    description: i18n(
      'Set the name, description and contact details Nostr clients show for this relay (NIP-11). strfry restarts to apply them.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  // input spec
  inputSpec,

  // pre-fill
  async ({ effects }) => {
    const info = await storeJson.read((s) => s.info).once()
    return (
      info &&
      Object.fromEntries(
        Object.entries(info).map(([k, v]) => [k, v === '' ? null : v]),
      )
    )
  },

  // execution
  async ({ effects, input }) =>
    storeJson.merge(effects, {
      info: {
        name: input.name,
        description: input.description ?? '',
        pubkey: input.pubkey ? toHexPubkey(input.pubkey) : '',
        contact: input.contact ?? '',
        icon: input.icon ?? '',
        banner: input.banner ?? '',
        privacy: input.privacy ?? '',
        terms: input.terms ?? '',
      },
    }),
)
