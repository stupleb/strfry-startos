import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '1.1.3:1',
  releaseNotes: {
    en_US:
      'Paid Access sells write access through a public sign-up page, paid with LNbits or BTCPay Server. Write Access can also block public keys outright. With Include mentions on, Import from Public Key also brings in the zaps a key sent.',
    es_ES:
      'Acceso de pago vende el acceso de escritura mediante una página de registro pública, que se paga con LNbits o BTCPay Server. Acceso de escritura también puede bloquear claves públicas por completo. Con Incluir menciones activado, Importar desde clave pública también trae los zaps que envió una clave.',
    de_DE:
      'Bezahlter Zugang verkauft Schreibzugriff über eine öffentliche Anmeldeseite, bezahlt mit LNbits oder BTCPay Server. Schreibzugriff kann öffentliche Schlüssel außerdem vollständig sperren. Mit Erwähnungen einbeziehen holt Von öffentlichem Schlüssel importieren auch die Zaps, die ein Schlüssel gesendet hat.',
    pl_PL:
      'Płatny dostęp sprzedaje dostęp do zapisu przez publiczną stronę rejestracji opłacaną przez LNbits lub BTCPay Server. Dostęp do zapisu może też całkowicie blokować klucze publiczne. Przy włączonym Uwzględnij wzmianki Importuj z klucza publicznego pobiera też zapy wysłane przez klucz.',
    fr_FR:
      "Accès payant vend l'accès en écriture via une page d'inscription publique, payée avec LNbits ou BTCPay Server. Accès en écriture peut aussi bloquer complètement des clés publiques. Avec Inclure les mentions, Importer depuis une clé publique récupère aussi les zaps qu'une clé a envoyés.",
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
