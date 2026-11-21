import { normalizePromptMarkdown } from '@vidbee/ui/lib/prompt-markdown'
import { lexer, walkTokens } from 'marked'

/** Read Mermaid code blocks in display order, including lists and blockquotes, without matching fenced examples. */
export function extractMermaidDiagrams(markdown: string): string[] {
  const diagrams: string[] = []
  walkTokens(lexer(normalizePromptMarkdown(markdown)), (token) => {
    if (token.type === 'code' && token.lang?.split(/\s+/)[0] === 'mermaid') {
      diagrams.push(token.text)
    }
  })
  return diagrams
}
