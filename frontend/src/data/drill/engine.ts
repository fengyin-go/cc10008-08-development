import { DIMENSIONS, FACTS, MAX_LEVELS, METRICS } from './dataset'
import type {
  DrillFact,
  DrillPath,
  DrillSnapshot,
  ExpandOutcome,
  FrozenPathConfig,
  MetricDef,
  NodeKind,
  PathCondition,
  PathConfigInput,
  SnapshotNode,
  SortDirection,
  Viewer,
} from './types'

export class DrillEngineError extends Error {}

const DIM_FIELD: Record<string, keyof DrillFact> = {
  区域: 'region',
  省份: 'province',
  城市: 'city',
  渠道: 'channel',
  品类: 'category',
  SKU: 'sku',
}

const EMPTY_LABEL = (dim: string) => `（空值）${dim}`
const UNKNOWN_LABEL = (raw: string) => `（未知值）${raw}`
const BREAK_LABEL = (dim: string) => `断点：层级维度「${dim}」未登记`

// ---------- 层级维度列表读取 ----------

/** 每一层先读层级维度目录；读不到返回 null，由调用方标断点，绝不补零。 */
export function getDimension(name: string) {
  return DIMENSIONS.find((item) => item.name === name) ?? null
}

export function getMetric(name: string): MetricDef | null {
  return METRICS.find((item) => item.name === name) ?? null
}

// ---------- 配置校验：阻断理由集中在这里 ----------

export interface ValidationResult {
  errors: string[]
  warnings: string[]
}

function isInt(value: number) {
  return Number.isInteger(value)
}

export function validatePath(input: PathConfigInput): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!input.code.trim()) errors.push('路径编号不能为空')
  if (!input.name.trim()) errors.push('路径名称不能为空')
  if (!getDimension(input.rootDimension)) {
    errors.push(`起点维度「${input.rootDimension}」不在层级维度目录中，属未知维度`)
  }
  if (!getMetric(input.metric)) errors.push(`聚合指标「${input.metric}」未登记`)
  if (input.levels.length === 0) errors.push('至少配置一个下钻层级')
  if (input.levels.length > MAX_LEVELS) {
    errors.push(`下钻层数 ${input.levels.length} 超过最大层数 ${MAX_LEVELS}，已阻断保存`)
  }
  if (new Set(input.levels).size !== input.levels.length) errors.push('层级维度列表存在重复维度')
  for (const level of input.levels) {
    if (!getDimension(level)) {
      warnings.push(`层级维度「${level}」未登记，运行到该层会标断点而不是补零`)
    }
  }
  if (!isInt(input.defaultExpand) || input.defaultExpand < 0) {
    errors.push(`默认展开层不能为负数或非整数，当前值 ${input.defaultExpand}`)
  }
  if (input.defaultExpand > input.levels.length) {
    errors.push(`默认展开层 ${input.defaultExpand} 超过下钻层数 ${input.levels.length}，已阻断`)
  }
  if (!isInt(input.maxRows) || input.maxRows <= 0) {
    errors.push(`最多展示行数必须为正整数，不能为负或零，当前值 ${input.maxRows}`)
  }
  if (input.sortDirection !== 'asc' && input.sortDirection !== 'desc') {
    errors.push('排序方向只能是升序或降序')
  }
  return { errors, warnings }
}

// ---------- 重复值分支归属（同名取值出现在多个父分支时说明归哪一支） ----------

/**
 * 按当前路径的父层级维度，把同值事实分组签名。
 * 签名只取路径条件里出现过的维度，所以任意起点的路径都能正确区分分支。
 */
function branchSignatures(facts: DrillFact[], dimName: string, parentConditions: PathCondition[]): Set<string> {
  const field = DIM_FIELD[dimName]
  const parentDims = parentConditions.map((condition) => condition.dimension)
  const signatures = new Set<string>()
  facts.forEach((fact) => {
    if (fact[field] === null) return
    const parts = parentDims.map((dim) => {
      const value = fact[DIM_FIELD[dim]]
      return value === null ? '（空值）' : String(value)
    })
    signatures.add(parts.join(' / ') || '（起点层）')
  })
  return signatures
}

