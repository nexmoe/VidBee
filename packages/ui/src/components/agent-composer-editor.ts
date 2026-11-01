import { agentMentionTextParts } from '../lib/agent-video-text'
import type { AgentComposerSkill } from './agent-skill-mentions'

export interface ComposerSelection {
  start: number
  end: number
}

/** Keep line breaks explicit so blank lines and trailing newlines remain editable. */
function appendComposerText(fragment: DocumentFragment, text: string): void {
  const lines = text.split('\n')
  for (const [index, line] of lines.entries()) {
    if (index > 0) {
      fragment.append(fragment.ownerDocument.createElement('br'))
    }
    fragment.append(fragment.ownerDocument.createTextNode(line))
  }
}

/** Render trusted text and localized, noneditable mention spans without parsing user HTML. */
function composerFragment(
  document: Document,
  value: string,
  skills: readonly AgentComposerSkill[],
  includeTail: boolean
): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const available = new Map(skills.map((skill) => [skill.name, skill]))
  for (const part of agentMentionTextParts(
    value,
    (name) => available.get(name),
    available.keys()
  )) {
    if (!(part.skill || part.video)) {
      appendComposerText(fragment, part.text)
      continue
    }
    const badge = document.createElement('span')
    badge.className = part.video ? 'agent-skill-badge agent-video-badge' : 'agent-skill-badge'
    badge.contentEditable = 'false'
    if (part.video) {
      badge.dataset.videoToken = part.text
      badge.textContent = part.video.title
    } else if (part.skill) {
      badge.dataset.skillName = part.skill.name
      badge.textContent = part.skill.label ?? part.skill.name
    }
    fragment.append(badge)
  }
  if (includeTail && (!value || value.endsWith('\n'))) {
    const tail = document.createElement('br')
    tail.dataset.composerTail = ''
    fragment.append(tail)
  }
  return fragment
}

/** Serialize badges in place as standard commands, including browser-created line breaks. */
export function composerEditorValue(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? ''
  }
  if (node instanceof HTMLElement) {
    if (node.dataset.videoToken) {
      return node.dataset.videoToken
    }
    if (node.dataset.skillName) {
      return `$${node.dataset.skillName}`
    }
    if (node.tagName === 'BR') {
      return node.hasAttribute('data-composer-tail') ? '' : '\n'
    }
    if (
      node.isContentEditable &&
      node.childNodes.length === 1 &&
      node.firstChild instanceof HTMLBRElement
    ) {
      return ''
    }
  }
  let value = ''
  for (const child of node.childNodes) {
    if (
      child instanceof HTMLElement &&
      (child.tagName === 'DIV' || child.tagName === 'P') &&
      child.previousSibling &&
      !value.endsWith('\n')
    ) {
      value += '\n'
    }
    value += composerEditorValue(child)
  }
  return value
}

/** Map the browser selection to offsets in the canonical draft, rather than localized label lengths. */
export function composerEditorSelection(editor: HTMLElement): ComposerSelection | null {
  const selection = editor.ownerDocument.getSelection()
  if (!selection?.rangeCount) {
    return null
  }
  const range = selection.getRangeAt(0)
  if (!(editor.contains(range.startContainer) && editor.contains(range.endContainer))) {
    return null
  }
  const prefix = range.cloneRange()
  prefix.selectNodeContents(editor)
  setComposerPrefixEnd(prefix, range.startContainer, range.startOffset, range.collapsed)
  const length = composerEditorValue(editor).length
  const start = Math.min(length, composerEditorValue(prefix.cloneContents()).length)
  setComposerPrefixEnd(prefix, range.endContainer, range.endOffset, true)
  return { start, end: Math.min(length, composerEditorValue(prefix.cloneContents()).length) }
}

/** Include or exclude a whole badge when a mouse selection ends inside its label. */
function setComposerPrefixEnd(range: Range, node: Node, offset: number, afterBadge: boolean): void {
  const element = node instanceof Element ? node : node.parentElement
  const badge = element?.closest('[data-skill-name], [data-video-token]')
  if (badge) {
    if (afterBadge) {
      range.setEndAfter(badge)
    } else {
      range.setEndBefore(badge)
    }
  } else {
    range.setEnd(node, offset)
  }
}

