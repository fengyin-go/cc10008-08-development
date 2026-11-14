import { AUTH_GROUPS, SEED_PATHS } from './dataset'
import { createSnapshot, validatePath } from './engine'
import type { DrillPath, DrillSnapshot, Viewer } from './types'

/** 下钻领域独立存储键，和通用登记数据互不干扰。 */
export const DRILL_STORAGE_KEY = 'interactive-analytics-lab:drill'

export interface DrillState {
  paths: DrillPath[]
  snapshots: DrillSnapshot[]
  viewer: Viewer
}

function seedState(): DrillState {
  const now = Date.now()
  const paths: DrillPath[] = SEED_PATHS.map((item, index) => {
    const { status, ...config } = item
    const validation = validatePath(config)
    return {
      ...config,
      id: index + 1,
      status,
      version: 1,
      updatedAt: now,
      validationIssues: [...validation.errors, ...validation.warnings],
    }
  })
  const stopped = paths.find((path) => path.status === '已停用')
  const snapshots: DrillSnapshot[] = []
  if (stopped) {
    // 停用路径保留一份历史快照：新查询不能再用它，但旧快照依旧可读、只读。
    const legacy = createSnapshot(stopped, { name: '值班管理员', group: stopped.ownerGroup }, now)
    legacy.locked = true
    legacy.lockReason = '路径已停用，历史快照只读；新查询不能沿用其展开位置'
    snapshots.push(legacy)
  }
  return {
    paths,
    snapshots,
    viewer: { name: '值班管理员', group: AUTH_GROUPS[0] },
  }
}

let cache: DrillState | null = null

function readStorage(): DrillState {
  const fallback = seedState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(DRILL_STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(DRILL_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as DrillState
    if (!Array.isArray(parsed.paths) || !Array.isArray(parsed.snapshots) || !parsed.viewer) {
      throw new Error('下钻存储结构不完整')
    }
    return parsed as DrillState
  } catch {
    window.localStorage.setItem(DRILL_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

export function loadState(): DrillState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveState(state: DrillState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(DRILL_STORAGE_KEY, JSON.stringify(state))
  }
}

export function resetDrillState(): DrillState {
  const fresh = seedState()
  saveState(fresh)
  return fresh
}

export function nextPathId(state: DrillState): number {
  return state.paths.reduce((max, path) => Math.max(max, path.id), 0) + 1
}
