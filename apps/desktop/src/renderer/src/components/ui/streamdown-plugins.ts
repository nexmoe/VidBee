import { mermaid } from '@renderer/lib/pele-mermaid-plugin'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import type { PluginConfig } from 'streamdown'

/** Streamdown plugins used by transcript and settings AI output. */
export const promptStreamdownPlugins: PluginConfig = {
  cjk,
  code,
  math,
  mermaid
}
