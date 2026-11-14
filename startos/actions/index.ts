import { sdk } from '../sdk'
import { deleteEvents } from './deleteEvents'
import { importPubkey } from './importPubkey'
import { importRelay } from './importRelay'
import { relayInfo } from './relayInfo'
import { relayUrl } from './relayUrl'
import { writeAccess } from './writeAccess'

export const actions = sdk.Actions.of()
  .addAction(writeAccess)
  .addAction(relayInfo)
  .addAction(relayUrl.action)
  .addAction(importPubkey)
  .addAction(importRelay)
  .addAction(deleteEvents)
