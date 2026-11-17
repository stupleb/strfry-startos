import { FileHelper, z } from '@start9labs/start-sdk'
import { sdk } from '../sdk'

// written only by the strfry-signup daemon; a malformed entry drops every member rather than granting access
const shape = z.looseObject({
  members: z
    .record(
      z.string().regex(/^[0-9a-f]{64}$/),
      z.looseObject({ until: z.number().int().nullable(), since: z.number() }),
    )
    .catch({}),
})

export type Members = z.infer<typeof shape>['members']

export const signupState = FileHelper.json(
  { base: sdk.volumes.startos, subpath: 'signup/state.json' },
  shape,
)
