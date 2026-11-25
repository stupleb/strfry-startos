import { T } from '@start9labs/start-sdk'
import { X509Certificate } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import { rootCertificates } from 'node:tls'
import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { backendHosts } from '../utils'

const { InputSpec, Value, Variants } = sdk

const backendNames = { lnbits: 'LNbits', btcpay: 'BTCPay Server' } as const
type Backend = keyof typeof backendNames

const server = (backend: Backend) =>
  Value.union({
    name: i18n('Where ${name} Runs', { name: backendNames[backend] }),
    description: null,
    default: 'local',
    variants: Variants.of({
      local: { name: i18n('This server'), spec: InputSpec.of({}) },
      remote: {
        name: i18n('Another server'),
        spec: InputSpec.of({
          address: Value.text({
            name: i18n('Address'),
            description: i18n(
              "The address strfry reaches ${name} at. For ${name} on another StartOS, copy its HTTPS LAN address and replace the .local name with that server's IP address, and give that server a fixed IP address in your router. An http:// address sends the key unencrypted.",
              { name: backendNames[backend] },
            ),
            required: true,
            default: null,
            placeholder: 'https://192.168.1.50:49193',
            inputmode: 'url',
          }),
          rootCa: Value.textarea({
            name: i18n('Root CA'),
            description: i18n(
              "Only for an https:// address whose certificate isn't public, such as ${name} on another StartOS reached at its LAN address. Paste the certificate of the authority that issued it, including the BEGIN and END lines. For another StartOS, that is the Root CA from About this server on that server: open the downloaded file in a text editor and copy all of it. Leave empty for an address with a public certificate.",
              { name: backendNames[backend] },
            ),
            required: false,
            default: null,
            placeholder: '-----BEGIN CERTIFICATE-----',
          }),
        }),
      },
    }),
  })

const periods = { '30': 30, '90': 90, '365': 365, permanent: 0 } as const

export const inputSpec = InputSpec.of({
  payments: Value.union({
    name: i18n('Payments'),
    description: i18n(
      'Where payments go: one LNbits wallet, or one BTCPay Server store. Off stops selling access and takes the sign-up page down; members who already paid keep their access until it runs out.',
    ),
    default: 'off',
    variants: Variants.of({
      off: { name: i18n('Off'), spec: InputSpec.of({}) },
      lnbits: {
        name: 'LNbits',
        spec: InputSpec.of({
          server: server('lnbits'),
          invoiceKey: Value.text({
            name: i18n('Invoice/Read Key of Destination Wallet'),
            description: i18n(
              "Find it in that wallet's API info. Each payment is credited to this wallet, in the LNbits account that owns it, so pick or create the wallet first. The key can create invoices but not spend; an Admin key is refused.",
            ),
            required: true,
            default: null,
            masked: true,
          }),
        }),
      },
      btcpay: {
        name: 'BTCPay Server',
        spec: InputSpec.of({
          server: server('btcpay'),
          storeId: Value.text({
            name: i18n('Store ID'),
            description: i18n(
              "The ID of the store that receives payments, from the store's General settings",
            ),
            required: true,
            default: null,
          }),
          apiKey: Value.text({
            name: i18n('API Key'),
            description: i18n(
              'An API key from Account > API Keys with only "Create an invoice" and "View invoices", each limited to this store with "Select specific stores", not the similarly named permissions for the internal lightning node. A key with any other permission, or for all stores, is refused.',
            ),
            required: true,
            default: null,
            masked: true,
          }),
        }),
      },
    }),
  }),
  priceSats: Value.number({
    name: i18n('Price'),
    description: i18n('What one payment costs'),
    required: true,
    default: 21000,
    integer: true,
    min: 1,
    units: 'sats',
  }),
  period: Value.select({
    name: i18n('Access per Payment'),
    description: i18n(
      'How long one payment lets a public key publish. A payment made before access runs out adds to it.',
    ),
    default: '365',
    values: {
      '30': i18n('30 days'),
      '90': i18n('90 days'),
      '365': i18n('1 year'),
      permanent: i18n('Permanent'),
    },
  }),
})

function parseAddress(address: string) {
  let url: URL | null = null
  try {
    url = new URL(address.trim())
  } catch {}
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:'))
    throw new Error(
      i18n('Enter the full address, starting with https:// or http://'),
    )
  if (url.hostname.replace(/\.$/, '').endsWith('.local'))
    throw new Error(
      i18n(
        ".local names don't work from inside StartOS services. Use the server's IP address instead",
      ),
    )
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
}

