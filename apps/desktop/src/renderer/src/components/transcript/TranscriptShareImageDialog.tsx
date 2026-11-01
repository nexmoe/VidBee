import { aiPromptLabel } from '@renderer/lib/ai-prompt-label'
import { captureShareImageBlob, copyShareImageBlob } from '@renderer/lib/capture-prompt-share'
import { ipcServices } from '@renderer/lib/ipc'
import { agentTaskAiSnapshotAtom } from '@renderer/store/agent-tasks'
import type { ShareCardPayload } from '@shared/types/share-card'
import { AgentShareImageDialog } from '@vidbee/ui/components/agent-share-image-dialog'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AgentResponseShareCard } from './AgentResponseShareCard'

/** Adapt native capture, save dialogs and the macOS share sheet to the common share UI. */
export function TranscriptShareImageDialog({
  fileName,
  onOpenChange,
  open,
  payload
}: {
  fileName: string
  onOpenChange: (open: boolean) => void
  open: boolean
  payload: ShareCardPayload | null
}) {
  const { t } = useTranslation()
  const skills = useAtomValue(agentTaskAiSnapshotAtom)?.prompts
  const sharePayload = useMemo(
    () =>
      payload?.kind === 'prompt'
        ? {
            ...payload,
            userSkills:
              payload.userSkills ??
              skills?.map((skill) => ({ name: skill.name, label: aiPromptLabel(skill, t) }))
          }
        : payload,
    [payload, skills, t]
  )
  const [platform, setPlatform] = useState(() =>
    /Mac|darwin/i.test(navigator.userAgent) ? 'darwin' : ''
  )
  useEffect(() => {
    if (!open) {
      return
    }
    let cancelled = false
    void ipcServices.app
      .getPlatform()
      .then((value) => {
        if (!cancelled) {
          setPlatform(value)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open])
  if (!open) {
    return null
  }
  return (
    <AgentShareImageDialog
      captureImage={() => {
        if (!sharePayload) {
          return Promise.reject(new Error('Share card is not mounted'))
        }
        return captureShareImageBlob(sharePayload)
      }}
      copyImage={copyShareImageBlob}
      fileName={fileName}
      identity={sharePayload}
      onNativeShare={
        platform === 'darwin'
          ? async (blob, name) =>
              ipcServices.fs.shareFile({ data: await blob.arrayBuffer(), fileName: name })
          : undefined
      }
      onNotice={(key, error) => (error ? toast.error(t(key)) : toast.success(t(key)))}
      onOpenChange={onOpenChange}
      open={open}
      preview={sharePayload ? <AgentResponseShareCard payload={sharePayload} /> : null}
      saveImage={async ({ split, imageCount, blob }) => {
        if (!(split || blob)) {
          throw new Error('Share image is not ready')
        }
        if (!sharePayload) {
          throw new Error('Share card is not mounted')
        }
        const saved = split
          ? await ipcServices.fs.saveSplitShareImage({
              payload: sharePayload,
              defaultFileName: fileName,
              imageCount
            })
          : await ipcServices.fs.saveBinaryFile({
              data: await (blob ?? new Blob()).arrayBuffer(),
              defaultFileName: fileName
            })
        return Boolean(saved)
      }}
      t={t}
    />
  )
}
