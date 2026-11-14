import { sdk } from '../sdk'
import { i18n } from '../i18n'
import { dependencies } from '../dependencies'
import { setInterfaces } from '../interfaces'
import { versionGraph } from '../versions'
import { actions } from '../actions'
import { relayUrl } from '../actions/relayUrl'
import { restoreInit } from '../backups'
import { seedFiles } from './seedFiles'
import { writeAccessTask } from './writeAccessTask'

export const init = sdk.setupInit(
  restoreInit,
  versionGraph,
  seedFiles,
  setInterfaces,
  actions,
  relayUrl.setupTask('important', {
    reason: i18n('Choose the address clients use for this relay'),
  }),
  dependencies,
  writeAccessTask,
)

export const uninit = sdk.setupUninit(versionGraph)