function buildDuplicateNote(
  dimName: string,
  raw: string,
  parent: SnapshotNode,
  scoped: DrillFact[],
): string | null {
  const field = DIM_FIELD[dimName]
  const parentDims = parent.conditions.map((condition) => condition.dimension)
  // 同值事实要先回到整组范围，再按父级维度签名，才能发现「同一取值在不同父分支」的情况。
  const sameValue = scopedFacts(scoped[0]?.group ?? '').filter(
    (fact) => fact[field] !== null && String(fact[field]) === raw,
  )
  const signatures = branchSignatures(sameValue, dimName, parent.conditions)
  if (signatures.size <= 1) return null
  const ownSig = parent.conditions.map((condition) => condition.label).join(' / ') || '（起点层）'
  const others = [...signatures].filter((sig) => sig !== ownSig)
  return `重复值：「${raw}」同时出现在 ${signatures.size} 个分支，本节点归属「${ownSig}」`
    + `${others.length ? `；另有分支「${others.join('」、「')}」` : ''}，各分支沿用各自路径条件，口径独立不合并`
}

// ---------- 事实匹配与聚合 ----------

function factMatches(fact: DrillFact, conditions: PathCondition[]): boolean {
  return conditions.every((condition) => {
    const field = DIM_FIELD[condition.dimension]
    if (!field) return false
    const actual = fact[field]
    if (condition.kind === 'empty') return actual === null
    return actual !== null && actual === condition.rawValue
  })
}

function aggregate(rows: DrillFact[], metric: MetricDef): { value: number; count: number } {
  if (rows.length === 0) return { value: 0, count: 0 }
  const total = rows.reduce((sum, row) => sum + row[metric.field], 0)
  if (metric.type === 'avg') {
    return { value: Math.round((total / rows.length) * 100) / 100, count: rows.length }
  }
  return { value: total, count: rows.length }
}

function scopedFacts(viewerGroup: string): DrillFact[] {
  // 下钻结果按数据归属授权：只聚合查看者本组事实，别组数据不可见。
  return FACTS.filter((fact) => fact.group === viewerGroup)
}

function classify(dimName: string, raw: string): NodeKind {
  const def = getDimension(dimName)
  if (!def || def.values === null) return 'value'
  return def.values.includes(raw) ? 'value' : 'unknown'
}

function nodeId(parentId: string, dim: string, raw: string | null, kind: NodeKind) {
  const tail = kind === 'break' ? `break:${dim}` : `${dim}:${raw ?? '∅'}`
  return `${parentId === 'root' ? '' : parentId}/${tail}` || `root/${tail}`
}

function makeCondition(parent: SnapshotNode, dim: string, raw: string | null, kind: NodeKind): PathCondition {
  const label = kind === 'empty' ? EMPTY_LABEL(dim) : kind === 'unknown' ? UNKNOWN_LABEL(String(raw)) : String(raw)
  return { depth: parent.conditions.length + 1, dimension: dim, rawValue: raw, label, kind }
}

// ---------- 子层计算（一次展开 = 一次聚合计算） ----------

interface BuildArgs {
  parent: SnapshotNode
  config: FrozenPathConfig
  metric: MetricDef
  viewerGroup: string
  now: number
}

/** 当前节点深度对应的维度：深度 0 用起点维度，之后按层级维度列表逐层读取。 */
function dimensionAt(config: FrozenPathConfig, depth: number): string | undefined {
  return depth === 0 ? config.rootDimension : config.levels[depth - 1]
}

