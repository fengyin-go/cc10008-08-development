import { AUTH_GROUPS } from '../data/drill/dataset'
import { loadState, nextPathId, resetDrillState, saveState } from '../data/drill/drill-store'
import {
  DrillEngineError,
  childrenDisplayTotal,
  createSnapshot,
  expandNode,
  findNode,
  lookupChild,
  validatePath,
} from '../data/drill/engine'
import type {
  DrillPath,
  DrillSnapshot,
  PathConfigInput,
  PathStatus,
  SnapshotNode,
  Viewer,
} from '../data/drill/types'

export interface ServiceResult<T = void> {
  ok: boolean
  message: string
  data?: T
}

const STATUS_FLOW: Record<string, PathStatus> = {
  提交校验: '待校验',
  启用路径: '已启用',
  停用路径: '已停用',
}

// ---------- 授权 ----------

export type AccessLevel = 'manage' | 'readonly' | 'forbidden'

/** 数据归属授权：同组可管理，别组只能只读；共享副本对所有组开放只读。 */
export function pathAccess(path: DrillPath, viewer: Viewer): AccessLevel {
  return path.ownerGroup === viewer.group ? 'manage' : 'readonly'
}

export function snapshotAccess(snapshot: DrillSnapshot, viewer: Viewer): AccessLevel {
  if (snapshot.shared) return 'readonly'
  return snapshot.viewerGroup === viewer.group ? 'manage' : 'readonly'
}

export function listViewers(): Viewer[] {
  return AUTH_GROUPS.map((group) => ({ name: `${group}分析员`, group }))
}

export function currentViewer(): Viewer {
  return loadState().viewer
}

export function switchViewer(viewer: Viewer): ServiceResult<Viewer> {
  const state = loadState()
  saveState({ ...state, viewer })
  return { ok: true, message: `当前查看身份切换为 ${viewer.group}（${viewer.name}），已按该组数据归属重新授权`, data: viewer }
}

// ---------- 路径登记与校验 ----------

function sameCodeExists(paths: DrillPath[], code: string, excludeId?: number): boolean {
  return paths.some((path) => path.code === code && path.id !== excludeId)
}

export function listPaths(): DrillPath[] {
  return loadState().paths
}

export function createPath(input: PathConfigInput, viewer: Viewer): ServiceResult<DrillPath> {
  const state = loadState()
  if (sameCodeExists(state.paths, input.code)) {
    return { ok: false, message: `路径编号「${input.code}」已存在，阻断登记` }
  }
  const validation = validatePath(input)
  if (validation.errors.length > 0) {
    return { ok: false, message: `提交校验未通过：${validation.errors.join('；')}` }
  }
  const now = Date.now()
  const path: DrillPath = {
    ...input,
    id: nextPathId(state),
    status: '草稿',
    version: 1,
    updatedAt: now,
    validationIssues: validation.warnings,
  }
  saveState({ ...state, paths: [...state.paths, path] })
  return {
    ok: true,
    message: `下钻路径已保存为草稿${validation.warnings.length ? `；提示：${validation.warnings.join('；')}` : ''}`,
    data: path,
  }
}

export function updatePath(id: number, patch: PathConfigInput, viewer: Viewer): ServiceResult<DrillPath> {
  const state = loadState()
  const path = state.paths.find((item) => item.id === id)
  if (!path) return { ok: false, message: `没有找到编号为 ${id} 的下钻路径` }
  if (pathAccess(path, viewer) !== 'manage') {
    return { ok: false, message: `越权阻断：路径归属 ${path.ownerGroup}，${viewer.group} 只能查看，不能修改` }
  }
  if (path.status === '已停用') {
    return { ok: false, message: '路径已停用，历史快照只读；如需调整请新建路径副本' }
  }
  if (sameCodeExists(state.paths, patch.code, id)) {
    return { ok: false, message: `路径编号「${patch.code}」已被其他路径占用，阻断修改` }
  }
  const validation = validatePath(patch)
  if (validation.errors.length > 0) {
    return { ok: false, message: `提交校验未通过：${validation.errors.join('；')}` }
  }
  const now = Date.now()
  // 保存即生成新版本：旧快照继续引用冻结配置，不会混入新层级。
  const updated: DrillPath = {
    ...patch,
    id,
    status: path.status,
    version: path.version + 1,
    updatedAt: now,
    validationIssues: validation.warnings,
  }
  saveState({ ...state, paths: state.paths.map((item) => (item.id === id ? updated : item)) })
  return { ok: true, message: `路径已保存并升级为 v${updated.version}；旧快照仍按 v${path.version} 冻结配置可读`, data: updated }
}

