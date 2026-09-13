/** Hidden window used to snapshot printable HTML into a PDF buffer. */
export interface MarkdownPdfWindow {
  destroy: () => void
  isDestroyed: () => boolean
  loadFile: (filePath: string) => Promise<void>
  webContents: {
    executeJavaScript: (script: string) => Promise<unknown>
    printToPDF: (options: object) => Promise<Buffer>
  }
}

const PRINT_PDF_OPTIONS = {
  margins: { bottom: 0.6, left: 0.6, right: 0.6, top: 0.6 },
  pageSize: 'A4' as const,
  printBackground: true
}

/** Wait until fonts and inline images are painted before snapshotting a PDF. */
export const PRINT_DOCUMENT_READY = `(async () => {
  try {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  } catch (error) {}
  const images = Array.from(document.images);
  await Promise.all(images.map((image) => new Promise((resolve) => {
    const finish = () => {
      try {
        if (typeof image.decode === 'function') {
          image.decode().then(resolve, resolve);
          return;
        }
      } catch (error) {}
      resolve();
    };
    if (image.complete) {
      finish();
      return;
    }
    image.addEventListener('load', finish, { once: true });
    image.addEventListener('error', resolve, { once: true });
  })));
  return true;
})()`

/**
 * Escape text so it can sit inside HTML without becoming markup.
 *
 * @param value Raw markdown or attribute text.
 */
export const escapeHtml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/**
 * Keep http(s), mailto, in-page, and embedded raster images; drop javascript and opaque artifact URLs.
 *
 * @param url Markdown link or image target.
 */
export const safeHref = (url: string): string | null => {
  const trimmed = url.trim()
  if (/^(https?:|mailto:|#)/i.test(trimmed)) {
    return trimmed
  }
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(trimmed)) {
    return trimmed
  }
  return null
}

/**
 * Render emphasis, code, links, and images inside a markdown block.
 *
 * @param text A heading, paragraph, or list-item body.
 */
export const renderMarkdownInline = (text: string): string => {
  const codes: string[] = []
  const protectedText = text.replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`)
    return `@@VBCODE${codes.length - 1}@@`
  })
  let html = escapeHtml(protectedText)
  html = html.replace(/!\[([^\]]*)]\(([^)\s]+)\)/g, (_match, alt: string, url: string) => {
    const href = safeHref(url)
    if (!href) {
      return alt ? `<em>${alt}</em>` : ''
    }
    return `<img alt="${alt}" src="${escapeHtml(href)}" />`
  })
  html = html.replace(/\[([^\]]+)]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
    const href = safeHref(url)
    return href ? `<a href="${escapeHtml(href)}">${label}</a>` : label
  })
  html = html.replace(
    /\*\*(.+?)\*\*|__(.+?)__/g,
    (_match, a: string | undefined, b: string | undefined) => {
      return `<strong>${a ?? b}</strong>`
    }
  )
  html = html.replace(
    /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g,
    (_match, a: string | undefined, b: string | undefined) => `<em>${a ?? b}</em>`
  )
  html = html.replace(/@@VBCODE(\d+)@@/g, (match, index: string) => codes[Number(index)] ?? match)
  return html.replaceAll('\n', '<br />')
}

const isUnorderedItem = (line: string): boolean => /^[-*+]\s+/.test(line)
const isOrderedItem = (line: string): boolean => /^\d+\.\s+/.test(line)
const isFence = (line: string): boolean => /^```/.test(line)
const isHeading = (line: string): boolean => /^#{1,6}\s+\S/.test(line)
const isQuote = (line: string): boolean => /^>\s?/.test(line)
const isHr = (line: string): boolean => /^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line.trim())
const isTableSeparator = (line: string): boolean => /^\s*\|?[\s:|-]+\|\s*[\s:|-]+/.test(line)

/**
 * True when this line starts a new block rather than continuing a paragraph.
 *
 * @param line Remaining markdown line.
 */
const isBlockStart = (line: string): boolean =>
  isFence(line) ||
  isHeading(line) ||
  isQuote(line) ||
  isHr(line) ||
  isUnorderedItem(line) ||
  isOrderedItem(line) ||
  line.includes('|')

/**
 * Split a GFM table row into trimmed cells.
 *
 * @param line A pipe-delimited table row.
 */
const tableCells = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

/**
 * Convert markdown blocks into printable HTML fragments.
 *
 * @param markdown Reply body, including headings, lists, and fenced code.
 */
