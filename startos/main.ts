import { relayUrl } from './actions/relayUrl'
import { signupState } from './fileModels/signupState.json'
import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { sdk } from './sdk'
import {
  backendHosts,
  etcMount,
  mounts,
  refreshPolicy,
  relay,
  relayPort,
  signupAdminPort,
  signupMounts,
  strfry,
  strfryPort,
  writeConfig,
} from './utils'

export const main = sdk.setupMain(async ({ effects }) => {
  console.info(i18n('Starting strfry!'))

  const store = await storeJson
    .read((s) => ({
      info: s.info,
      writeMode: s.writeMode,
      acceptOldEvents: s.acceptOldEvents,
      payments: s.payments,
      blocking: s.blockedPubkeys.length > 0,
    }))
    .const(effects)
  if (!store) throw new Error(i18n('store.json is missing'))

  const { payments } = store
  const paid = payments.backend !== 'off'
  const relayAddress = await relayUrl.bestUsable(effects).const()

  await writeConfig(store, relayAddress)

  storeJson.read().onChange(effects, async () => {
    await refreshPolicy(relayAddress)
    return { cancel: false }
  })
  signupState
    .read((s) => s.members)
    .onChange(effects, async () => {
      await refreshPolicy(relayAddress)
      return { cancel: false }
    })

  const subcontainer = sdk.SubContainer.of(
    effects,
    { imageId: 'strfry' },
    mounts,
    'strfry-sub',
  )
  relay.sub = subcontainer
  effects.onLeaveContext(() => {
    if (relay.sub === subcontainer) relay.sub = undefined
  })

  const daemons = sdk.Daemons.of(effects).addDaemon('primary', {
    subcontainer,
    exec: {
      command: [
        'sh',
        '-c',
        `ulimit -n "$(ulimit -Hn)" && exec ${strfry('relay').join(' ')}`,
      ],
    },
    ready: {
      display: i18n('Relay'),
      fn: () =>
        sdk.healthCheck.checkPortListening(
          effects,
          paid ? strfryPort : relayPort,
          {
            successMessage: i18n('The relay is accepting connections'),
            errorMessage: i18n('The relay is not accepting connections'),
          },
        ),
    },
    requires: [],
  })

  if (payments.backend === 'off') return daemons

  const backendUrl =
    payments.url ||
    (await sdk.host
      .getBridgeAddress(effects, {
        ...backendHosts[payments.backend],
        ssl: false,
      })
      .const()
      .then((addr) => (addr ? `http://${addr}` : '')))

  return daemons
    .addDaemon('signup', {
      subcontainer: sdk.SubContainer.of(
        effects,
        { imageId: 'strfry' },
        signupMounts,
        'signup-sub',
      ),
      exec: {
        command: ['strfry-signup'],
        env: {
          SIGNUP_LISTEN: `:${relayPort}`,
          SIGNUP_TRUSTED_PROXIES: await sdk.getOsIp(effects),
          SIGNUP_RELAY_UPSTREAM: `http://127.0.0.1:${strfryPort}`,
          SIGNUP_ADMIN_LISTEN: `127.0.0.1:${signupAdminPort}`,
          SIGNUP_BLOCKED_FILE: `${etcMount}/blocked.json`,
          SIGNUP_DATA: '/var/lib/signup',
          SIGNUP_ACCEPTING: String(store.writeMode !== 'open'),
          SIGNUP_PRICE_SATS: String(payments.priceSats),
          SIGNUP_PERIOD_DAYS: String(payments.periodDays),
          SIGNUP_BACKEND: payments.backend,
          SIGNUP_BACKEND_URL: backendUrl,
          SIGNUP_ROOT_CA: payments.rootCa,
          SIGNUP_LNBITS_KEY: payments.lnbitsKey,
          SIGNUP_BTCPAY_STORE: payments.btcpayStoreId,
          SIGNUP_BTCPAY_KEY: payments.btcpayKey,
          RELAY_NAME: store.info.name,
          RELAY_DESCRIPTION: store.info.description,
          RELAY_ICON: store.info.icon,
          RELAY_URL: relayAddress ?? '',
          RELAY_TERMS: store.info.terms,
          RELAY_PRIVACY: store.info.privacy,
          RELAY_CONTACT: store.info.contact,
        },
      },
      ready: {
        display: i18n('Sign-up Page'),
        fn: () =>
          sdk.healthCheck.checkPortListening(effects, relayPort, {
            successMessage: i18n('The sign-up page is up'),
            errorMessage: i18n(
              'The sign-up page is not responding, so clients cannot reach the relay either',
            ),
          }),
      },
      requires: ['primary'],
    })
    .addHealthCheck('payments', {
      ready: {
        display: i18n('Payments'),
        trigger: sdk.trigger.statusTrigger(30_000, { starting: 5_000 }),
        fn: async () => {
          const res = await fetch(`http://127.0.0.1:${relayPort}/healthz`, {
            signal: AbortSignal.timeout(20_000),
          }).catch(() => null)
          if (res?.ok)
            return {
              result: 'success',
              message: i18n('The payment backend accepts the credentials'),
            }
          const error = (await res?.json().catch(() => null))?.error
          return {
            result: 'failure',
            message: error
              ? i18n('Payments are unavailable: ${error}', { error })
              : i18n(
                  'Payments are unavailable: the sign-up page did not answer',
                ),
          }
        },
      },
      requires: ['signup'],
    })
})
