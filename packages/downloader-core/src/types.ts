export type DownloadType = 'video' | 'audio'

export type DownloadStatus =
  | 'pending'
  | 'downloading'
  | 'completed'
  | 'error'
  | 'cancelled'

export interface DownloadProgress {
  percent: number
  currentSpeed?: string
  eta?: string
  downloaded?: string
  total?: string
}

export interface DownloadTask {
  id: string
  url: string
  type: DownloadType
  status: DownloadStatus
  createdAt: number
  startedAt?: number
  completedAt?: number
  progress?: DownloadProgress
  error?: string
}

export interface CreateDownloadInput {
  url: string
  type: DownloadType
  format?: string
  audioFormat?: string
}

export interface VideoFormat {
  formatId: string
  ext: string
  width?: number
  height?: number
  fps?: number
  vcodec?: string
  acodec?: string
  filesize?: number
  filesizeApprox?: number
  formatNote?: string
  tbr?: number
}

export interface VideoInfo {
  id: string
  title: string
  thumbnail?: string
  duration?: number
  formats: VideoFormat[]
}
