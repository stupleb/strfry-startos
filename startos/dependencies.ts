import { T } from '@start9labs/start-sdk'
import { storeJson } from './fileModels/store.json'
import { depBtcpayDescription, depLnbitsDescription } from './manifest/i18n'
import { sdk } from './sdk'

const selected =
  (backend: 'lnbits' | 'btcpay') =>
  async ({ effects }: { effects: T.Effects }) =>
    (await storeJson
      .read((s) => s.payments.backend === backend && !s.payments.url)
      .const(effects)) === true

export const dependencies = sdk.Dependencies.of()
  .addDependency(
    sdk.Dependency.optional('lnbits', {
      description: depLnbitsDescription,
      metadata: {
        title: 'LNbits',
        icon: 'https://raw.githubusercontent.com/Start9Labs/lnbits-startos/refs/heads/master/icon.svg',
      },
      versionRange: '>=1.6.2:8',
      kind: 'running',
      healthChecks: ['primary'],
      enabled: selected('lnbits'),
    }),
  )
  .addDependency(
    sdk.Dependency.optional('btcpayserver', {
      description: depBtcpayDescription,
      metadata: {
        title: 'BTCPay Server',
        icon: 'https://raw.githubusercontent.com/Start9Labs/btcpayserver-startos/refs/heads/master/icon.svg',
      },
      versionRange: '>=2.4.5:4',
      kind: 'running',
      healthChecks: ['btcpay'],
      enabled: selected('btcpay'),
    }),
  )
