import { AgentThinkingContent as Content } from '@vidbee/ui/components/agent-thinking-content'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/** Bind the common thinking scroller to Desktop's locale. */
export function AgentThinkingContent({ open, children }: { open: boolean; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <Content label={t('transcript.promptThinking')} open={open}>
      {children}
    </Content>
  )
}