/** Locate a canonical offset while keeping the caret outside atomic mention badges. */
function composerPoint(node: Node, offset: number): { node: Node; offset: number } {
  if (node.nodeType === Node.TEXT_NODE) {
    return { node, offset: Math.min(offset, node.textContent?.length ?? 0) }
  }
  let remaining = offset
  for (const [index, child] of [...node.childNodes].entries()) {
    const length = composerEditorValue(child).length
    if (remaining <= length) {
      if (
        child instanceof HTMLElement &&
        (child.dataset.skillName || child.dataset.videoToken || child.tagName === 'BR')
      ) {
        return { node, offset: index + (remaining > 0 ? 1 : 0) }
      }
      return composerPoint(child, remaining)
    }
    remaining -= length
  }
  return { node, offset: node.childNodes.length }
}

/** Restore a range after external draft changes or an explicit mention replacement. */
export function setComposerEditorSelection(editor: HTMLElement, start: number, end = start): void {
  const first = composerPoint(editor, start)
  const last = composerPoint(editor, end)
  const range = editor.ownerDocument.createRange()
  range.setStart(first.node, first.offset)
  range.setEnd(last.node, last.offset)
  const selection = editor.ownerDocument.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/** Compare only badge identities and labels so ordinary typing retains the native undo history. */
function composerBadgesMatch(editor: HTMLElement, fragment: DocumentFragment): boolean {
  const actual = [...editor.querySelectorAll<HTMLElement>('[data-skill-name], [data-video-token]')]
  const expected = [
    ...fragment.querySelectorAll<HTMLElement>('[data-skill-name], [data-video-token]')
  ]
  return (
    actual.length === expected.length &&
    actual.every(
      (badge, index) =>
        badge.dataset.skillName === expected[index]?.dataset.skillName &&
        badge.dataset.videoToken === expected[index]?.dataset.videoToken &&
        badge.textContent === expected[index]?.textContent
    )
  )
}

/** Synchronize externally supplied drafts and locale changes without rewriting each keystroke. */
export function syncComposerEditor(
  editor: HTMLElement,
  value: string,
  skills: readonly AgentComposerSkill[]
): void {
  const fragment = composerFragment(editor.ownerDocument, value, skills, true)
  if (
    composerEditorValue(editor) === value &&
    composerBadgesMatch(editor, fragment) &&
    !editor.querySelector('div, p') &&
    (!value.endsWith('\n') || editor.lastChild instanceof HTMLBRElement)
  ) {
    return
  }
  const selection =
    editor.ownerDocument.activeElement === editor ? composerEditorSelection(editor) : null
  editor.replaceChildren(fragment)
  if (selection) {
    setComposerEditorSelection(editor, selection.start, selection.end)
  }
}

/** Insert sanitized content through the browser editing transaction to preserve undo and redo. */
export function insertComposerEditorText(
  editor: HTMLElement,
  text: string,
  skills: readonly AgentComposerSkill[],
  selection?: ComposerSelection
): void {
  editor.focus()
  if (selection) {
    setComposerEditorSelection(editor, selection.start, selection.end)
  }
  const range = composerEditorSelection(editor)
  const atEnd = range?.end === composerEditorValue(editor).length
  const container = editor.ownerDocument.createElement('div')
  container.append(
    composerFragment(editor.ownerDocument, text, skills, atEnd && text.endsWith('\n'))
  )
  // execCommand keeps these atomic edits in Chromium's native undo history.
  if (text) {
    editor.ownerDocument.execCommand('insertHTML', false, container.innerHTML)
  } else {
    editor.ownerDocument.execCommand('delete')
  }
  if (range) {
    setComposerEditorSelection(editor, range.start + text.length)
  }
}

/** Delete an adjacent badge as a whole while leaving surrounding text and whitespace untouched. */
export function deleteComposerEditorSkill(editor: HTMLElement, backwards: boolean): boolean {
  const selection = composerEditorSelection(editor)
  if (!selection || selection.start !== selection.end) {
    return false
  }
  for (const badge of editor.querySelectorAll<HTMLElement>(
    '[data-skill-name], [data-video-token]'
  )) {
    const prefix = editor.ownerDocument.createRange()
    prefix.selectNodeContents(editor)
    prefix.setEndBefore(badge)
    const start = composerEditorValue(prefix.cloneContents()).length
    const end = start + composerEditorValue(badge).length
    if ((backwards ? end : start) === selection.start) {
      insertComposerEditorText(editor, '', [], { start, end })
      return true
    }
  }
  return false
}
