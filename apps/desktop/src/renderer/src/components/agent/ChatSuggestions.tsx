import { Badge } from '@renderer/components/ui/badge'
import { ArrowRightLeft, Captions, Download, Minimize2, Music, Rss } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const CHAT_SUGGESTIONS = [
  { id: 'download', icon: Download },
  { id: 'audio', icon: Music },
  { id: 'compress', icon: Minimize2 },
  { id: 'convert', icon: ArrowRightLeft },
  { id: 'transcribe', icon: Captions },
  { id: 'subscribe', icon: Rss }
] as const

/** Introduce VidBee workflows and let the user start an editable message draft. */
export function ChatSuggestions({
  disabled,
  onSelect
}: {
  disabled: boolean
  onSelect: (prompt: string) => void
}) {
  const { t } = useTranslation()

  return (
    <section
      aria-labelledby="agent-chat-suggestions-title"
      className="mx-auto w-full max-w-xl space-y-6 py-6"
      data-testid="agent-chat-suggestions"
    >
      <div className="space-y-2 text-center">
        <h2 className="font-semibold text-2xl tracking-tight" id="agent-chat-suggestions-title">
          {t('agentChat.suggestions.title')}
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t('agentChat.suggestions.description')}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {CHAT_SUGGESTIONS.map(({ id, icon: Icon }) => (
          <Badge
            asChild
            className="h-7 cursor-pointer gap-1.5 border-border/60 bg-surface-2 px-2.5 hover:bg-hover disabled:pointer-events-none disabled:opacity-50"
            key={id}
            variant="outline"
          >
            <button
              disabled={disabled}
              onClick={() => onSelect(t(`agentChat.suggestions.${id}.prompt`))}
              type="button"
            >
              <Icon aria-hidden className="text-muted-foreground" />
              {t(`agentChat.suggestions.${id}.label`)}
            </button>
          </Badge>
        ))}
      </div>
    </section>
  )
}
