import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { ipcServices } from '@renderer/lib/ipc'
import type { AiPrompt } from '@shared/ai-types'
import type { GitHubSkillSource } from '@shared/skill-install'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Inspect a GitHub link and let the user install one skill with its supporting files. */
export function GitHubSkillDialog({
  open,
  onOpenChange,
  onInstalled
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInstalled: (skill: AiPrompt) => Promise<void>
}) {
  const { t } = useTranslation()
  const urlId = useId()
  const skillId = useId()
  const [url, setUrl] = useState('')
  const [source, setSource] = useState<GitHubSkillSource | null>(null)
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const installed = useRef<AiPrompt | null>(null)

  /** Resolve the link first, then install only the explicitly selected immutable skill. */
  async function submit(): Promise<void> {
    if (busy) {
      return
    }
    setBusy(true)
    setError('')
    try {
      if (source) {
        const skill = await ipcServices.ai.importGitHubSkill({
          repository: source.repository,
          revision: source.revision,
          path
        })
        installed.current = skill
        onOpenChange(false)
      } else {
        const result = await ipcServices.ai.inspectGitHubSkills(url)
        setSource(result)
        setPath(result.paths[0])
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings.ai.skillInstallError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      onOpenChange={(next) => !busy && onOpenChange(next)}
      onOpenChangeComplete={(next) => {
        if (!next) {
          const skill = installed.current
          installed.current = null
          setUrl('')
          setSource(null)
          setPath('')
          setError('')
          if (skill) {
            void onInstalled(skill)
          }
        }
      }}
      open={open}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.ai.importGitHubSkill')}</DialogTitle>
          <DialogDescription>{t('settings.ai.githubSkillDescription')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={urlId}>{t('settings.ai.githubSkillUrl')}</Label>
            <Input
              autoFocus
              disabled={busy}
              id={urlId}
              onChange={(event) => {
                setUrl(event.currentTarget.value)
                setSource(null)
                setPath('')
                setError('')
              }}
              placeholder="https://github.com/owner/repository"
              required
              type="url"
              value={url}
            />
          </div>
          {source ? (
            <div className="space-y-2">
              <Label htmlFor={skillId}>{t('settings.ai.selectSkill')}</Label>
              <select
                className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                disabled={busy}
                id={skillId}
                onChange={(event) => setPath(event.currentTarget.value)}
                value={path}
              >
                {source.paths.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {error ? (
            <p className="break-words text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {t('download.cancel')}
            </Button>
            <Button disabled={busy || !url.trim()} type="submit">
              {busy
                ? t('settings.ai.skillInstalling')
                : t(source ? 'settings.ai.installSkill' : 'settings.ai.findSkills')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
