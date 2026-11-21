import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import type { PluginConfig } from 'streamdown'
import { mermaid } from './pele-mermaid-plugin'

/** Streamdown plugins used by transcript and settings AI output. */
export const promptStreamdownPlugins: PluginConfig = {
  cjk,
  code,
  math,
  mermaid
}
