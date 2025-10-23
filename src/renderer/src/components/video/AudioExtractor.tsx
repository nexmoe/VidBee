import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VideoInfo } from '../../../../shared/types'

interface AudioExtractorProps {
  videoInfo: VideoInfo
  onExtract: (type: 'extract') => void
}

export function AudioExtractor({ onExtract }: AudioExtractorProps) {
  const { t } = useTranslation()
  const [extractFormat, setExtractFormat] = useState('mp3')
  const [extractQuality, setExtractQuality] = useState('5')

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
    <Card>
      <CardHeader>
        <CardTitle>{t('audioExtract.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>{t('audioExtract.selectFormat')}</Label>
          <Select value={extractFormat} onValueChange={setExtractFormat}>
            <SelectTrigger>
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

        <div className="space-y-2">
          <Label>{t('audioExtract.selectQuality')}</Label>
          <Select value={extractQuality} onValueChange={setExtractQuality}>
            <SelectTrigger>
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

        <Button onClick={() => onExtract('extract')} className="w-full">
          {t('audioExtract.extract')}
        </Button>
      </CardContent>
    </Card>
  )
}
