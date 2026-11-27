import { VersionGraph } from '@start9labs/start-sdk'
import { current } from './current'
import { v_1_1_3_2 } from './v1.1.3_2'

export const versionGraph = VersionGraph.of({
  current,
  other: [v_1_1_3_2],
})
