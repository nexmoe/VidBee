import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useTranslation } from 'react-i18next'
import type { VideoInfo } from '../../../../shared/types'

export interface AudioExtractorState {
  extractFormat: string
  extractQuality: string
}

interface AudioExtractorProps {
  videoInfo: VideoInfo
  state: AudioExtractorState
  onStateChange: (state: Partial<AudioExtractorState>) => void
}

export function AudioExtractor({
  videoInfo: _videoInfo,
  state,
  onStateChange
}: AudioExtractorProps) {
  const { t } = useTranslation()
  const { extractFormat, extractQuality } = state

  const audioFormats = [
    { value: 'mp3', label: 'MP3' },
    { value: 'm4a', label: 'M4A' },
    { value: 'opus', label: 'Opus' },
    { value: 'wav', label: 'WAV' },
    { value: 'flac', label: 'FLAC' },
    { value: 'alac', label: 'ALAC' },
    { value: 'vorbis', label: 'Vorbis (OGG)' }
  ]

  const qualities = [
    { value: '0', label: t('audioExtract.best') },
    { value: '2', label: t('audioExtract.good') },
    { value: '5', label: t('audioExtract.normal') },
    { value: '8', label: t('audioExtract.bad') },
    { value: '10', label: t('audioExtract.worst') }
  ]

  return (
    <Card className="border-2 border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{t('audioExtract.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2.5">
            <Label className="text-sm font-semibold">{t('audioExtract.selectFormat')}</Label>
            <Select
              value={extractFormat}
              onValueChange={(value) => onStateChange({ extractFormat: value })}
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {audioFormats.map((format) => (
                  <SelectItem key={format.value} value={format.value}>
                    {format.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2.5">
            <Label className="text-sm font-semibold">{t('audioExtract.selectQuality')}</Label>
            <Select
              value={extractQuality}
              onValueChange={(value) => onStateChange({ extractQuality: value })}
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {qualities.map((quality) => (
                  <SelectItem key={quality.value} value={quality.value}>
                    {quality.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
