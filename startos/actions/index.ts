import { sdk } from '../sdk'
import { deleteEvents } from './deleteEvents'
import { editPaidMember } from './editPaidMember'
import { importPubkey } from './importPubkey'
import { importRelay } from './importRelay'
import { paidAccess } from './paidAccess'
import { paidMembers } from './paidMembers'
import { relayInfo } from './relayInfo'
import { relayUrl } from './relayUrl'
import { writeAccess } from './writeAccess'

export const actions = sdk.Actions.of()
  .addAction(writeAccess)
  .addAction(relayInfo)
  .addAction(relayUrl.action)
  .addAction(paidAccess)
  .addAction(paidMembers)
  .addAction(editPaidMember)
  .addAction(importPubkey)
  .addAction(importRelay)
  .addAction(deleteEvents)