function buildChildNodes(args: BuildArgs): SnapshotNode[] {
  const { parent, config, metric, viewerGroup, now } = args
  const levelIndex = parent.depth
  const dimName = dimensionAt(config, levelIndex)
  if (dimName === undefined) throw new DrillEngineError('已到达路径配置的最大下钻层数')
  const baseConditions = parent.conditions
  const rows = scopedFacts(viewerGroup).filter((fact) => factMatches(fact, baseConditions))

  const dimension = getDimension(dimName)
  if (!dimension) {
    // 缺失层：标断点，指标为 null，不补零。
    return [{
      id: nodeId(parent.id, dimName, null, 'break'),
      parentId: parent.id,
      depth: parent.depth + 1,
      dimension: dimName,
      label: BREAK_LABEL(dimName),
      rawValue: null,
      kind: 'break',
      conditions: baseConditions,
      metricValue: null,
      valueCount: 0,
      loaded: false,
      truncated: false,
      hiddenSiblingCount: 0,
      branchNote: null,
      children: [],
      computedAt: now,
    }]
  }

  const field = DIM_FIELD[dimName]
  const buckets = new Map<string, DrillFact[]>()
  let emptyBucket: DrillFact[] | null = null

  rows.forEach((fact) => {
    const raw = fact[field]
    if (raw === null) {
      emptyBucket = emptyBucket ?? []
      emptyBucket.push(fact)
      return
    }
    const key = String(raw)
    const bucket = buckets.get(key) ?? []
    bucket.push(fact)
    buckets.set(key, bucket)
  })

  const toNode = (raw: string | null, bucketRows: DrillFact[], kind: NodeKind): SnapshotNode => {
    const condition = makeCondition(parent, dimName, raw, kind)
    const conditions = [...baseConditions, condition]
    const { value, count } = aggregate(bucketRows, metric)
    const label = kind === 'empty'
      ? EMPTY_LABEL(dimName)
      : kind === 'unknown'
        ? UNKNOWN_LABEL(String(raw))
        : String(raw)
    let branchNote: string | null = null
    if (kind === 'empty') {
      branchNote = `空值统一归入「${EMPTY_LABEL(dimName)}」独立分支，不与任何已知值合并`
    } else if (raw !== null) {
      branchNote = buildDuplicateNote(dimName, raw, parent, rows)
    }
    return {
      id: nodeId(parent.id, dimName, raw, kind),
      parentId: parent.id,
      depth: parent.depth + 1,
      dimension: dimName,
      label,
      rawValue: raw,
      kind,
      conditions,
      metricValue: kind === 'break' ? null : value,
      valueCount: count,
      loaded: false,
      truncated: false,
      hiddenSiblingCount: 0,
      branchNote,
      children: [],
      computedAt: now,
    }
  }

  const valueNodes = [...buckets.entries()]
    .map(([raw, bucketRows]) => toNode(raw, bucketRows, classify(dimName, raw)))
  const emptyNode = emptyBucket ? toNode(null, emptyBucket, 'empty') : null

  const sorted = sortNodes(valueNodes, config.sortDirection)
  const visible = sorted.slice(0, config.maxRows)
  const hiddenCount = Math.max(0, sorted.length - config.maxRows)
  if (hiddenCount > 0) {
    visible.forEach((node) => {
      node.truncated = true
      node.hiddenSiblingCount = hiddenCount
    })
  }
  // 空值分支永远单列在最后，不参与截断计数之外的口径混入。
  if (emptyNode) {
    visible.push(emptyNode)
  }
  return visible
}

/** 展示方向变化只做同层排序，不触发任何聚合计算。 */
export function sortNodes(nodes: SnapshotNode[], direction: SortDirection): SnapshotNode[] {
  const empties = nodes.filter((node) => node.kind === 'empty' || node.kind === 'break')
  const others = nodes.filter((node) => node.kind !== 'empty' && node.kind !== 'break')
  others.sort((a, b) => {
    const cmp = a.label.localeCompare(b.label, 'zh-Hans-CN')
    return direction === 'asc' ? cmp : -cmp
  })
  return [...others, ...empties]
}

