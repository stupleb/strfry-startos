import { i18n } from '../i18n'
import { sdk } from '../sdk'
import {
  countEvents,
  keyPattern,
  withStrfry,
  strfry,
  toHexEventId,
  toHexPubkey,
} from '../utils'

const { InputSpec, Value, List } = sdk

export const inputSpec = InputSpec.of({
  pubkeys: Value.list(
    List.text(
      {
        name: i18n('Public Keys'),
        description: i18n('Delete every event published by these public keys'),
      },
      { placeholder: 'npub1…', patterns: [keyPattern] },
    ),
  ),
  eventIds: Value.list(
    List.text(
      {
        name: i18n('Event IDs'),
        description: i18n('Delete these events, by note1, nevent1 or hex ID'),
      },
      {
        placeholder: 'note1…',
        patterns: [
          {
            regex:
              '^(note1[02-9ac-hj-np-z]{58}|nevent1[02-9ac-hj-np-z]+|[0-9a-fA-F]{64})$',
            description: i18n(
              'Enter a note1…, nevent1… or 64-character hex event ID',
            ),
          },
        ],
      },
    ),
  ),
  preview: Value.toggle({
    name: i18n('Preview only'),
    description: i18n(
      'Count the matching events without deleting them. Turn this off to delete.',
    ),
    default: true,
  }),
})

export const deleteEvents = sdk.Action.withInput(
  // id
  'delete-events',

  // metadata
  async ({ effects }) => ({
    name: i18n('Delete Events'),
    description: i18n(
      'Remove stored events by public key or event ID. Deleted events come back if they are published or imported again, unless Write Access turns their author away.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  // input spec
  inputSpec,

  // pre-fill
  async ({ effects }) => null,

  // execution
  async ({ effects, input }) => {
    const authors = [...new Set(input.pubkeys.map(toHexPubkey))]
    const ids = [...new Set(input.eventIds.map(toHexEventId))]
    if (!authors.length && !ids.length)
      throw new Error(i18n('Enter at least one public key or event ID'))

    const matched = await withStrfry(effects, 'delete-events', async (sub) => {
      const otherIds = ids.length
        ? String(
            (
              await sub.execFail(strfry('scan', JSON.stringify({ ids })), {
                timeout: null,
              })
            ).stdout,
          )
            .split('\n')
            .filter(Boolean)
            .map((line): { id: string; pubkey: string } => JSON.parse(line))
            .filter((e) => !authors.includes(e.pubkey))
            .map((e) => e.id)
        : []
      const filters = [
        ...(authors.length ? [{ authors }] : []),
        ...(otherIds.length ? [{ ids: otherIds }] : []),
      ].map((f) => JSON.stringify(f))
      let count = 0
      for (const filter of filters) {
        count += await countEvents(sub, filter)
        if (!input.preview)
          await sub.execFail(strfry('delete', `--filter=${filter}`), {
            timeout: null,
          })
      }
      return count
    })
    return {
      version: '1',
      title: i18n('Delete Events'),
      message: input.preview
        ? i18n('Matching events: ${count}. Nothing was deleted.', {
            count: matched,
          })
        : i18n('Events deleted: ${count}.', { count: matched }),
      result: null,
    }
  },
)
