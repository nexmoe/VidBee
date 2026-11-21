import type { AsrFamily } from '@vidbee/transcription/asr'
import { Flame } from 'lucide-react'
import type { ComponentType } from 'react'
import LobeAlibabaCloudColor from '~icons/lobehub/alibabacloud-color'
import LobeNvidiaColor from '~icons/lobehub/nvidia-color'
import LobeOpenAI from '~icons/lobehub/openai'
import LobeQwenColor from '~icons/lobehub/qwen-color'

const FAMILY_ICON: Record<AsrFamily, ComponentType<{ className?: string }>> = {
  'fire-red-asr': Flame,
  parakeet: LobeNvidiaColor,
  qwen3: LobeQwenColor,
  'sense-voice': LobeAlibabaCloudColor,
  whisper: LobeOpenAI
}

/**
 * Render the LobeHub brand mark for an ASR model family.
 */
export const AsrFamilyIcon = ({ family }: { family: AsrFamily }) => {
  const Icon = FAMILY_ICON[family]
  return <Icon aria-hidden className="size-4" />
}
