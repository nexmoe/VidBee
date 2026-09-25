/**
 * TaskStore — in-memory authoritative index of Task records, indexed by id and
 * by groupKey/status. Only the orchestrator writes here; consumers receive
 * read-only snapshots.
 */
import type { Task, TaskKind, TaskQueueStats, TaskSnapshot, TaskStatus } from '../types'

const STATUSES: readonly TaskStatus[] = [
  'queued',
  'running',
  'processing',
  'paused',
  'retry-scheduled',
  'completed',
  'failed',
  'cancelled'
]

export class TaskStore {
  private readonly byId = new Map<string, Task>()
  private readonly byGroup = new Map<string, Set<string>>()
  private readonly byStatus = new Map<TaskStatus, Set<string>>()

  constructor() {
    for (const s of STATUSES) {
      this.byStatus.set(s, new Set())
    }
  }

  has(id: string): boolean {
    return this.byId.has(id)
  }

  get(id: string): Readonly<Task> | undefined {
    return this.byId.get(id)
  }

  /** Insert a new task. Throws if id already exists. */
  insert(task: Task): void {
    if (this.byId.has(task.id)) {
      throw new Error(`TaskStore: duplicate id ${task.id}`)
    }
    this.byId.set(task.id, task)
    this.bucket(this.byGroup, task.groupKey).add(task.id)
    this.byStatus.get(task.status)!.add(task.id)
  }

  /**
   * Replace the existing record. Maintains index consistency for status and
   * groupKey transitions. Throws if the id is missing.
   */
  update(next: Task): void {
    const prev = this.byId.get(next.id)
    if (!prev) {
      throw new Error(`TaskStore: missing id ${next.id}`)
    }
    if (prev.status !== next.status) {
      this.byStatus.get(prev.status)?.delete(prev.id)
      this.byStatus.get(next.status)?.add(next.id)
    }
    if (prev.groupKey !== next.groupKey) {
      const oldBucket = this.byGroup.get(prev.groupKey)
      oldBucket?.delete(prev.id)
      if (oldBucket && oldBucket.size === 0) {
        this.byGroup.delete(prev.groupKey)
      }
      this.bucket(this.byGroup, next.groupKey).add(next.id)
    }
    this.byId.set(next.id, next)
  }

  /** Remove a record (used by removeFromHistory). */
  remove(id: string): boolean {
    const prev = this.byId.get(id)
    if (!prev) {
      return false
    }
    this.byId.delete(id)
    this.byStatus.get(prev.status)?.delete(id)
    const groupSet = this.byGroup.get(prev.groupKey)
    groupSet?.delete(id)
    if (groupSet && groupSet.size === 0) {
      this.byGroup.delete(prev.groupKey)
    }
    return true
  }

  snapshot(id: string): TaskSnapshot | undefined {
    const t = this.byId.get(id)
    return t ? { task: t } : undefined
  }

  list(opts?: {
    query?: string
    kind?: TaskKind
    status?: TaskStatus
    groupKey?: string
    parentId?: string
    limit?: number
    cursor?: string | null
  }): { tasks: Task[]; nextCursor: string | null } {
    let candidates: Iterable<string>
    if (opts?.status) {
      candidates = this.byStatus.get(opts.status) ?? []
    } else if (opts?.groupKey) {
      candidates = this.byGroup.get(opts.groupKey) ?? []
    } else {
      candidates = this.byId.keys()
    }

    const all: Task[] = []
    const query = opts?.query?.trim().toLocaleLowerCase()
    for (const id of candidates) {
      const t = this.byId.get(id)
      if (!t) {
        continue
      }
      if (opts?.groupKey && t.groupKey !== opts.groupKey) {
        continue
      }
      if (opts?.parentId && t.parentId !== opts.parentId) {
        continue
      }
      if (opts?.kind && t.kind !== opts.kind) {
        continue
      }
      if (
        query &&
        !`${t.id}\n${t.input.title ?? ''}\n${t.input.url}`.toLocaleLowerCase().includes(query)
      ) {
        continue
      }
      all.push(t)
    }
    all.sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return a.createdAt - b.createdAt
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })

    let startIdx = 0
    if (opts?.cursor) {
      startIdx = all.findIndex((t) => t.id === opts.cursor)
      startIdx = startIdx < 0 ? 0 : startIdx + 1
    }
    const limit = opts?.limit ?? 100
    const slice = all.slice(startIdx, startIdx + limit)
    const nextCursor =
      startIdx + slice.length < all.length && slice.length > 0 ? slice[slice.length - 1]!.id : null
    return { tasks: slice, nextCursor }
  }

  stats(capacity: number): TaskQueueStats {
    const byStatus: Record<TaskStatus, number> = {
      queued: 0,
      running: 0,
      processing: 0,
      paused: 0,
      'retry-scheduled': 0,
      completed: 0,
      failed: 0,
      cancelled: 0
    }
    for (const s of STATUSES) {
      byStatus[s] = this.byStatus.get(s)?.size ?? 0
    }
    const perGroup: Record<string, number> = {}
    for (const [k, set] of this.byGroup) {
      perGroup[k] = set.size
    }
    return {
      total: this.byId.size,
      byStatus,
      running: byStatus.running,
      queued: byStatus.queued,
      capacity,
      perGroup
    }
  }

  size(): number {
    return this.byId.size
  }

  private bucket<K, V>(map: Map<K, Set<V>>, key: K): Set<V> {
    let s = map.get(key)
    if (!s) {
      s = new Set<V>()
      map.set(key, s)
    }
    return s
  }
}
