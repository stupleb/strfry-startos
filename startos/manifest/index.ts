import { setupManifest } from '@start9labs/start-sdk'
import { long, short } from './i18n'

export const manifest = setupManifest({
  id: 'strfry',
  title: 'strfry',
  license: 'GPL-3.0',
  packageRepo: 'https://github.com/stupleb/strfry-startos',
  upstreamRepo: 'https://github.com/hoytech/strfry',
  marketingUrl: 'https://github.com/hoytech/strfry',
  donationUrl: null,
  description: { short, long },
  volumes: ['startos', 'main'],
  images: {
    strfry: {
      source: { dockerBuild: { dockerfile: 'Dockerfile' } },
      arch: ['x86_64', 'aarch64'],
    },
  },
})
