import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MAX_LEVELS } from '../dataset'
import {
  DrillEngineError,
  childrenDisplayTotal,
  createSnapshot,
  expandNode,
  findNode,
  lookupChild,
  sortNodes,
  validatePath,
} from '../engine'
import type { DrillPath, Viewer } from '../types'

const VIEWER: Viewer = { name: '华东组分析员', group: '华东组' }
const OTHER_VIEWER: Viewer = { name: '华南组分析员', group: '华南组' }
const NOW = 1_700_000_000_000

function makePath(overrides: Partial<DrillPath> = {}): DrillPath {
  return {
    code: 'DRIL-T1',
    name: '测试路径',
    rootDimension: '区域',
    levels: ['省份', '城市', '渠道', '品类'],
    metric: '销售额',
    defaultExpand: 1,
    sortDirection: 'asc',
    maxRows: 2,
    ownerGroup: '华东组',
    id: 100,
    status: '已启用',
    version: 1,
    updatedAt: NOW,
    validationIssues: [],
    ...overrides,
  }
}

test('校验：负值、零值、超过最大层数、未知起点维度都给出阻断理由', () => {
  const negative = validatePath(makePath({ defaultExpand: -1 }))
  assert.ok(negative.errors.some((m) => m.includes('默认展开层不能为负数')))

  const zeroRows = validatePath(makePath({ maxRows: 0 }))
  assert.ok(zeroRows.errors.some((m) => m.includes('最多展示行数必须为正整数')))

  const tooMany = validatePath(makePath({ levels: Array(MAX_LEVELS + 1).fill('品类') }))
  assert.ok(tooMany.errors.some((m) => m.includes('超过最大层数')))

  const unknownRoot = validatePath(makePath({ rootDimension: '不存在的维度' }))
  assert.ok(unknownRoot.errors.some((m) => m.includes('未知维度')))

  // 未登记的下钻层级只警告不阻断，运行时标断点。
  const missingLevel = validatePath(makePath({ levels: ['省份', '幽灵维度'] }))
  assert.equal(missingLevel.errors.length, 0)
  assert.ok(missingLevel.warnings.some((m) => m.includes('幽灵维度')))
})

test('逐层下钻：先读层级维度目录再聚合，缺失层标断点且指标为 null 不补零', () => {
  const path = makePath({
    levels: ['省份', '幽灵维度'],
    defaultExpand: 2,
    maxRows: 10,
  })
  const snapshot = createSnapshot(path, VIEWER, NOW)
  const shanghai = snapshot.root.children
    .find((node) => node.label === '华东')!
    .children.find((node) => node.label === '上海')
  assert.ok(shanghai)

  const outcome = expandNode(snapshot, shanghai!.id, NOW + 1)
  assert.equal(outcome.nodes.length, 1)
  const breakNode = outcome.nodes[0]
  assert.equal(breakNode.kind, 'break')
  assert.equal(breakNode.metricValue, null)
  assert.match(breakNode.label, /断点/)

  assert.throws(() => expandNode(snapshot, breakNode.id, NOW + 2), DrillEngineError)
})

test('空值与未知值是不同标记，且与普通值分支并列', () => {
  const path = makePath({ rootDimension: '渠道', levels: ['品类'], defaultExpand: 1, maxRows: 10 })
  const snapshot = createSnapshot(path, VIEWER, NOW)
  const labels = snapshot.root.children.map((node) => `${node.kind}:${node.label}`)
  assert.ok(labels.some((label) => label.startsWith('empty:'))), '渠道空值必须有空值标记'
  assert.ok(labels.includes('unknown:（未知值）社群团购'), '社群团购不在渠道白名单，应标未知')
  assert.ok(labels.includes('value:线上'), '线上保持普通值')
  const empty = snapshot.root.children.find((node) => node.kind === 'empty')
  assert.match(empty!.branchNote ?? '', /独立分支/)
})

test('重复值说明归属分支；返回上级再展开沿用原路径条件', () => {
  const path = makePath({ defaultExpand: 0, maxRows: 10 })
  const snapshot = createSnapshot(path, VIEWER, NOW)
  expandNode(snapshot, 'root', NOW + 1)
  const east = snapshot.root.children.find((node) => node.label === '华东')!
  expandNode(snapshot, east.id, NOW + 2)
  const jiangsu = east.children.find((node) => node.label === '江苏')!
  expandNode(snapshot, jiangsu.id, NOW + 3)
  const tongzhou = jiangsu.children.find((node) => node.label === '通州')
  assert.ok(tongzhou, '江苏分支下应有通州')
  assert.match(tongzhou!.branchNote ?? '', /重复值/)
  assert.match(tongzhou!.branchNote ?? '', /本节点归属「华东 \/ 江苏」/)

  // 通州节点的条件链锁定在 华东>江苏>通州，不会把北京分支口径带进来。
  assert.deepEqual(tongzhou!.conditions.map((c) => c.label), ['华东', '江苏', '通州'])
  const again = expandNode(snapshot, jiangsu.id, NOW + 4)
  assert.equal(again.computeCount, 3, '已计算过的层再次展开不能增加计算次数')
  assert.deepEqual(
    tongzhou!.conditions.map((c) => c.rawValue),
    ['华东', '江苏', '通州'],
  )
})

