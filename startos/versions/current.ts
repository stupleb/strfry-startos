import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '1.1.3:0',
  releaseNotes: {
    en_US: 'Initial release of strfry 1.1.3 for StartOS.',
    es_ES: 'Lanzamiento inicial de strfry 1.1.3 para StartOS.',
    de_DE: 'Erstveröffentlichung von strfry 1.1.3 für StartOS.',
    pl_PL: 'Pierwsze wydanie strfry 1.1.3 dla StartOS.',
    fr_FR: 'Version initiale de strfry 1.1.3 pour StartOS.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