/** 模拟另一用户同时修改：直接升版本，正在查看的旧快照不受影响。 */
export function bumpPathVersion(id: number, viewer: Viewer): ServiceResult<DrillPath> {
  const state = loadState()
  const path = state.paths.find((item) => item.id === id)
  if (!path) return { ok: false, message: `没有找到编号为 ${id} 的下钻路径` }
  if (path.status === '已停用') return { ok: false, message: '停用路径不允许再被修改' }
  const now = Date.now()
  const updated: DrillPath = { ...path, version: path.version + 1, updatedAt: now }
  saveState({ ...state, paths: state.paths.map((item) => (item.id === id ? updated : item)) })
  return { ok: true, message: `另一用户已保存 ${path.code}（v${updated.version}）；你正在看的旧快照保持原层级，不会混入新层级`, data: updated }
}

export function transitionPath(id: number, action: string, viewer: Viewer): ServiceResult<DrillPath> {
  const target = STATUS_FLOW[action]
  if (!target) return { ok: false, message: `下钻路径没有登记「${action}」这个动作` }
  const state = loadState()
  const path = state.paths.find((item) => item.id === id)
  if (!path) return { ok: false, message: `没有找到编号为 ${id} 的下钻路径` }
  if (pathAccess(path, viewer) !== 'manage') {
    return { ok: false, message: `越权阻断：${viewer.group} 不是路径归属组，不能执行「${action}」，只能生成只读共享副本` }
  }
  if (path.status === target) return { ok: false, message: `路径已经是「${target}」，不用重复操作` }
  if (path.status === '已停用') return { ok: false, message: '路径已停用，状态不可再变更' }
  if (action === '启用路径') {
    const validation = validatePath(path)
    if (validation.errors.length > 0) {
      return { ok: false, message: `启用被阻断：${validation.errors.join('；')}` }
    }
  }
  const now = Date.now()
  const updated: DrillPath = { ...path, status: target, updatedAt: now }
  let snapshots = state.snapshots
  if (target === '已停用') {
    // 停用：历史快照全部转只读，新查询不能沿用展开位置。
    snapshots = snapshots.map((snapshot) =>
      snapshot.pathId === id
        ? { ...snapshot, locked: true, lockReason: '路径已停用，历史快照只读；新查询不能沿用其展开位置' }
        : snapshot,
    )
  }
  saveState({ ...state, paths: state.paths.map((item) => (item.id === id ? updated : item)), snapshots })
  return { ok: true, message: target === '已停用' ? '路径已停用，其历史快照已全部转为只读' : `路径已${action}，当前状态「${target}」`, data: updated }
}

// ---------- 快照 ----------

export function listSnapshots(pathId?: number): DrillSnapshot[] {
  const state = loadState()
  const snapshots = pathId ? state.snapshots.filter((snapshot) => snapshot.pathId === pathId) : state.snapshots
  return [...snapshots].sort((a, b) => b.createdAt - a.createdAt)
}

export function getSnapshot(id: string): DrillSnapshot | null {
  return loadState().snapshots.find((snapshot) => snapshot.id === id) ?? null
}

function staleReason(snapshot: DrillSnapshot, path: DrillPath | undefined): string | null {
  if (!path) return '路径已被删除，快照仅按冻结配置只读保留'
  if (path.version !== snapshot.pathVersion) {
    return `路径已被更新到 v${path.version}，本快照冻结的是 v${snapshot.pathVersion}，继续展开不会混入新层级`
  }
  return null
}

export function snapshotGuards(snapshot: DrillSnapshot, viewer: Viewer): {
  access: AccessLevel
  staleMessage: string | null
  livePath: DrillPath | undefined
} {
  const path = loadState().paths.find((item) => item.id === snapshot.pathId)
  return { access: snapshotAccess(snapshot, viewer), staleMessage: staleReason(snapshot, path), livePath: path }
}

export function generateSnapshot(pathId: number, viewer: Viewer): ServiceResult<DrillSnapshot> {
  const state = loadState()
  const path = state.paths.find((item) => item.id === pathId)
  if (!path) return { ok: false, message: `没有找到编号为 ${pathId} 的下钻路径` }
  if (path.status === '已停用') {
    return { ok: false, message: '路径已停用，新查询不能沿用其展开位置；请查看既有只读历史快照' }
  }
  const validation = validatePath(path)
  if (validation.errors.length > 0) {
    return { ok: false, message: `阻断生成快照：${validation.errors.join('；')}` }
  }
  const snapshot = createSnapshot(path, viewer, Date.now())
  saveState({ ...state, snapshots: [...state.snapshots, snapshot] })
  return { ok: true, message: `已生成 ${path.code} 快照（默认展开 ${path.defaultExpand} 层，共触发 ${snapshot.computeCount} 次聚合计算）`, data: snapshot }
}