/** 父层合计只统计实际展示的子节点；被截断节点不偷偷计入。 */
export function childrenDisplayTotal(node: SnapshotNode): { count: number; total: number | null } {
  const visible = node.children.filter((child) => child.kind !== 'break')
  if (visible.length === 0) return { count: 0, total: null }
  return {
    count: visible.length,
    total: visible.reduce((sum, child) => sum + (child.metricValue ?? 0), 0),
  }
}

// ---------- 快照：生成即冻结 ----------

function freeze(path: DrillPath): FrozenPathConfig {
  return {
    code: path.code,
    name: path.name,
    rootDimension: path.rootDimension,
    levels: [...path.levels],
    metric: path.metric,
    defaultExpand: path.defaultExpand,
    sortDirection: path.sortDirection,
    maxRows: path.maxRows,
    ownerGroup: path.ownerGroup,
    pathStatus: path.status,
    version: path.version,
  }
}

export function createRootNode(config: FrozenPathConfig, viewerGroup: string, now: number): SnapshotNode {
  const metric = getMetric(config.metric)
  if (!metric) throw new DrillEngineError(`聚合指标「${config.metric}」未登记`)
  const { value, count } = aggregate(scopedFacts(viewerGroup), metric)
  return {
    id: 'root',
    parentId: null,
    depth: 0,
    dimension: config.rootDimension,
    label: `全部（按${config.rootDimension}展开）`,
    rawValue: null,
    kind: 'value',
    conditions: [],
    metricValue: value,
    valueCount: count,
    loaded: false,
    truncated: false,
    hiddenSiblingCount: 0,
    branchNote: null,
    children: [],
    computedAt: now,
  }
}

export function createSnapshot(path: DrillPath, viewer: Viewer, now: number): DrillSnapshot {
  const metric = getMetric(path.metric)
  if (!metric) throw new DrillEngineError(`聚合指标「${path.metric}」未登记`)
  const config = freeze(path)
  const root = createRootNode(config, viewer.group, now)
  const snapshot: DrillSnapshot = {
    id: `snap-${path.id}-v${path.version}-${now}-${Math.random().toString(36).slice(2, 8)}`,
    pathId: path.id,
    pathCode: path.code,
    pathVersion: path.version,
    config,
    root,
    extras: {},
    ownerGroup: path.ownerGroup,
    viewerGroup: viewer.group,
    createdBy: viewer.name,
    createdAt: now,
    computeCount: 0,
    readOnly: false,
    shared: false,
    sourceSnapshotId: null,
    locked: false,
    lockReason: null,
  }
  // 默认展开层只在生成快照时生效；之后改配置不影响本快照。
  const frontier: SnapshotNode[] = [root]
  for (let step = 0; step < config.defaultExpand; step += 1) {
    const current = frontier.splice(0)
    current.forEach((node) => {
      if (node.depth > config.levels.length) return
      const children = buildChildNodes({ parent: node, config, metric, viewerGroup: viewer.group, now })
      node.children = children
      node.loaded = true
      snapshot.computeCount += 1
      frontier.push(...children.filter((child) => child.kind !== 'break'))
    })
  }
  return snapshot
}

export function findNode(snapshot: DrillSnapshot, id: string): SnapshotNode | null {
  if (id === 'root') return snapshot.root
  const search = (nodes: SnapshotNode[]): SnapshotNode | null => {
    for (const node of nodes) {
      if (node.id === id) return node
      const hit = search(node.children)
      if (hit) return hit
    }
    return null
  }
  const treeHit = search(snapshot.root.children)
  if (treeHit) return treeHit
  for (const extraNodes of Object.values(snapshot.extras)) {
    const hit = search(extraNodes)
    if (hit) return hit
  }
  return null
}

