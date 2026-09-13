import {
  type AiModelIconId,
  resolveAiModelIconId
} from '@renderer/components/settings/ai-model-icon'
import type { AiProviderPresetId } from '@shared/ai-types'
import { Sparkles } from 'lucide-react'
import type { ComponentType } from 'react'
import LobeAnthropic from '~icons/lobehub/anthropic'
import LobeAzureColor from '~icons/lobehub/azure-color'
import LobeBaichuanColor from '~icons/lobehub/baichuan-color'
import LobeClaudeColor from '~icons/lobehub/claude-color'
import LobeCohereColor from '~icons/lobehub/cohere-color'
import LobeDeepseekColor from '~icons/lobehub/deepseek-color'
import LobeDoubaoColor from '~icons/lobehub/doubao-color'
import LobeFireworksColor from '~icons/lobehub/fireworks-color'
import LobeGeminiColor from '~icons/lobehub/gemini-color'
import LobeGoogleColor from '~icons/lobehub/google-color'
import LobeGrok from '~icons/lobehub/grok'
import LobeGroq from '~icons/lobehub/groq'
import LobeHuggingfaceColor from '~icons/lobehub/huggingface-color'
import LobeHunyuanColor from '~icons/lobehub/hunyuan-color'
import LobeKimiColor from '~icons/lobehub/kimi-color'
import LobeLmstudio from '~icons/lobehub/lmstudio'
import LobeMetaColor from '~icons/lobehub/meta-color'
import LobeMicrosoftColor from '~icons/lobehub/microsoft-color'
import LobeMinimaxColor from '~icons/lobehub/minimax-color'
import LobeMistralColor from '~icons/lobehub/mistral-color'
import LobeMoonshot from '~icons/lobehub/moonshot'
import LobeNovaColor from '~icons/lobehub/nova-color'
import LobeNovitaColor from '~icons/lobehub/novita-color'
import LobeOllama from '~icons/lobehub/ollama'
import LobeOpenai from '~icons/lobehub/openai'
import LobeOpenrouter from '~icons/lobehub/openrouter'
import LobePerplexityColor from '~icons/lobehub/perplexity-color'
import LobePpioColor from '~icons/lobehub/ppio-color'
import LobeQwenColor from '~icons/lobehub/qwen-color'
import LobeSiliconcloudColor from '~icons/lobehub/siliconcloud-color'
import LobeSparkColor from '~icons/lobehub/spark-color'
import LobeStepfunColor from '~icons/lobehub/stepfun-color'
import LobeTogetherColor from '~icons/lobehub/together-color'
import LobeWenxinColor from '~icons/lobehub/wenxin-color'
import LobeXai from '~icons/lobehub/xai'
import LobeYiColor from '~icons/lobehub/yi-color'
import LobeZhipuColor from '~icons/lobehub/zhipu-color'

type MenuIcon = ComponentType<{ className?: string; size?: number; strokeWidth?: number }>

const PRESET_ICON: Partial<Record<AiProviderPresetId, MenuIcon>> = {
  alibaba: LobeQwenColor,
  anthropic: LobeAnthropic,
  azure: LobeAzureColor,
  deepseek: LobeDeepseekColor,
  fireworks: LobeFireworksColor,
  google: LobeGoogleColor,
  groq: LobeGroq,
  huggingface: LobeHuggingfaceColor,
  lmstudio: LobeLmstudio,
  minimax: LobeMinimaxColor,
  mistral: LobeMistralColor,
  moonshot: LobeMoonshot,
  novita: LobeNovitaColor,
  ollama: LobeOllama,
  openai: LobeOpenai,
  openrouter: LobeOpenrouter,
  ppio: LobePpioColor,
  siliconflow: LobeSiliconcloudColor,
  stepfun: LobeStepfunColor,
  together: LobeTogetherColor,
  volcengine: LobeDoubaoColor,
  xai: LobeXai,
  zhipu: LobeZhipuColor
}

const MODEL_ICON: Record<AiModelIconId, MenuIcon> = {
  vidbee: VidBeeLogoIcon,
  zhipu: LobeZhipuColor,
  openai: LobeOpenai,
  anthropic: LobeClaudeColor,
  google: LobeGoogleColor,
  gemini: LobeGeminiColor,
  deepseek: LobeDeepseekColor,
  qwen: LobeQwenColor,
  xai: LobeGrok,
  meta: LobeMetaColor,
  kimi: LobeKimiColor,
  mistral: LobeMistralColor,
  minimax: LobeMinimaxColor,
  doubao: LobeDoubaoColor,
  stepfun: LobeStepfunColor,
  hunyuan: LobeHunyuanColor,
  baichuan: LobeBaichuanColor,
  yi: LobeYiColor,
  cohere: LobeCohereColor,
  nova: LobeNovaColor,
  microsoft: LobeMicrosoftColor,
  perplexity: LobePerplexityColor,
  spark: LobeSparkColor,
  wenxin: LobeWenxinColor,
  groq: LobeGroq,
  ollama: LobeOllama,
  openrouter: LobeOpenrouter,
  azure: LobeAzureColor,
  fireworks: LobeFireworksColor,
  together: LobeTogetherColor,
  huggingface: LobeHuggingfaceColor,
  lmstudio: LobeLmstudio,
  novita: LobeNovitaColor,
  ppio: LobePpioColor,
  siliconflow: LobeSiliconcloudColor,
  generic: Sparkles
}

/**
 * VidBee mark used for Cloud in the Composer model menu.
 *
 * @param props.className Optional layout classes from the menu row.
 * @param props.size Pixel size when the Command Menu passes an icon size.
 */
function VidBeeLogoIcon({
  className,
  size = 16
}: {
  className?: string
  size?: number
  strokeWidth?: number
}) {
  return (
    <img alt="" aria-hidden className={className} height={size} src="./app-icon.png" width={size} />
  )
}

/**
 * LobeHub brand mark for a catalog provider, VidBee logo for Cloud, Sparkles otherwise.
 *
 * @param presetId Catalog provider id, or null for VidBee Cloud.
 */
export function aiProviderIconComponent(presetId?: AiProviderPresetId | null): MenuIcon {
  if (!presetId) {
    return VidBeeLogoIcon
  }
  return PRESET_ICON[presetId] ?? Sparkles
}

/**
 * Brand mark for a Composer model: match the model id first, then the provider.
 *
 * @param input.isCloud VidBee Cloud uses the VidBee logo.
 * @param input.presetId Saved provider catalog id.
 * @param input.modelId Provider model id.
 * @param input.name User-facing provider or model name.
 */
export function aiModelIconComponent(input: {
  isCloud?: boolean
  presetId?: AiProviderPresetId | null
  modelId?: string
  name?: string
}): MenuIcon {
  return MODEL_ICON[resolveAiModelIconId(input)]
}

/**
 * Render the brand mark for a built-in AI provider.
 *
 * @param props.presetId Catalog provider id.
 */
export const AiProviderIcon = ({ presetId }: { presetId: AiProviderPresetId }) => {
  const Icon = aiProviderIconComponent(presetId)
  return <Icon aria-hidden className="size-4" />
}