function ensureWritable(snapshot: DrillSnapshot, viewer: Viewer, path: DrillPath | undefined): { ok: false; message: string } | null {
  if (snapshot.locked) return { ok: false, message: snapshot.lockReason ?? '快照已锁定，只读' }
  if (snapshot.shared) return { ok: false, message: '共享副本为只读，不能在别人的口径上继续展开' }
  if (snapshotAccess(snapshot, viewer) !== 'manage') {
    return { ok: false, message: `越权阻断：该快照按 ${snapshot.viewerGroup} 数据归属生成，${viewer.group} 只能查看；可生成只读共享副本` }
  }
  if (path && path.status === '已停用') {
    return { ok: false, message: '路径已停用，历史快照只读，不能继续展开' }
  }
  const stale = staleReason(snapshot, path)
  if (stale) return { ok: false, message: `${stale}；如需新层级请基于最新路径重新生成快照` }
  return null
}

export function expandSnapshotNode(snapshotId: string, nodeId: string, viewer: Viewer): ServiceResult<DrillSnapshot> {
  const state = loadState()
  const index = state.snapshots.findIndex((item) => item.id === snapshotId)
  if (index < 0) return { ok: false, message: '快照不存在或已被清理' }
  const snapshot = state.snapshots[index]
  const path = state.paths.find((item) => item.id === snapshot.pathId)
  const blocked = ensureWritable(snapshot, viewer, path)
  if (blocked) return blocked
  const node = findNode(snapshot, nodeId)
  if (!node) return { ok: false, message: '快照里找不到该节点' }
  if (node.loaded) {
    return { ok: true, message: '该节点此前已计算过，本次展开直接读缓存，未触发第二次聚合计算', data: snapshot }
  }
  try {
    const outcome = expandNode(snapshot, nodeId, Date.now())
    saveState({ ...state, snapshots: [...state.snapshots] })
    return { ok: true, message: `已按路径条件聚合出 ${outcome.nodes.length} 个同层节点，累计计算 ${outcome.computeCount} 次`, data: snapshot }
  } catch (error) {
    return { ok: false, message: error instanceof DrillEngineError ? error.message : '展开失败' }
  }
}

export function lookupSnapshotNode(
  snapshotId: string,
  parentId: string,
  rawValue: string,
  viewer: Viewer,
): ServiceResult<SnapshotNode> {
  const state = loadState()
  const index = state.snapshots.findIndex((item) => item.id === snapshotId)
  if (index < 0) return { ok: false, message: '快照不存在或已被清理' }
  const snapshot = state.snapshots[index]
  const path = state.paths.find((item) => item.id === snapshot.pathId)
  const blocked = ensureWritable(snapshot, viewer, path)
  if (blocked) return blocked
  if (!rawValue.trim()) return { ok: false, message: '请输入要查找的维度取值' }
  try {
    const node = lookupChild(snapshot, parentId, rawValue.trim(), Date.now())
    if (!node) return { ok: false, message: `在当前路径条件下没有取值「${rawValue}」，可能属于其他分支或其他授权组` }
    saveState({ ...state, snapshots: [...state.snapshots] })
    return { ok: true, message: '已单独找到该节点；它不计入父层展示合计', data: node }
  } catch (error) {
    return { ok: false, message: error instanceof DrillEngineError ? error.message : '查找失败' }
  }
}

/** 越权场景：别组不能改动，只能生成只读、可共享的路径副本（按当前查看者本组数据重新聚合）。 */
export function shareReadOnlyCopy(snapshotId: string, viewer: Viewer): ServiceResult<DrillSnapshot> {
  const state = loadState()
  const source = state.snapshots.find((item) => item.id === snapshotId)
  if (!source) return { ok: false, message: '源快照不存在' }
  const path = state.paths.find((item) => item.id === source.pathId)
  if (!path) return { ok: false, message: '源路径已被删除，无法按最新配置生成共享副本' }
  const copy = createSnapshot(path, viewer, Date.now())
  copy.shared = true
  copy.readOnly = true
  copy.sourceSnapshotId = source.id
  copy.locked = false
  copy.lockReason = null
  saveState({ ...state, snapshots: [...state.snapshots, copy] })
  return { ok: true, message: `已为 ${viewer.group} 生成只读共享副本，按本组数据归属重新聚合，源快照不受影响`, data: copy }
}

export function displayTotal(node: SnapshotNode) {
  return childrenDisplayTotal(node)
}

export function resetDrill(): ServiceResult {
  resetDrillState()
  return { ok: true, message: '下钻路径与快照已恢复到示例数据' }
}