function parseRootCa(pasted: string) {
  const body =
    pasted.match(
      /-----BEGIN CERTIFICATE-----([^-]*)-----END CERTIFICATE-----/,
    )?.[1] ?? ''
  let cert: X509Certificate
  try {
    // pasting can lose PEM's line breaks, which Node needs
    cert = new X509Certificate(
      `-----BEGIN CERTIFICATE-----\n${body.replace(/\s+/g, '').replace(/.{1,64}/g, '$&\n')}-----END CERTIFICATE-----`,
    )
  } catch {
    throw new Error(
      i18n(
        'That is not a certificate. Paste all of it, including the BEGIN and END lines',
      ),
    )
  }
  if (!cert.ca)
    throw new Error(
      i18n(
        "That certificate is not a certificate authority. Paste the server's Root CA",
      ),
    )
  return cert.toString()
}

const request = (
  url: string,
  headers: Record<string, string>,
  ca: string | null,
  method = 'GET',
  body?: string,
) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = (url.startsWith('https:') ? https : http).request(
      url,
      {
        method,
        headers: { Accept: 'application/json', ...headers },
        ...(ca ? { ca: [...rootCertificates, ca] } : {}),
        timeout: 15_000,
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          text += chunk
          if (text.length > 1 << 20)
            req.destroy(new Error('response too large'))
        })
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: text }),
        )
      },
    )
    req.on('timeout', () => req.destroy(new Error('timed out')))
    req.on('error', reject)
    req.end(body)
  }).catch((e) => {
    console.warn(`Paid Access check of ${url} failed: ${e.code ?? e}`)
    throw new Error(
      /CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)/.test(String(e.code))
        ? i18n(
            "strfry doesn't trust that server's certificate. Paste its Root CA, which for another StartOS is under About this server on that server",
          )
        : i18n(
            'Nothing answered at that address. Check it, and that the service is running there',
          ),
    )
  })

async function checkLnbits(base: string, key: string, ca: string | null) {
  const headers = { 'X-Api-Key': key }
  const wallet = await request(`${base}/api/v1/wallet`, headers, ca)
  if (wallet.status !== 200)
    throw new Error(i18n('LNbits did not accept the invoice key'))
  const { name } = JSON.parse(wallet.body) as { name?: string }
  // an outgoing payment without an invoice: LNbits answers 400 to an Admin key and 403 to an Invoice key
  const { status } = await request(
    `${base}/api/v1/payments`,
    { ...headers, 'Content-Type': 'application/json' },
    ca,
    'POST',
    JSON.stringify({ out: true }),
  )
  if (status === 400)
    throw new Error(
      i18n(
        "That is an Admin key, which can spend from the wallet. Use the Invoice/read key from the wallet's API info instead.",
      ),
    )
  if (status !== 403)
    throw new Error(
      i18n('LNbits answered HTTP ${status} when checking the key', {
        status: String(status),
      }),
    )
  return name ?? ''
}

const btcpayAllowed = [
  'btcpay.store.cancreateinvoice',
  'btcpay.store.canviewinvoices',
]

async function checkBtcpay(
  base: string,
  storeId: string,
  key: string,
  ca: string | null,
) {
  const headers = { Authorization: `token ${key}` }
  const res = await request(`${base}/api/v1/api-keys/current`, headers, ca)
  if (res.status !== 200)
    throw new Error(i18n('BTCPay Server did not accept the API key'))
  const { permissions = [] } = JSON.parse(res.body) as {
    permissions?: string[]
  }
  const extra = permissions.filter((p) => {
    const [policy, scope] = p.split(':')
    return !btcpayAllowed.includes(policy) || (scope && scope !== storeId)
  })
  if (extra.length)
    throw new Error(
      i18n(
        'The API key has permissions beyond creating and viewing invoices for this store: ${extra}. Create a new key with only "Create an invoice" and "View invoices" ticked.',
        { extra: extra.join(', ') },
      ),
    )
  if (permissions.some((p) => !p.includes(':')))
    throw new Error(
      i18n(
        'The API key works on all your stores. Create a new key and, under "Create an invoice" and "View invoices", click "Select specific stores" and pick this store.',
      ),
    )
  if (!permissions.some((p) => p.split(':')[0] === btcpayAllowed[0]))
    throw new Error(
      i18n('The API key cannot create invoices for store ${storeId}', {
        storeId,
      }),
    )
  const store = await request(
    `${base}/api/v1/stores/${encodeURIComponent(storeId)}/invoices?take=1`,
    headers,
    ca,
  )
  if (store.status !== 200)
    throw new Error(
      i18n(
        'BTCPay Server refused to list invoices for store ${storeId}. Check the store ID and that the key may view its invoices.',
        { storeId },
      ),
    )
}