/** 展开节点：已加载直接返回缓存（不二次计算）；断点/到层底拒绝展开。 */
export function expandNode(snapshot: DrillSnapshot, nodeId: string, now: number): ExpandOutcome {
  const node = findNode(snapshot, nodeId)
  if (!node) throw new DrillEngineError('快照里找不到该节点')
  if (node.loaded) {
    return { nodes: node.children, hiddenCount: node.children[0]?.hiddenSiblingCount ?? 0, computeCount: snapshot.computeCount }
  }
  if (node.kind === 'break') throw new DrillEngineError('断点之下没有层级维度，无法继续展开')
  // 深度 0 展开出起点维度，深度 d(>=1) 展开出 levels[d-1]；最后一层在 depth = levels.length 时展开。
  if (node.depth > snapshot.config.levels.length) {
    throw new DrillEngineError('已到达路径配置的最大下钻层数')
  }
  const metric = getMetric(snapshot.config.metric)
  if (!metric) throw new DrillEngineError(`聚合指标「${snapshot.config.metric}」未登记`)
  const children = buildChildNodes({
    parent: node,
    config: snapshot.config,
    metric,
    viewerGroup: snapshot.viewerGroup,
    now,
  })
  node.children = children
  node.loaded = true
  snapshot.computeCount += 1
  return { nodes: children, hiddenCount: children[0]?.hiddenSiblingCount ?? 0, computeCount: snapshot.computeCount }
}

/**
 * 单独查找被最多展示行数截断的节点。
 * 找到且本就可见时直接返回；被隐藏的节点挂到 extras，不计入父层展示合计。
 */
export function lookupChild(snapshot: DrillSnapshot, parentId: string, rawValue: string, now: number): SnapshotNode | null {
  const parent = findNode(snapshot, parentId)
  if (!parent) throw new DrillEngineError('快照里找不到父节点')
  if (!parent.loaded) throw new DrillEngineError('请先展开该节点再查找子层取值')
  const dimName = dimensionAt(snapshot.config, parent.depth)
  if (dimName === undefined) throw new DrillEngineError('已到达路径配置的最大下钻层数')
  const dimension = getDimension(dimName)
  if (!dimension) throw new DrillEngineError('该层为断点，没有可查找的取值')

  const existing = [...parent.children, ...(snapshot.extras[parentId] ?? [])].find(
    (node) => node.rawValue === rawValue,
  )
  if (existing) return existing

  const metric = getMetric(snapshot.config.metric)
  if (!metric) throw new DrillEngineError(`聚合指标「${snapshot.config.metric}」未登记`)
  const rows = scopedFacts(snapshot.viewerGroup)
    .filter((fact) => factMatches(fact, parent.conditions))
    .filter((fact) => fact[DIM_FIELD[dimName]] !== null && String(fact[DIM_FIELD[dimName]]) === rawValue)
  if (rows.length === 0) return null

  const kind = classify(dimName, rawValue)
  const condition = makeCondition(parent, dimName, rawValue, kind)
  const { value, count } = aggregate(rows, metric)
  const node: SnapshotNode = {
    id: nodeId(parent.id, dimName, rawValue, kind),
    parentId: parent.id,
    depth: parent.depth + 1,
    dimension: dimName,
    label: kind === 'unknown' ? UNKNOWN_LABEL(rawValue) : rawValue,
    rawValue: rawValue,
    kind,
    conditions: [...parent.conditions, condition],
    metricValue: value,
    valueCount: count,
    loaded: false,
    truncated: false,
    hiddenSiblingCount: 0,
    branchNote: `通过单独查找获得，不在最多展示行数内，不计入父层合计`,
    children: [],
    computedAt: now,
  }
  const bucket = snapshot.extras[parentId] ?? []
  bucket.push(node)
  snapshot.extras[parentId] = bucket
  snapshot.computeCount += 1
  return node
}
