/** 多维下钻领域类型：引擎、存储、服务门面共用，页面只认这里的结构。 */

export type SortDirection = 'asc' | 'desc'

export type PathStatus = '草稿' | '待校验' | '已启用' | '已停用'

/** 节点取值性质：普通值 / 空值 / 未知值 / 断点（缺失层级维度），四类标记互不混淆。 */
export type NodeKind = 'value' | 'empty' | 'unknown' | 'break'

export type MetricType = 'sum' | 'avg'

export interface MetricDef {
  name: string
  type: MetricType
  field: 'amount' | 'qty'
}

export interface DimensionDef {
  name: string
  /** 白名单为空表示不做取值登记校验，任何非空值都算普通值。 */
  values: string[] | null
}

/** 事实数据：group 为数据归属授权组，下钻计算只取当前查看者归属组内的数据。 */
export interface DrillFact {
  id: number
  group: string
  region: string | null
  province: string | null
  city: string | null
  channel: string | null
  category: string | null
  sku: string | null
  amount: number
  qty: number
}

/** 从根到某个节点的完整路径条件，返回上级再展开时原样沿用，不引入其他分支口径。 */
export interface PathCondition {
  depth: number
  dimension: string
  rawValue: string | null
  label: string
  kind: NodeKind
}

export interface SnapshotNode {
  id: string
  parentId: string | null
  depth: number
  dimension: string
  label: string
  rawValue: string | null
  kind: NodeKind
  conditions: PathCondition[]
  /** 授权范围内的聚合结果；断点节点为 null，绝不补零。 */
  metricValue: number | null
  valueCount: number
  /** 子层是否已经计算过；true 之后收起再展开直接读缓存，不触发第二次计算。 */
  loaded: boolean
  /** 同层是否已按最多展示行数截断。 */
  truncated: boolean
  /** 被截断的兄弟节点数量。 */
  hiddenSiblingCount: number
  /** 重复值 / 空值的分支归属说明。 */
  branchNote: string | null
  children: SnapshotNode[]
  computedAt: number
}

export interface PathConfigInput {
  code: string
  name: string
  rootDimension: string
  levels: string[]
  metric: string
  defaultExpand: number
  sortDirection: SortDirection
  maxRows: number
  ownerGroup: string
}

export interface DrillPath extends PathConfigInput {
  id: number
  status: PathStatus
  /** 每次保存递增；快照冻结生成时的版本，旧快照不会混入新版本层级。 */
  version: number
  updatedAt: number
  validationIssues: string[]
}

/** 快照内冻结的路径配置，之后路径再怎么改都与这份快照无关。 */
export type FrozenPathConfig = PathConfigInput & {
  pathStatus: PathStatus
  version: number
}

export interface DrillSnapshot {
  id: string
  pathId: number
  pathCode: string
  pathVersion: number
  config: FrozenPathConfig
  root: SnapshotNode
  /** 超过最多展示行数后、通过单独查找得到的节点，按父节点 id 挂账，不计入父层合计。 */
  extras: Record<string, SnapshotNode[]>
  ownerGroup: string
  /** 生成者的数据归属组，聚合时只统计该组事实。 */
  viewerGroup: string
  createdBy: string
  createdAt: number
  /** 实际触发聚合计算的次数，用来证明收起再展开不会二次计算。 */
  computeCount: number
  readOnly: boolean
  shared: boolean
  sourceSnapshotId: string | null
  /** 路径停用后历史快照转只读；新查询不得再在其上展开。 */
  locked: boolean
  lockReason: string | null
}

export interface Viewer {
  name: string
  group: string
}

export interface ExpandOutcome {
  nodes: SnapshotNode[]
  hiddenCount: number
  computeCount: number
}
