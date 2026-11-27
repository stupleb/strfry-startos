import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '1.1.3:3',
  releaseNotes: {
    en_US:
      'The sign-up page allows at most three unpaid invoices per IP address at a time.',
    es_ES:
      'La página de registro permite como máximo tres facturas sin pagar por dirección IP a la vez.',
    de_DE:
      'Die Anmeldeseite erlaubt höchstens drei unbezahlte Rechnungen pro IP-Adresse gleichzeitig.',
    pl_PL:
      'Strona rejestracji pozwala na najwyżej trzy nieopłacone faktury na adres IP jednocześnie.',
    fr_FR:
      "La page d'inscription autorise au plus trois factures impayées par adresse IP à la fois.",
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
