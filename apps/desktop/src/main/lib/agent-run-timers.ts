import type { AgentFailure } from '../../shared/agent-errors'

const INACTIVITY_MS = 5 * 60 * 1000
const WALL_CLOCK_MS = 60 * 60 * 1000
const APPROVAL_MS = 10 * 60 * 1000
const TOOL_CEILING_MS = {
  media: 30 * 60 * 1000,
  management: 3 * 60 * 1000,
  default: 5 * 60 * 1000
} as const

export type AgentToolTimerCategory = keyof typeof TOOL_CEILING_MS

/**
 * Three explicit clocks for one agent run: inactivity, per-tool ceiling, and wall cap.
 * Approval wait counts toward none of them. The tool ceiling starts over after a decision.
 */
export class AgentRunTimers {
  private inactivity: ReturnType<typeof setTimeout> | undefined
  private tool: ReturnType<typeof setTimeout> | undefined
  private wall: ReturnType<typeof setTimeout> | undefined
  private approval: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private approvalPaused = false
  private toolCategory: AgentToolTimerCategory | undefined
  private wallRemainingMs = WALL_CLOCK_MS
  private wallStartedAt: number | undefined
  private readonly onExpire: (failure: AgentFailure) => void
  private readonly onApprovalTimeout: () => void

  constructor(input: {
    onExpire: (failure: AgentFailure) => void
    onApprovalTimeout?: () => void
  }) {
    this.onExpire = input.onExpire
    this.onApprovalTimeout = input.onApprovalTimeout ?? (() => undefined)
    this.armWall(WALL_CLOCK_MS)
    this.armInactivity()
  }

  /**
   * Any persisted event, including tool progress, resets the inactivity clock.
   * Does not refresh the per-tool ceiling.
   */
  activity(): void {
    if (this.disposed || this.approvalPaused) {
      return
    }
    this.armInactivity()
  }

  /**
   * Arm the per-tool ceiling for the active tool category.
   * A pending approval keeps the ceiling down until the user decides.
   *
   * @param category Media, management, or default bound.
   */
  toolStarted(category: AgentToolTimerCategory): void {
    if (this.disposed) {
      return
    }
    this.toolCategory = category
    if (this.approvalPaused) {
      return
    }
    this.armTool(category)
  }

  /** Clear the per-tool ceiling when the active tool finishes. */
  toolFinished(): void {
    this.toolCategory = undefined
    this.clearToolTimer()
  }

  /**
   * Pause inactivity, the tool ceiling, and the wall clock while the user decides.
   * Arms the 10-minute auto-deny. A decision restarts the tool ceiling from zero
   * and continues the wall clock with the active time that was left.
   *
   * @param pending True when at least one approval is outstanding.
   */
  approvalPending(pending: boolean): void {
    if (this.disposed) {
      return
    }
    if (this.approval) {
      clearTimeout(this.approval)
      this.approval = undefined
    }
    if (pending) {
      if (!this.approvalPaused) {
        this.approvalPaused = true
        if (this.inactivity) {
          clearTimeout(this.inactivity)
          this.inactivity = undefined
        }
        this.clearToolTimer()
        this.pauseWall()
      }
      this.approval = setTimeout(() => {
        this.approval = undefined
        this.onApprovalTimeout()
      }, APPROVAL_MS)
      return
    }
    const wasPaused = this.approvalPaused
    this.approvalPaused = false
    if (wasPaused) {
      this.resumeWall()
      if (this.toolCategory) {
        this.armTool(this.toolCategory)
      }
    }
    this.armInactivity()
  }

  /** Cancel every clock. Safe to call more than once. */
  dispose(): void {
    this.disposed = true
    this.toolCategory = undefined
    this.wallStartedAt = undefined
    for (const timer of [this.inactivity, this.tool, this.wall, this.approval]) {
      if (timer) {
        clearTimeout(timer)
      }
    }
    this.inactivity = undefined
    this.tool = undefined
    this.wall = undefined
    this.approval = undefined
  }

  /**
   * Classify a tool name into a ceiling bucket.
   *
   * @param name Tool identifier from the registry.
   */
  static categoryForTool(name: string): AgentToolTimerCategory {
    if (name === 'capture_frames' || name === 'create_clip' || name === 'read_artifact') {
      return 'media'
    }
    if (
      name.startsWith('manage_') ||
      name === 'create_task' ||
      name === 'update_settings' ||
      name === 'manage_ai_settings' ||
      name === 'manage_asr_model'
    ) {
      return 'management'
    }
    return 'default'
  }

  /** Restart the 5-minute inactivity clock. */
  private armInactivity(): void {
    if (this.inactivity) {
      clearTimeout(this.inactivity)
    }
    this.inactivity = setTimeout(() => {
      this.expire({
        code: 'TIMEOUT',
        message: 'The agent made no progress for 5 minutes.',
        retryable: false
      })
    }, INACTIVITY_MS)
  }

  /**
   * Restart the per-tool ceiling from its full bound. Progress does not refresh it.
   *
   * @param category Active tool bucket.
   */
  private armTool(category: AgentToolTimerCategory): void {
    this.clearToolTimer()
    this.tool = setTimeout(() => {
      this.expire({
        code: 'TIMEOUT',
        message: 'A tool exceeded its time limit without finishing.',
        retryable: false
      })
    }, TOOL_CEILING_MS[category])
  }

  /** Drop the tool timeout and keep the category so a decision can arm a fresh ceiling. */
  private clearToolTimer(): void {
    if (this.tool) {
      clearTimeout(this.tool)
      this.tool = undefined
    }
  }

  /**
   * Start the wall clock for the active time still allowed.
   *
   * @param durationMs Milliseconds of active run time remaining.
   */
  private armWall(durationMs: number): void {
    if (this.wall) {
      clearTimeout(this.wall)
    }
    this.wallRemainingMs = durationMs
    this.wallStartedAt = Date.now()
    this.wall = setTimeout(() => {
      this.expire({
        code: 'TIMEOUT',
        message: 'The agent run reached its 60-minute time limit.',
        retryable: false
      })
    }, durationMs)
  }

  /** Freeze the wall clock and remember the active time still left. */
  private pauseWall(): void {
    if (this.wallStartedAt === undefined) {
      return
    }
    this.wallRemainingMs = Math.max(0, this.wallRemainingMs - (Date.now() - this.wallStartedAt))
    if (this.wall) {
      clearTimeout(this.wall)
      this.wall = undefined
    }
    this.wallStartedAt = undefined
  }

  /** Continue the wall clock from the active time saved when approval began. */
  private resumeWall(): void {
    if (this.disposed || this.wallStartedAt !== undefined) {
      return
    }
    this.armWall(this.wallRemainingMs)
  }

  /**
   * Fire the expire callback once and freeze further clocks.
   *
   * @param failure Timeout failure to report.
   */
  private expire(failure: AgentFailure): void {
    if (this.disposed) {
      return
    }
    this.dispose()
    this.onExpire(failure)
  }
}
