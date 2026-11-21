import { SETTINGS_NAV_ITEMS } from '@renderer/components/settings/SettingsSectionNav'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut
} from '@renderer/components/ui/command'
import { useContentSearch } from '@renderer/hooks/use-content-search'
import { formatClock } from '@renderer/lib/format-clock'
import { ipcServices } from '@renderer/lib/ipc'
import { logger } from '@renderer/lib/logger'
import { downloadsArrayAtom } from '@renderer/store/downloads'
import { searchTargetAtom } from '@renderer/store/search-target'
import { AGENT_WORKSPACE_ID, selectedAgentMessages } from '@shared/agent-chat'
import {
  type ChatSearchHit,
  CONTENT_SEARCH_QUERY_LIMIT,
  CONTENT_SEARCH_RESULT_LIMIT,
  type TranscriptSearchHit
} from '@shared/content-search'
import { mediaSearchText, mediaSearchTitle } from '@shared/media-search'
import { useNavigate } from '@tanstack/react-router'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  Captions,
  Home,
  Info,
  type LucideIcon,
  MessageSquare,
  Music,
  Rss,
  Settings,
  Video
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const MAX_MEDIA_RESULTS = 50
const RECENT_MEDIA_RESULTS = 8

const PAGE_COMMANDS = [
  { to: '/', labelKey: 'menu.home', icon: Home },
  { to: '/chat', labelKey: 'transcript.promptHistoryChat', icon: MessageSquare },
  { to: '/subscriptions', labelKey: 'menu.subscriptions', icon: Rss },
  { to: '/settings', labelKey: 'menu.preferences', icon: Settings },
  { to: '/about', labelKey: 'menu.about', icon: Info }
] as const

interface SearchEntry {
  id: string
  title: string
  description?: string
  searchText: string
  icon: LucideIcon
  onSelect: () => void
}

interface GlobalSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Match every query word across an entry's title and metadata. */
function matchesEntry(entry: SearchEntry, words: string[]): boolean {
  return words.every((word) => entry.searchText.includes(word))
}

/** Render a searchable destination with a stable id for cmdk selection. */
function SearchResult({ entry }: { entry: SearchEntry }) {
  const Icon = entry.icon
  return (
    <CommandItem onSelect={entry.onSelect} value={entry.id}>
      <Icon aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate">{entry.title}</span>
        {entry.description ? (
          <span className="truncate text-muted-foreground text-xs">{entry.description}</span>
        ) : null}
      </span>
    </CommandItem>
  )
}