async function localAddress(effects: T.Effects, backend: Backend) {
  const addr = await sdk.host
    .getBridgeAddress(effects, { ...backendHosts[backend], ssl: false })
    .once()
  if (!addr)
    throw new Error(
      i18n('Install ${name} on this server first, or choose Another server', {
        name: backendNames[backend],
      }),
    )
  return `http://${addr}`
}

export const paidAccess = sdk.Action.withInput(
  // id
  'paid-access',

  // metadata
  async ({ effects }) => ({
    name: i18n('Configure Paid Access'),
    description: i18n(
      'Sell write access through a public sign-up page: people pay with LNbits or BTCPay Server, and their public key can publish for the time they paid for. Applies while Write Access is set to the listed public keys, with or without tagging. strfry restarts to apply changes.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: i18n('Paid Access'),
    visibility: 'enabled',
  }),

  // input spec
  inputSpec,

  // pre-fill
  async ({ effects }) => {
    const p = await storeJson.read((s) => s.payments).once()
    if (!p) return {}
    const period = (['30', '90', '365', 'permanent'] as const).find(
      (k) => periods[k] === p.periodDays,
    )
    const server = p.url
      ? {
          selection: 'remote' as const,
          value: { address: p.url, rootCa: p.rootCa || null },
        }
      : { selection: 'local' as const, value: {} }
    return {
      payments:
        p.backend === 'lnbits'
          ? {
              selection: 'lnbits' as const,
              value: { server, invoiceKey: p.lnbitsKey },
            }
          : p.backend === 'btcpay'
            ? {
                selection: 'btcpay' as const,
                value: {
                  server,
                  storeId: p.btcpayStoreId,
                  apiKey: p.btcpayKey,
                },
              }
            : { selection: 'off' as const, value: {} },
      priceSats: p.priceSats,
      ...(period && { period }),
    }
  },

  // execution
  async ({ effects, input }) => {
    const { selection, value } = input.payments
    const cleared = {
      url: '',
      rootCa: '',
      lnbitsKey: '',
      btcpayStoreId: '',
      btcpayKey: '',
      priceSats: input.priceSats,
      periodDays: periods[input.period],
    }
    if (selection === 'off') {
      await storeJson.merge(effects, {
        payments: { ...cleared, backend: 'off' },
      })
      return null
    }

    const remote =
      value.server.selection === 'remote' ? value.server.value : null
    const url = remote ? parseAddress(remote.address) : ''
    const rootCa = remote?.rootCa?.trim() ? parseRootCa(remote.rootCa) : ''
    const base = url || (await localAddress(effects, selection))
    let destination: string

    if (selection === 'lnbits') {
      const key = value.invoiceKey.trim()
      const wallet = await checkLnbits(base, key, rootCa || null)
      destination = i18n(
        'Payments go to the LNbits wallet "${wallet}", in the account that owns it.',
        { wallet },
      )
      await storeJson.merge(effects, {
        payments: {
          ...cleared,
          url,
          rootCa,
          backend: 'lnbits',
          lnbitsKey: key,
        },
      })
    } else {
      const storeId = value.storeId.trim()
      const key = value.apiKey.trim()
      await checkBtcpay(base, storeId, key, rootCa || null)
      destination = i18n('Payments go to BTCPay Server store ${storeId}.', {
        storeId,
      })
      await storeJson.merge(effects, {
        payments: {
          ...cleared,
          url,
          rootCa,
          backend: 'btcpay',
          btcpayStoreId: storeId,
          btcpayKey: key,
        },
      })
    }

    const writeMode = await storeJson.read((s) => s.writeMode).once()
    return {
      version: '1' as const,
      title: i18n('Configure Paid Access'),
      message: `${
        writeMode === 'open'
          ? i18n(
              'Saved, but Write Access lets anyone publish, so the sign-up page sells nothing. Set Write Access to the listed public keys to start selling.',
            )
          : i18n(
              "Paid access is on. The sign-up page is at /join on the relay's address: give the Relay interface a public domain so people can reach it, and check Set Relay URL picks that address.",
            )
      } ${destination}`,
      result: null,
    }
  },
)
