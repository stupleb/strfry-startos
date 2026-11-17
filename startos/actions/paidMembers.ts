import { signupState } from '../fileModels/signupState.json'
import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { day, toNpub } from '../utils'

export const paidMembers = sdk.Action.withoutInput(
  // id
  'paid-members',

  // metadata
  async ({ effects }) => ({
    name: i18n('Paid Members'),
    description: i18n(
      'List the public keys that paid for write access, and when their access runs out. Change one with Edit Paid Member.',
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

  // execution
  async ({ effects }) => {
    const members = Object.entries(
      (await signupState.read((s) => s.members).once()) ?? {},
    ).sort(([, a], [, b]) => b.since - a.since)
    const blocked = new Set(
      (await storeJson.read((s) => s.blockedPubkeys).once()) ?? [],
    )
    const now = Date.now() / 1000
    return {
      version: '1' as const,
      title: i18n('Paid Members'),
      message: members.length
        ? i18n('Members: ${count}. Newest first.', {
            count: String(members.length),
          })
        : i18n('Nobody has paid yet.'),
      result: members.length
        ? {
            type: 'group' as const,
            value: members.map(([pubkey, m]) => ({
              type: 'single' as const,
              name: blocked.has(pubkey)
                ? i18n('Blocked')
                : m.until === null
                  ? i18n('Permanent')
                  : m.until > now
                    ? i18n('Until ${date}', { date: day(m.until) })
                    : i18n('Expired ${date}', { date: day(m.until) }),
              description: null,
              value: toNpub(pubkey),
              copyable: true,
              qr: false,
              masked: false,
              launchable: false,
            })),
          }
        : null,
    }
  },
)
