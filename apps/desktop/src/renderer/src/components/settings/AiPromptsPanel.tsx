import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Input } from '@renderer/components/ui/input'
import { Item } from '@renderer/components/ui/item'
import { TabItem, TabPanel, Tabs, TabsList } from '@renderer/components/ui/tabs'
import { aiPromptLabel } from '@renderer/lib/ai-prompt-label'
import { ipcServices } from '@renderer/lib/ipc'
import { logger } from '@renderer/lib/logger'
import { agentChatLaunchDraftAtom } from '@renderer/store/agent-chat-launch'
import { aiPromptDescription } from '@shared/ai-prompts'
import type { AiPrompt, AiSettingsSnapshot } from '@shared/ai-types'
import { MAX_SKILL_UPLOAD_BYTES } from '@shared/skill-install'
import { useNavigate } from '@tanstack/react-router'
import { useSetAtom } from 'jotai'
import {
  ChevronDown,
  FolderOpen,
  Github,
  Plus,
  RotateCcw,
  Search,
  SquarePen,
  Upload
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { GitHubSkillDialog } from './GitHubSkillDialog'
import { SkillDetailsDialog } from './SkillDetailsDialog'

const SKILL_CATEGORIES = [
  { value: 'all', labelKey: 'settings.ai.allSkills' },
  { value: 'personal', labelKey: 'settings.ai.personalSkills' },
  { value: 'builtin', labelKey: 'settings.ai.builtInSkills' }
] as const

/** Render a compact skill card that opens its details. */
function SkillCard({ prompt, onOpen }: { prompt: AiPrompt; onOpen: (prompt: AiPrompt) => void }) {
  const { t } = useTranslation()
  const label = aiPromptLabel(prompt, t)

  return (
    <Item
      className="relative min-w-0 flex-col flex-nowrap items-stretch gap-2 border-0"
      rounded="both"
      size="sm"
      variant="muted"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="min-w-0 flex-1 font-medium text-sm leading-5">
          <button
            className="w-full cursor-pointer truncate text-left after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
            onClick={() => onOpen(prompt)}
            title={label}
            type="button"
          >
            {label}
          </button>
        </h3>
        {prompt.autoRun ? (
          <Badge className="shrink-0" variant="secondary">
            {t('settings.ai.skillAutoRun')}
          </Badge>
        ) : null}
      </div>
      <p
        className="w-full min-w-0 truncate text-muted-foreground text-sm"
        title={aiPromptDescription(prompt, t)}
      >
        {aiPromptDescription(prompt, t)}
      </p>
      {prompt.skillError ? (
        <p className="line-clamp-2 break-words text-destructive text-xs">{prompt.skillError}</p>
      ) : null}
    </Item>
  )
}

/**
 * Search, filter and manage the installed skill library.
 */
export function AiPromptsPanel() {
  const { i18n, t } = useTranslation()
  const navigate = useNavigate()
  const setLaunchDraft = useSetAtom(agentChatLaunchDraftAtom)
  const [query, setQuery] = useState('')
  const [snapshot, setSnapshot] = useState<AiSettingsSnapshot | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<AiPrompt | null>(null)
  const [githubOpen, setGithubOpen] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [preferencesSaving, setPreferencesSaving] = useState(false)
  const pendingDraft = useRef<string | null>(null)
  const importInput = useRef<HTMLInputElement>(null)

  /**
   * Load prompts from the main process.
   */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      setSnapshot(await ipcServices.ai.getSnapshot())
    } catch (error) {
      logger.error('Failed to load AI prompts', error)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const listener = window.api.on('ai:settings-changed', () => {
      void refresh()
    })
    return () => window.api.removeListener('ai:settings-changed', listener)
  }, [refresh])

  useEffect(() => {
    if (
      selectedSkill &&
      snapshot &&
      !snapshot.prompts.some((skill) => skill.name === selectedSkill.name)
    ) {
      setDialogOpen(false)
    }
  }, [selectedSkill, snapshot])

  /** Open the installed skill's read-only details. */
  const openDetails = (prompt: AiPrompt): void => {
    pendingDraft.current = null
    setSelectedSkill(prompt)
    setDialogOpen(true)
  }

  /**
   * Remove the skill currently shown in the details dialog.
   */
  const handleDelete = async (): Promise<void> => {
    if (!selectedSkill) {
      return
    }
    try {
      setSnapshot(await ipcServices.ai.deletePrompt(selectedSkill.name))
      setDialogOpen(false)
    } catch (error) {
      logger.error('Failed to delete AI prompt', error)
      toast.error(t('settings.ai.saveError'))
    }
  }

  /** Save sidebar visibility or automatic execution independently for the selected skill. */
  const handlePreferenceChange = async (
    preference: 'autoRun' | 'showInTranscript',
    value: boolean
  ): Promise<void> => {
    if (!selectedSkill || preferencesSaving) {
      return
    }
    const id = selectedSkill.name
    setPreferencesSaving(true)
    try {
      const updated =
        preference === 'autoRun'
          ? await ipcServices.ai.setSkillAutoRun({ name: id, autoRun: value })
          : await ipcServices.ai.setSkillTranscriptVisibility({ name: id, showInTranscript: value })
      setSnapshot(updated)
      setSelectedSkill((current) =>
        current?.name === id
          ? (updated.prompts.find((prompt) => prompt.name === id) ?? current)
          : current
      )
    } catch (error) {
      logger.error('Failed to save skill preferences', error)
      toast.error(t('settings.ai.saveError'))
    } finally {
      setPreferencesSaving(false)
    }
  }

  /**
   * Re-insert any missing built-in prompts.
   */
  const handleRestore = async (): Promise<void> => {
    try {
      setSnapshot(await ipcServices.ai.restoreDefaultPrompts())
    } catch (error) {
      logger.error('Failed to restore default prompts', error)
      toast.error(t('settings.ai.saveError'))
    }
  }

  /** Refresh the library and show the newly installed skill's details. */
  async function onInstalled(skill: AiPrompt): Promise<void> {
    await refresh()
    openDetails(skill)
  }

  /** Fork the official skill before exposing a writable personal directory. */
  async function customizeSkill(): Promise<void> {
    if (!selectedSkill || installing) {
      return
    }
    setInstalling(true)
    try {
      await onInstalled(await ipcServices.ai.customizeSkill(selectedSkill.name))
    } catch (error) {
      logger.error('Failed to create custom skill copy', error)
      toast.error(t('settings.ai.saveError'))
    } finally {
      setInstalling(false)
    }
  }

  /** Upload a document or packaged skill without executing its supporting scripts. */
  async function importSkill(file?: File): Promise<void> {
    if (!file || installing) {
      return
    }
    setInstalling(true)
    try {
      if (file.size > MAX_SKILL_UPLOAD_BYTES) {
        throw new Error(t('settings.ai.skillUploadTooLarge'))
      }
      const skill = await ipcServices.ai.importSkillUpload({
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer())
      })
      await onInstalled(skill)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.ai.saveError'))
    } finally {
      setInstalling(false)
      if (importInput.current) {
        importInput.current.value = ''
      }
    }
  }

  /** Export the portable source document independently of its auto-run preference. */
  async function exportSkill(prompt: AiPrompt): Promise<void> {
    try {
      await ipcServices.fs.saveTextFile({
        content: await ipcServices.ai.exportSkillDocument(prompt.name),
        defaultFileName: `${prompt.name}.SKILL.md`
      })
    } catch {
      toast.error(t('settings.ai.saveError'))
    }
  }

  /** Open only the managed library so supporting resources can be edited locally. */
  async function openDirectory(id?: string): Promise<void> {
    try {
      await ipcServices.ai.openSkillDirectory(id)
    } catch {
      toast.error(t('settings.ai.saveError'))
    }
  }

  /** Prepare an editable request in a fresh chat without sending a model request. */
  function launchChatDraft(text: string): void {
    setLaunchDraft(text)
    void navigate({ to: '/chat', search: {} }).catch((error: unknown) => {
      setLaunchDraft(null)
      logger.error('Failed to open a skill conversation', error)
      toast.error(t('settings.ai.saveError'))
    })
  }

  /** Close skill details before navigating, or open the creation draft directly from the menu. */
  function trySkill(text: string): void {
    if (pendingDraft.current) {
      return
    }
    if (!dialogOpen) {
      launchChatDraft(text)
      return
    }
    pendingDraft.current = text
    setDialogOpen(false)
  }

  /** Release retained content and navigate only after the default exit animation finishes. */
  function handleDialogComplete(open: boolean): void {
    if (open || dialogOpen) {
      return
    }
    const draft = pendingDraft.current
    pendingDraft.current = null
    setSelectedSkill(null)
    if (!draft) {
      return
    }
    launchChatDraft(draft)
  }

  const prompts = snapshot?.prompts ?? []
  const normalizedQuery = query.trim().toLocaleLowerCase(i18n.language)
  const matchingPrompts = prompts.filter((prompt) =>
    `${aiPromptLabel(prompt, t)} ${aiPromptDescription(prompt, t)}`
      .toLocaleLowerCase(i18n.language)
      .includes(normalizedQuery)
  )

  return (
    <div className="@container space-y-4">
      <input
        accept=".md,.zip"
        className="hidden"
        onChange={(event) => void importSkill(event.currentTarget.files?.[0])}
        ref={importInput}
        type="file"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={t('settings.ai.searchSkills')}
            className="pl-9"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t('settings.ai.searchSkills')}
            type="search"
            value={query}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            aria-label={t('settings.ai.openSkillFolder')}
            onClick={() => void openDirectory()}
            title={t('settings.ai.openSkillFolder')}
            type="button"
            variant="outline"
          >
            <FolderOpen />
            <span className="@min-[32rem]:inline hidden">{t('settings.ai.openSkillFolder')}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={installing} type="button">
                <Plus />
                {t(installing ? 'settings.ai.skillInstalling' : 'settings.ai.addSkill')}
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => trySkill(t('settings.ai.createSkillRequest'))}>
                <SquarePen />
                {t('settings.ai.createSkillWithVidbee')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => importInput.current?.click()}>
                <Upload />
                {t('settings.ai.uploadSkill')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setGithubOpen(true)}>
                <Github />
                {t('settings.ai.importGitHubSkill')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void handleRestore()}>
                <RotateCcw />
                {t('settings.ai.restorePresets')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <Tabs className="space-y-3" defaultValue="all">
        <TabsList
          aria-label={t('settings.promptsTab')}
          className="self-start rounded-md [&>div.z-20]:rounded-sm [&>div]:rounded-[max(0px,calc(var(--radius)-6px))]"
        >
          {SKILL_CATEGORIES.map((category) => (
            <TabItem key={category.value} label={t(category.labelKey)} value={category.value} />
          ))}
        </TabsList>
        {SKILL_CATEGORIES.map((category) => {
          const visiblePrompts = matchingPrompts.filter(
            (prompt) =>
              category.value === 'all' ||
              (category.value === 'builtin' ? prompt.isPreset : !prompt.isPreset)
          )

          return (
            <TabPanel aria-busy={!snapshot} key={category.value} value={category.value}>
              {snapshot ? (
                <div className="grid @min-[36rem]:grid-cols-2 grid-cols-1 gap-2">
                  {visiblePrompts.map((prompt) => (
                    <SkillCard key={prompt.name} onOpen={openDetails} prompt={prompt} />
                  ))}
                  {visiblePrompts.length === 0 ? (
                    <p
                      className="col-span-full rounded-md bg-muted/40 px-4 py-8 text-center text-muted-foreground text-sm"
                      role="status"
                    >
                      {t('settings.ai.noSkillsFound')}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="py-12 text-center text-muted-foreground text-sm" role="status">
                  {t('transcript.promptLoading')}
                </p>
              )}
            </TabPanel>
          )
        })}
      </Tabs>
      <p className="text-muted-foreground text-xs leading-relaxed">{t('settings.ai.skillHelp')}</p>
      <GitHubSkillDialog onInstalled={onInstalled} onOpenChange={setGithubOpen} open={githubOpen} />
      <SkillDetailsDialog
        onAutoRunChange={(value) => handlePreferenceChange('autoRun', value)}
        onCustomize={selectedSkill?.isPreset && !installing ? customizeSkill : undefined}
        onDelete={selectedSkill && !selectedSkill.isPreset ? handleDelete : undefined}
        onExport={selectedSkill ? () => exportSkill(selectedSkill) : undefined}
        onOpenChange={setDialogOpen}
        onOpenChangeComplete={handleDialogComplete}
        onOpenDirectory={
          selectedSkill && !selectedSkill.isPreset
            ? () => openDirectory(selectedSkill.name)
            : undefined
        }
        onTranscriptVisibilityChange={(value) => handlePreferenceChange('showInTranscript', value)}
        onTry={trySkill}
        open={dialogOpen}
        preferencesSaving={preferencesSaving}
        prompt={prompts.find((prompt) => prompt.name === selectedSkill?.name) ?? selectedSkill}
      />
    </div>
  )
}
