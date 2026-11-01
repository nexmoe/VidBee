export const MAX_SKILL_UPLOAD_BYTES = 10 * 1024 * 1024

export interface GitHubSkillSource {
  repository: string
  revision: string
  paths: string[]
}

export interface GitHubSkillInstallInput {
  repository: string
  revision: string
  path: string
}
