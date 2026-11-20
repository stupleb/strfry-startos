import { i18n } from '../i18n'
import { sdk } from '../sdk'
import {
  countEvents,
  keyPattern,
  withStrfry,
  relayUrlPattern,
  strfry,
  toHexPubkey,
} from '../utils'

const { InputSpec, Value } = sdk

const pageSize = 500
const maxPages = 1000

export const inputSpec = InputSpec.of({
  url: Value.text({
    name: i18n('Relay URL'),
    description: i18n('The relay to fetch events from. Any Nostr relay works.'),
    required: true,
    default: null,
    placeholder: 'wss://',
    patterns: [relayUrlPattern],
  }),
  pubkey: Value.text({
    name: i18n('Public Key'),
    description: i18n('The Nostr public key whose events to import'),
    required: true,
    default: null,
    placeholder: 'npub1…',
    patterns: [keyPattern],
  }),
  mentions: Value.toggle({
    name: i18n('Include mentions'),
    description: i18n(
      "Also import other people's events that tag this public key, such as replies, reactions, direct messages and zaps it sent or received",
    ),
    default: false,
  }),
})

// strfry import aborts the whole run at a line longer than maxEventSize, newline included
const maxLineBytes = 65_535

type Downloaded = { id: string; createdAt: number; line: string }

const lastLines = (output: string | Buffer) =>
  String(output).trim().split('\n').slice(-3).join('\n')

const parseEvents = (stdout: string | Buffer) =>
  String(stdout)
    .split('\n')
    .flatMap((line): Downloaded[] => {
      try {
        const e = JSON.parse(line)
        return typeof e?.id === 'string' && typeof e.created_at === 'number'
          ? [{ id: e.id, createdAt: e.created_at, line }]
          : []
      } catch {
        return []
      }
    })

export const importPubkey = sdk.Action.withInput(
  // id
  'import-pubkey',

  // metadata
  async ({ effects }) => ({
    name: i18n('Import from Public Key'),
    description: i18n(
      "Fetch one public key's events from another relay and store them here, whether or not that key may publish here. Events already stored are skipped.",
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
    const pubkey = toHexPubkey(input.pubkey)
    const filters = [
      { authors: [pubkey] },
      ...(input.mentions
        ? [{ '#p': [pubkey] }, { kinds: [9735], '#P': [pubkey] }]
        : []),
    ]
    const { fetched, skipped, added, total } = await withStrfry(
      effects,
      'import-pubkey',
      async (sub) => {
        const events = new Map<string, Downloaded>()
        for (const filter of filters) {
          let until: number | undefined
          for (let page = 0; page < maxPages; page++) {
            const res = await sub.exec(
              strfry(
                'download',
                input.url,
                `--filter=${JSON.stringify({ ...filter, limit: pageSize, until })}`,
              ),
              { timeout: 120_000 },
            )
            const batch = parseEvents(res.stdout)
            if (!batch.length) {
              if (res.exitCode !== 0 && !events.size)
                throw new Error(
                  i18n('Could not fetch events: ${error}', {
                    error: lastLines(res.stderr),
                  }),
                )
              break
            }
            const fresh = batch.filter((e) => !events.has(e.id))
            fresh.forEach((e) => events.set(e.id, e))
            const oldest = Math.min(...batch.map((e) => e.createdAt))
            until = fresh.length ? oldest : oldest - 1
          }
        }
        const lines = [...events.values()].map((e) => e.line)
        const fitting = lines.filter(
          (l) => Buffer.byteLength(l) <= maxLineBytes,
        )
        const before = await countEvents(sub)
        if (fitting.length) {
          const file = `/tmp/import-${pubkey}-${Date.now()}.jsonl`
          await sub.writeFile(file, fitting.join('\n') + '\n')
          const res = await sub
            .exec(
              ['sh', '-c', `exec ${strfry('import').join(' ')} < ${file}`],
              {
                timeout: null,
              },
            )
            .finally(() => sub.exec(['rm', '-f', file], { user: 'root' }))
          if (res.exitCode !== 0)
            throw new Error(
              i18n('Import failed: ${error}', { error: lastLines(res.stderr) }),
            )
        }
        const after = await countEvents(sub)
        return {
          fetched: events.size,
          skipped: lines.length - fitting.length,
          added: after - before,
          total: after,
        }
      },
    )
    return {
      version: '1',
      title: i18n('Import from Public Key'),
      message: [
        i18n(
          'Events fetched: ${fetched}. New events stored: ${added}. Events on the relay: ${total}.',
          { fetched, added, total },
        ),
        ...(skipped
          ? [
              i18n('Skipped as larger than the relay accepts: ${skipped}.', {
                skipped,
              }),
            ]
          : []),
      ].join(' '),
      result: null,
    }
  },
)