test('收起再打开不触发第二次计算', () => {
  const path = makePath({ defaultExpand: 0, maxRows: 10 })
  const snapshot = createSnapshot(path, VIEWER, NOW)
  const first = expandNode(snapshot, 'root', NOW + 1)
  assert.equal(first.computeCount, 1)
  const second = expandNode(snapshot, 'root', NOW + 2)
  assert.equal(second.computeCount, 1, '重复展开必须命中缓存')
})

test('最多展示行数截断：父层合计只算可见节点，隐藏节点可单独查找且不计入合计', () => {
  const path = makePath({ defaultExpand: 2, maxRows: 2 })
  const snapshot = createSnapshot(path, VIEWER, NOW)
  const east = snapshot.root.children.find((node) => node.label === '华东')!
  const provinceTotalBefore = childrenDisplayTotal(east)
  assert.equal(east.children.length, 2)
  assert.ok(east.children.every((node) => node.truncated))
  const hiddenCount = east.children[0].hiddenSiblingCount
  assert.ok(hiddenCount >= 1, '华东组有 3 个省份，maxRows=2 时至少隐藏 1 个')

  const visibleLabels = east.children.map((node) => node.label)
  const target = visibleLabels.includes('浙江') ? '江苏' : '浙江'
  const found = lookupChild(snapshot, east.id, target, NOW + 2)
  assert.ok(found, '被隐藏的省份应能单独查找')
  const provinceTotalAfter = childrenDisplayTotal(east)
  assert.deepEqual(provinceTotalAfter, provinceTotalBefore, '查找结果不能偷偷计入父层合计')
  assert.ok(snapshot.extras[east.id]?.some((node) => node.id === found!.id))
  assert.match(found!.branchNote ?? '', /不计入父层合计/)
})

test('展示方向变化只重排同层节点，不重算整棵树', () => {
  const path = makePath({ defaultExpand: 1, maxRows: 10, sortDirection: 'asc' })
  const snapshot = createSnapshot(path, VIEWER, NOW)
  const before = snapshot.computeCount
  const ascLabels = sortNodes(snapshot.root.children, 'asc').map((node) => node.label)
  const descLabels = sortNodes(snapshot.root.children, 'desc').map((node) => node.label)
  assert.deepEqual(descLabels, [...ascLabels].reverse())
  assert.equal(snapshot.computeCount, before)
})

test('快照冻结：默认展开层与路径后续修改互不影响，并发修改不混入旧快照', () => {
  const path = makePath({ defaultExpand: 1, levels: ['省份', '城市'] })
  const snapshot = createSnapshot(path, VIEWER, NOW)
  assert.equal(snapshot.config.defaultExpand, 1)
  assert.equal(snapshot.config.levels.length, 2)

  const changed = makePath({ defaultExpand: 2, levels: ['省份', '城市', '渠道'], version: 2 })
  const nextSnapshot = createSnapshot(changed, VIEWER, NOW + 10)
  assert.equal(nextSnapshot.config.defaultExpand, 2)
  assert.equal(snapshot.config.levels.length, 2, '旧快照层级不变')
  assert.equal(snapshot.pathVersion, 1)
  assert.equal(nextSnapshot.pathVersion, 2)
})

test('数据归属授权：只聚合本组事实，别组数据不可见', () => {
  const path = makePath({ defaultExpand: 1, maxRows: 10, rootDimension: '区域', levels: ['省份'] })
  const east = createSnapshot(path, VIEWER, NOW)
  const south = createSnapshot(path, OTHER_VIEWER, NOW)
  assert.notEqual(east.root.metricValue, south.root.metricValue)
  const eastRegions = east.root.children.map((node) => node.label)
  const southRegions = south.root.children.map((node) => node.label)
  assert.deepEqual(eastRegions, ['华东'])
  assert.deepEqual(southRegions, ['华南'])
  assert.ok(!southRegions.includes('华东'), '华南组看不到华东组数据分支')
})

test('客单价为均值聚合，断点不参与任何数值计算', () => {
  const path = makePath({ metric: '客单价', defaultExpand: 2, maxRows: 10 })
  const snapshot = createSnapshot(path, VIEWER, NOW)
  const east = snapshot.root.children.find((node) => node.label === '华东')!
  const shanghai = east.children.find((node) => node.label === '上海')
  assert.ok(shanghai)
  assert.equal(typeof shanghai!.metricValue, 'number')
  const total = childrenDisplayTotal(snapshot.root)
  assert.ok(total.total !== null)
})

test('到达最大层数后拒绝继续展开', () => {
  const path = makePath({ levels: ['省份'], defaultExpand: 2, maxRows: 10 })
  const snapshot = createSnapshot(path, VIEWER, NOW)
  const east = snapshot.root.children[0]
  const leaf = east.children[0]
  assert.equal(leaf.depth, 2)
  assert.throws(() => expandNode(snapshot, leaf.id, NOW + 1), /最大下钻层数/)
})

test('查找一个不存在的取值返回 null 而不是造零值节点', () => {
  const path = makePath({ defaultExpand: 1, maxRows: 10 })
  const snapshot = createSnapshot(path, VIEWER, NOW)
  const missing = lookupChild(snapshot, 'root', '火星区域', NOW + 2)
  assert.equal(missing, null)
})

test('根节点聚合范围等于查看者授权组全部事实', () => {
  const path = makePath({ defaultExpand: 0, maxRows: 10 })
  const snapshot = createSnapshot(path, VIEWER, NOW)
  const eastFactsCount = 17
  assert.equal(snapshot.root.valueCount, eastFactsCount)
  assert.ok(findNode(snapshot, 'root'))
})