/** Index the complete media library only while the palette is open. */
function GlobalSearchContent({ active, onClose }: { active: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const downloads = useAtomValue(downloadsArrayAtom)
  const setSearchTarget = useSetAtom(searchTargetAtom)
  const [query, setQuery] = useState('')
  const [opening, setOpening] = useState(false)
  const content = useContentSearch(query, active)
  const words = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query])
  const mediaTitles = useMemo(
    () => new Map(downloads.map((record) => [record.id, mediaSearchTitle(record)])),
    [downloads]
  )

  /** Open the exact subtitle source before handing its segment to the mounted caption list. */
  async function openTranscript(hit: TranscriptSearchHit): Promise<void> {
    const snapshot = await ipcServices.transcript.selectSource({
      downloadId: hit.downloadId,
      key: hit.sourceKey
    })
    if (snapshot.record?.id !== hit.transcriptId) {
      throw new Error('The matching transcript is no longer available')
    }
    setSearchTarget({ kind: 'transcript', downloadId: hit.downloadId, segmentId: hit.segmentId })
    await navigate({
      to: '/downloads/$downloadId/transcript',
      params: { downloadId: hit.downloadId },
      search: {}
    })
  }

  /** Restore a matching conversation branch without interrupting an active reply. */
  async function openChat(hit: ChatSearchHit): Promise<void> {
    const thread = await ipcServices.ai.getAgentThread({
      downloadId: hit.downloadId,
      promptId: hit.promptId,
      threadId: hit.threadId
    })
    if (!selectedAgentMessages(thread).some((message) => message.id === hit.messageId)) {
      await ipcServices.ai.selectAgentBranch({ threadId: hit.threadId, messageId: hit.messageId })
    }
    setSearchTarget({ kind: 'chat', threadId: hit.threadId, messageId: hit.messageId })
    if (hit.downloadId === AGENT_WORKSPACE_ID) {
      await navigate({ to: '/chat', search: { thread: hit.threadId } })
      return
    }
    await navigate({
      to: '/downloads/$downloadId/transcript',
      params: { downloadId: hit.downloadId },
      search: { tab: hit.promptId, thread: hit.threadId }
    })
  }

  /** Keep the result list available when a source disappeared or a running branch cannot switch. */
  function openContent(hit: TranscriptSearchHit | ChatSearchHit): void {
    if (opening) {
      return
    }
    setOpening(true)
    const open = 'segmentId' in hit ? openTranscript(hit) : openChat(hit)
    void open
      .then(onClose)
      .catch((error: unknown) => {
        logger.error('Failed to open content search result:', error)
        setSearchTarget(null)
        toast.error(t('globalSearch.openFailed'))
      })
      .finally(() => setOpening(false))
  }

  const mediaEntries = useMemo<SearchEntry[]>(
    () =>
      downloads.map((record) => ({
        id: `media:${record.id}`,
        title: mediaSearchTitle(record),
        description: [record.channel || record.uploader, record.savedFileName || record.url]
          .filter(Boolean)
          .join(' · '),
        searchText: mediaSearchText(record).toLowerCase(),
        icon: record.type === 'audio' ? Music : Video,
        onSelect: () => {
          onClose()
          void navigate({
            to: '/downloads/$downloadId/transcript',
            params: { downloadId: record.id }
          })
        }
      })),
    [downloads, navigate, onClose]
  )
  const pageEntries = useMemo<SearchEntry[]>(
    () =>
      PAGE_COMMANDS.map((page) => ({
        id: `page:${page.to}`,
        title: t(page.labelKey),
        searchText: `${t(page.labelKey)} ${page.to}`.toLowerCase(),
        icon: page.icon,
        onSelect: () => {
          onClose()
          void navigate({ to: page.to })
        }
      })),
    [navigate, onClose, t]
  )
  const settingsEntries = useMemo<SearchEntry[]>(
    () =>
      SETTINGS_NAV_ITEMS.map((section) => ({
        id: `settings:${section.value}`,
        title: t(section.labelKey),
        searchText:
          `${t(section.labelKey)} ${t('menu.preferences')} ${section.value}`.toLowerCase(),
        icon: section.icon,
        onSelect: () => {
          onClose()
          void navigate({ to: '/settings', search: { tab: section.value } })
        }
      })),
    [navigate, onClose, t]
  )
  const matchingMedia = useMemo(
    () => mediaEntries.filter((entry) => matchesEntry(entry, words)),
    [mediaEntries, words]
  )
  const visibleMedia = matchingMedia.slice(
    0,
    words.length ? MAX_MEDIA_RESULTS : RECENT_MEDIA_RESULTS
  )
  const pages = pageEntries.filter((entry) => matchesEntry(entry, words))
  const sections = words.length ? settingsEntries.filter((entry) => matchesEntry(entry, words)) : []

  return (
    <Command label={t('globalSearch.title')} loop shouldFilter={false} vimBindings={false}>
      <CommandInput
        aria-label={t('globalSearch.title')}
        maxLength={CONTENT_SEARCH_QUERY_LIMIT}
        onValueChange={setQuery}
        placeholder={t('globalSearch.placeholder')}
        value={query}
      />
      <CommandList>
        {content.loading || content.failed ? (
          <p className="px-2 py-3 text-muted-foreground text-sm" role="status">
            {t(content.failed ? 'globalSearch.searchFailed' : 'globalSearch.searching')}
          </p>
        ) : (
          <CommandEmpty>{t('globalSearch.noResults')}</CommandEmpty>
        )}
        {visibleMedia.length ? (
          <CommandGroup
            heading={t(words.length ? 'globalSearch.media' : 'globalSearch.recentMedia')}
          >
            {visibleMedia.map((entry) => (
              <SearchResult entry={entry} key={entry.id} />
            ))}
          </CommandGroup>
        ) : null}
        {content.results.transcripts.length ? (
          <CommandGroup heading={t('globalSearch.subtitles')}>
            {content.results.transcripts.map((hit) => (
              <CommandItem
                disabled={opening}
                key={`subtitle:${hit.segmentId}`}
                onSelect={() => openContent(hit)}
                value={`subtitle:${hit.segmentId}`}
              >
                <Captions aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate">
                    {mediaTitles.get(hit.downloadId) || t('globalSearch.media')} ·{' '}
                    {formatClock(hit.startMs / 1000)}
                  </span>
                  <span className="line-clamp-2 whitespace-pre-wrap break-words text-muted-foreground text-xs">
                    {hit.snippet}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {content.results.messages.length ? (
          <CommandGroup heading={t('globalSearch.chats')}>
            {content.results.messages.map((hit) => (
              <CommandItem
                disabled={opening}
                key={`message:${hit.messageId}`}
                onSelect={() => openContent(hit)}
                value={`message:${hit.messageId}`}
              >
                <MessageSquare aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate">
                    {hit.title ||
                      mediaTitles.get(hit.downloadId) ||
                      t('transcript.promptHistoryChat')}
                  </span>
                  <span className="line-clamp-2 whitespace-pre-wrap break-words text-muted-foreground text-xs">
                    {hit.snippet}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {pages.length ? (
          <CommandGroup heading={t('globalSearch.navigation')}>
            {pages.map((entry) => (
              <SearchResult entry={entry} key={entry.id} />
            ))}
          </CommandGroup>
        ) : null}
        {sections.length ? (
          <CommandGroup heading={t('menu.preferences')}>
            {sections.map((entry) => (
              <SearchResult entry={entry} key={entry.id} />
            ))}
          </CommandGroup>
        ) : null}
        {words.length > 0 && matchingMedia.length > MAX_MEDIA_RESULTS ? (
          <p className="px-2 py-2 text-muted-foreground text-xs" role="status">
            {t('globalSearch.limitHint', { count: MAX_MEDIA_RESULTS })}
          </p>
        ) : null}
        {content.results.hasMore ? (
          <p className="px-2 py-2 text-muted-foreground text-xs" role="status">
            {t('globalSearch.contentLimitHint', { count: CONTENT_SEARCH_RESULT_LIMIT })}
          </p>
        ) : null}
      </CommandList>
      <div className="flex shrink-0 flex-wrap items-center gap-4 border-t px-4 py-3 text-muted-foreground text-xs">
        <span className="flex items-center gap-1.5">
          <CommandShortcut>↑ ↓</CommandShortcut>
          {t('globalSearch.navigate')}
        </span>
        <span className="flex items-center gap-1.5">
          <CommandShortcut>↵</CommandShortcut>
          {t('globalSearch.open')}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <CommandShortcut>Esc</CommandShortcut>
          {t('globalSearch.close')}
        </span>
      </div>
    </Command>
  )
}

/** Make the palette available on every desktop page without affecting other dialogs or IME. */
export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const { t } = useTranslation()
  /** Close without rebuilding the media index when the parent renders. */
  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange])

  useEffect(() => {
    /** Toggle the palette with the platform command shortcut. */
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.altKey ||
        event.shiftKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 'k'
      ) {
        return
      }
      if (
        !open &&
        document.querySelector('[role="dialog"]:not([data-command-dialog]), [role="alertdialog"]')
      ) {
        return
      }
      event.preventDefault()
      onOpenChange(!open)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onOpenChange, open])

  return (
    <CommandDialog
      description={t('globalSearch.description')}
      onOpenChange={onOpenChange}
      open={open}
      title={t('globalSearch.title')}
    >
      <GlobalSearchContent active={open} onClose={handleClose} />
    </CommandDialog>
  )
}