export const markdownToHtml = (markdown: string): string => {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  const html: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index += 1
      continue
    }
    if (isFence(line)) {
      const language = line.slice(3).trim()
      const body: string[] = []
      index += 1
      while (index < lines.length && !isFence(lines[index] ?? '')) {
        body.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) {
        index += 1
      }
      const langClass = language ? ` class="language-${escapeHtml(language)}"` : ''
      html.push(`<pre><code${langClass}>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }
    if (isHr(line)) {
      html.push('<hr />')
      index += 1
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1]?.length ?? 1
      html.push(`<h${level}>${renderMarkdownInline(heading[2] ?? '')}</h${level}>`)
      index += 1
      continue
    }
    if (isQuote(line)) {
      const quote: string[] = []
      while (
        index < lines.length &&
        (isQuote(lines[index] ?? '') || (quote.length > 0 && !(lines[index] ?? '').trim()))
      ) {
        quote.push((lines[index] ?? '').replace(/^>\s?/, ''))
        index += 1
      }
      html.push(`<blockquote>${markdownToHtml(quote.join('\n'))}</blockquote>`)
      continue
    }
    if (isUnorderedItem(line)) {
      const items: string[] = []
      while (index < lines.length && isUnorderedItem(lines[index] ?? '')) {
        items.push(
          `<li>${renderMarkdownInline((lines[index] ?? '').replace(/^[-*+]\s+/, ''))}</li>`
        )
        index += 1
      }
      html.push(`<ul>${items.join('')}</ul>`)
      continue
    }
    if (isOrderedItem(line)) {
      const items: string[] = []
      while (index < lines.length && isOrderedItem(lines[index] ?? '')) {
        items.push(
          `<li>${renderMarkdownInline((lines[index] ?? '').replace(/^\d+\.\s+/, ''))}</li>`
        )
        index += 1
      }
      html.push(`<ol>${items.join('')}</ol>`)
      continue
    }
    if (line.includes('|') && isTableSeparator(lines[index + 1] ?? '')) {
      const headers = tableCells(line).map((cell) => `<th>${renderMarkdownInline(cell)}</th>`)
      index += 2
      const rows: string[] = []
      while (index < lines.length && (lines[index] ?? '').includes('|')) {
        const cells = tableCells(lines[index] ?? '').map(
          (cell) => `<td>${renderMarkdownInline(cell)}</td>`
        )
        rows.push(`<tr>${cells.join('')}</tr>`)
        index += 1
      }
      html.push(
        `<table><thead><tr>${headers.join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
      )
      continue
    }
    const paragraph: string[] = []
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() &&
      !isBlockStart(lines[index] ?? '')
    ) {
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    if (paragraph.length === 0) {
      paragraph.push(line)
      index += 1
    }
    html.push(`<p>${renderMarkdownInline(paragraph.join('\n'))}</p>`)
  }
  return html.join('')
}

const PRINT_STYLES = `
  @page { margin: 18mm; }
  html, body { background: #fff; color: #111; }
  body {
    font: 12pt/1.65 system-ui, "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC",
      "Microsoft YaHei", "Noto Sans", sans-serif;
    margin: 0;
  }
  article { max-width: 720px; margin: 0 auto; }
  h1, h2, h3, h4, h5, h6 { page-break-after: avoid; line-height: 1.3; }
  h1 { font-size: 22pt; margin: 0 0 0.8em; }
  h2 { font-size: 16pt; margin: 1.4em 0 0.6em; }
  h3 { font-size: 13.5pt; margin: 1.2em 0 0.5em; }
  p, ul, ol, blockquote, table { margin: 0 0 0.9em; }
  ul, ol { padding-left: 1.4em; }
  li { margin: 0.2em 0; }
  blockquote {
    border-left: 3px solid #d4d4d4;
    color: #444;
    margin-left: 0;
    padding-left: 0.9em;
  }
  pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  pre {
    background: #f5f5f5;
    border-radius: 6px;
    font-size: 10pt;
    overflow-wrap: anywhere;
    padding: 12px 14px;
    page-break-inside: avoid;
    white-space: pre-wrap;
  }
  code { font-size: 0.92em; }
  p code, li code { background: #f5f5f5; border-radius: 4px; padding: 0.1em 0.35em; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d4d4d4; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; }
  img { display: block; height: auto; margin: 0.8em 0; max-width: 100%; page-break-inside: avoid; }
  a { color: inherit; }
  hr { border: 0; border-top: 1px solid #d4d4d4; margin: 1.4em 0; }
  footer {
    border-top: 1px solid #d4d4d4;
    color: #666;
    font-size: 10pt;
    margin-top: 2.4em;
    padding-top: 0.85em;
  }
  footer a { text-decoration: none; }
`.replaceAll(/\s+/g, ' ')

export const VIDBEE_EXPORT_URL = 'https://vidbee.org'
export const VIDBEE_EXPORT_NAME = 'VidBee'

/**
 * Append a VidBee colophon so exported Markdown files stay attributed.
 *
 * @param markdown Reply body after images have been inlined.
 */
export const withVidBeeExportFooter = (markdown: string): string =>
  `${markdown.trimEnd()}\n\n---\n\n[${VIDBEE_EXPORT_NAME}](${VIDBEE_EXPORT_URL})\n`

/**
 * Wrap converted markdown in a printable document with CJK-safe typography.
 *
 * @param markdown Reply body.
 * @param title Optional document title shown when the body has no H1.
 */
export const markdownToPrintableHtml = (markdown: string, title?: string): string => {
  const body = markdownToHtml(markdown.trim())
  const heading = title?.trim()
  const hasTitle = Boolean(heading) && !/^\s*<h1[\s>]/i.test(body)
  const titleHtml = hasTitle ? `<h1>${escapeHtml(heading ?? '')}</h1>` : ''
  const pageTitle = heading || VIDBEE_EXPORT_NAME
  const footer = `<footer><a href="${VIDBEE_EXPORT_URL}">${VIDBEE_EXPORT_NAME}</a></footer>`
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>${escapeHtml(pageTitle)}</title><style>${PRINT_STYLES}</style></head><body><article>${titleHtml}${body}${footer}</article></body></html>`
}

/**
 * Load an HTML file in a hidden window and print it to a PDF buffer.
 *
 * @param htmlFilePath Temporary printable HTML path.
 * @param createWindow Factory for an offscreen BrowserWindow stand-in.
 */
export const printHtmlToPdf = async (
  htmlFilePath: string,
  createWindow: () => MarkdownPdfWindow
): Promise<Buffer> => {
  const win = createWindow()
  try {
    await win.loadFile(htmlFilePath)
    try {
      await win.webContents.executeJavaScript(PRINT_DOCUMENT_READY)
    } catch {
      // Still print if a font or image waiter fails; missing pixels beat a failed export.
    }
    return await win.webContents.printToPDF(PRINT_PDF_OPTIONS)
  } finally {
    if (!win.isDestroyed()) {
      win.destroy()
    }
  }
}
