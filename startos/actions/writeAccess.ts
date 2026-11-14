import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { keyPattern, toHexPubkey } from '../utils'

const { InputSpec, Value, List } = sdk

export const inputSpec = InputSpec.of({
  writeMode: Value.select({
    name: i18n('Who can publish'),
    description: i18n(
      'Anyone can always read what the relay stores. This only decides whose events it stores.',
    ),
    default: 'whitelist',
    values: {
      whitelist: i18n('Only the public keys below'),
      inbox: i18n('The public keys below, and anyone tagging them'),
      open: i18n('Anyone'),
    },
  }),
  allowedPubkeys: Value.list(
    List.text(
      {
        name: i18n('Public Keys'),
        description: i18n('The Nostr public keys allowed to publish'),
      },
      { placeholder: 'npub1…', patterns: [keyPattern] },
    ),
  ),
  acceptOldEvents: Value.toggle({
    name: i18n('Accept old events'),
    description: i18n(
      'Store events up to 20 years old. Off, the relay rejects events more than 3 years old, which also turns away old notes a client republishes.',
    ),
    default: false,
  }),
})

export const writeAccess = sdk.Action.withInput(
  // id
  'write-access',

  // metadata
  async ({ effects }) => ({
    name: i18n('Write Access'),
    description: i18n(
      'Choose who can publish events to this relay. Changes to the list apply at once; changing the mode or the age limit restarts strfry.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  // input spec
  inputSpec,

  // pre-fill
  async ({ effects }) =>
    storeJson
      .read(({ writeMode, allowedPubkeys, acceptOldEvents }) => ({
        writeMode,
        allowedPubkeys,
        acceptOldEvents,
      }))
      .once(),

  // execution
  async ({ effects, input }) =>
    storeJson.merge(effects, {
      writeMode: input.writeMode,
      allowedPubkeys: [...new Set(input.allowedPubkeys.map(toHexPubkey))],
      acceptOldEvents: input.acceptOldEvents,
    }),
)
