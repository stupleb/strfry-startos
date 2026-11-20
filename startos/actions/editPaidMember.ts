import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { keyPattern, signupAdminPort, toHexPubkey, toNpub } from '../utils'

const { InputSpec, Value, Variants } = sdk

export const inputSpec = InputSpec.of({
  pubkey: Value.text({
    name: i18n('Public Key'),
    description: i18n(
      "The public key to change, as an npub or hex key. A paid member's is in Paid Members.",
    ),
    required: true,
    default: null,
    placeholder: 'npub1…',
    patterns: [keyPattern],
  }),
  change: Value.union({
    name: i18n('Change'),
    description: i18n(
      'Remove takes away its paid access, and it can pay again. Ban also adds it to Blocked Public Keys in Write Access, so it can neither publish nor pay.',
    ),
    default: 'until',
    variants: Variants.of({
      until: {
        name: i18n('Set expiry date'),
        spec: InputSpec.of({
          date: Value.datetime({
            name: i18n('Expires'),
            description: i18n('Write access ends at the end of this day, UTC'),
            required: true,
            default: null,
            inputmode: 'date',
          }),
        }),
      },
      permanent: { name: i18n('Make permanent'), spec: InputSpec.of({}) },
      remove: { name: i18n('Remove'), spec: InputSpec.of({}) },
      ban: { name: i18n('Ban'), spec: InputSpec.of({}) },
    }),
  }),
})

export const editPaidMember = sdk.Action.withInput(
  // id
  'edit-paid-member',

  // metadata
  async ({ effects }) => ({
    name: i18n('Edit Paid Member'),
    description: i18n(
      "Set a public key's paid access by hand: give it an expiry date or permanent access, which adds a key that hasn't paid, or remove or ban it.",
    ),
    warning: null,
    allowedStatuses: 'only-running',
    group: i18n('Paid Access'),
    visibility: (await storeJson
      .read((s) => s.payments.backend !== 'off')
      .const(effects))
      ? 'enabled'
      : 'hidden',
  }),

  // input spec
  inputSpec,

  // pre-fill
  async ({ effects }) => null,

  // execution
  async ({ effects, input }) => {
    const pubkey = toHexPubkey(input.pubkey)
    const npub = toNpub(pubkey)
    const { selection, value } = input.change

    const member = async (method: 'PUT' | 'DELETE', until?: number | null) => {
      const res = await fetch(
        `http://127.0.0.1:${signupAdminPort}/member/${pubkey}`,
        {
          method,
          body: method === 'PUT' ? JSON.stringify({ until }) : undefined,
          signal: AbortSignal.timeout(10_000),
        },
      ).catch(() => null)
      if (!res)
        throw new Error(
          i18n(
            'The sign-up service is not responding. Check that strfry is running and try again.',
          ),
        )
      if (res.status === 404 && selection !== 'ban')
        throw new Error(i18n('This public key is not a paid member'))
      if (!res.ok && res.status !== 404)
        throw new Error(
          i18n('Could not change the member: ${error}', {
            error:
              (await res.json().catch(() => null))?.error ?? res.statusText,
          }),
        )
    }

    let message: string
    if (selection === 'until') {
      const until = Date.parse(`${value.date}T23:59:59Z`) / 1000
      if (Number.isNaN(until))
        throw new Error(i18n('Not a valid date: ${date}', { date: value.date }))
      await member('PUT', until)
      message = i18n(
        'Write access for ${npub} is set to run out at the end of ${date}, UTC.',
        { npub, date: value.date },
      )
    } else if (selection === 'permanent') {
      await member('PUT', null)
      message = i18n('${npub} now has permanent write access.', { npub })
    } else {
      await member('DELETE')
      if (selection === 'ban') {
        const blocked =
          (await storeJson.read((s) => s.blockedPubkeys).once()) ?? []
        await storeJson.merge(effects, {
          blockedPubkeys: [...new Set([...blocked, pubkey])],
        })
        message = i18n(
          '${npub} is now in Blocked Public Keys, so it can neither publish nor pay. What it already published stays until you remove it with Delete Events.',
          { npub },
        )
      } else
        message = i18n(
          '${npub} is no longer a paid member, and can pay again on the sign-up page.',
          { npub },
        )
    }

    return {
      version: '1' as const,
      title: i18n('Edit Paid Member'),
      message,
      result: null,
    }
  },
)
