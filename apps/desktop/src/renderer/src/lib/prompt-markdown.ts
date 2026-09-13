/** Join `2.\n**Question?**` onto one list item so the number is not orphaned. */
const ORPHAN_ORDERED_MARKER = /^(\d+)\.[ \t]*\r?\n+(?=\S)(?!\d+\.[ \t]|#{1,6} |[-*+] )/gm

/** A line that is only `**label**` — used as a section title, not inline emphasis. */
const STANDALONE_BOLD_LINE = /^\*\*(.+?)\*\*[ \t]*$/gm

/**
 * Normalize model markdown before Streamdown renders it.
 *
 * Joins orphaned numbered markers onto the next line, and turns a
 * standalone `**title**` line into a heading so section labels stay
 * visually distinct without painting the following paragraph bold.
 *
 * @param markdown Raw prompt result.
 * @returns Markdown ready for the prompt renderer.
 */
export const normalizePromptMarkdown = (markdown: string): string =>
  markdown.replace(ORPHAN_ORDERED_MARKER, '$1. ').replace(STANDALONE_BOLD_LINE, '### $1')
