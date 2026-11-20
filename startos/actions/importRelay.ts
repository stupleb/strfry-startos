import { createInterface } from 'node:readline'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import {
  acceptOldEventsArg,
  countEvents,
  withStrfry,
  relayUrlPattern,
  strfry,
} from '../utils'

const { InputSpec, Value } = sdk

const syncTimeoutMinutes = 60
const idleMinutes = 3

export const inputSpec = InputSpec.of({
  url: Value.text({
    name: i18n('Relay URL'),
    description: i18n(
      'The relay to copy events from. It must support negentropy sync, as other strfry relays do.',
    ),
    required: true,
    default: null,
    placeholder: 'wss://',
    patterns: [relayUrlPattern],
  }),
  filter: Value.textarea({
    name: i18n('Filter'),
    description: i18n(
      'Optional. A Nostr filter in JSON that limits which events are copied, such as {"kinds":[0,1,3]}. Left empty, every event is copied.',
    ),
    required: false,
    default: null,
  }),
})

export const importRelay = sdk.Action.withInput(
  // id
  'import-relay',

  // metadata
  async ({ effects }) => ({
    name: i18n('Import from Relay'),
    description: i18n(
      'Copy the events another relay has and this one lacks, using negentropy sync. Events already stored are not transferred again, so a repeat run only fetches what is new.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: i18n('Events'),
    visibility: 'enabled',
  }),

  // input spec
  inputSpec,

  // pre-fill
  async ({ effects }) => null,

  // execution
  async ({ effects, input }) => {
    if (input.filter) {
      try {
        JSON.parse(input.filter)
      } catch {
        throw new Error(i18n('The filter is not valid JSON'))
      }
    }
    const { added, total, stopped } = await withStrfry(
      effects,
      'import-relay',
      async (sub) => {
        const before = await countEvents(sub)
        const child = await sub.spawn(
          strfry(
            acceptOldEventsArg,
            'sync',
            input.url,
            '--dir=down',
            ...(input.filter ? [`--filter=${input.filter}`] : []),
          ),
          { stdio: 'pipe' },
        )
        child.stdin?.end()
        child.stdout?.resume()
        const exited = new Promise<number | null>((resolve) =>
          child.on('exit', resolve),
        )
        const tail: string[] = []
        let notice: string | undefined
        let stopped: 'stalled' | 'timeout' | undefined
        const stop = (reason: typeof stopped) => {
          stopped ??= reason
          child.kill('SIGKILL')
        }
        let idle = setTimeout(() => stop('stalled'), idleMinutes * 60_000)
        const overall = setTimeout(
          () => stop('timeout'),
          syncTimeoutMinutes * 60_000,
        )
        createInterface({ input: child.stderr! }).on('line', (line) => {
          tail.push(line.replace(/^.*?\| /, ''))
          if (tail.length > 3) tail.shift()
          clearTimeout(idle)
          idle = setTimeout(() => stop('stalled'), idleMinutes * 60_000)
          const m = /Unexpected message from relay: (\["NOTICE".*)$/.exec(line)
          if (m) {
            notice = m[1]
            child.kill('SIGKILL')
          }
        })
        const code = await exited
        clearTimeout(idle)
        clearTimeout(overall)
        if (notice)
          throw new Error(
            i18n(
              'The relay refused the sync: ${notice}. It may not support negentropy sync; Import from Public Key works with any relay.',
              { notice },
            ),
          )
        if (code !== 0 && !stopped)
          throw new Error(
            i18n('Sync failed: ${error}', { error: tail.join('\n') }),
          )
        const after = await countEvents(sub)
        return { added: after - before, total: after, stopped }
      },
    )
    return {
      version: '1',
      title: i18n('Import from Relay'),
      message: [
        ...(stopped === 'timeout'
          ? [
              i18n(
                'The sync stopped after ${minutes} minutes. Run it again to continue.',
                { minutes: syncTimeoutMinutes },
              ),
            ]
          : stopped === 'stalled'
            ? [
                i18n(
                  'The other relay stopped responding, so the sync was stopped.',
                ),
              ]
            : []),
        i18n('New events copied: ${added}. Events on the relay: ${total}.', {
          added,
          total,
        }),
      ].join(' '),
      result: null,
    }
  },
)
