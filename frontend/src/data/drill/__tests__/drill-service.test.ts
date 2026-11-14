import assert from 'node:assert/strict'
import { test } from 'node:test'

// localStorage 内存桩：drill-store 只依赖 getItem/setItem。
const memory = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => (memory.has(key) ? memory.get(key)! : null),
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
    clear: () => memory.clear(),
  },
  configurable: true,
})

import {
  bumpPathVersion,
  createPath,
  currentViewer,
  expandSnapshotNode,
  generateSnapshot,
  listPaths,
  shareReadOnlyCopy,
  snapshotGuards,
  switchViewer,
  transitionPath,
  updatePath,
} from '../../../api/drill-service'
import { resetDrillState } from '../drill-store'
import type { PathConfigInput, Viewer } from '../types'

const EAST: Viewer = { name: '华东组分析员', group: '华东组' }
const SOUTH: Viewer = { name: '华南组分析员', group: '华南组' }

function newConfig(): PathConfigInput {
  return {
    code: 'DRIL-UT-1',
    name: '服务层测试路径',
    rootDimension: '区域',
    levels: ['省份', '城市'],
    metric: '销售额',
    defaultExpand: 1,
    sortDirection: 'asc',
    maxRows: 3,
    ownerGroup: '华东组',
  }
}

test('越权：别组不能改动路径，只能生成只读共享副本', () => {
  resetDrillState()
  const created = createPath(newConfig(), EAST)
  assert.equal(created.ok, true)
  const path = created.data!

  const blockedEdit = updatePath(path.id, { ...newConfig(), name: '被篡改' }, SOUTH)
  assert.equal(blockedEdit.ok, false)
  assert.match(blockedEdit.message, /越权/)

  const blockedAction = transitionPath(path.id, '启用路径', SOUTH)
  assert.equal(blockedAction.ok, false)
  assert.match(blockedAction.message, /越权/)

  const snap = generateSnapshot(path.id, EAST)
  assert.equal(snap.ok, true)
  const copy = shareReadOnlyCopy(snap.data!.id, SOUTH)
  assert.equal(copy.ok, true)
  assert.equal(copy.data!.shared, true)
  assert.equal(copy.data!.readOnly, true)
  assert.equal(copy.data!.viewerGroup, '华南组', '共享副本按查看者本组数据重新聚合')
  assert.equal(copy.data!.sourceSnapshotId, snap.data!.id)

  // 共享副本上不能再展开。
  const expand = expandSnapshotNode(copy.data!.id, 'root', SOUTH)
  assert.equal(expand.ok, false)
  assert.match(expand.message, /只读/)
})

test('停用路径：历史快照转只读，新查询不能沿用展开位置', () => {
  resetDrillState()
  const created = createPath(newConfig(), EAST)
  const path = created.data!
  transitionPath(path.id, '提交校验', EAST)
  transitionPath(path.id, '启用路径', EAST)
  const snap = generateSnapshot(path.id, EAST)
  assert.equal(snap.ok, true)

  const stop = transitionPath(path.id, '停用路径', EAST)
  assert.equal(stop.ok, true)
  const legacy = listPaths().find((item) => item.id === path.id)!
  assert.equal(legacy.status, '已停用')

  const again = generateSnapshot(path.id, EAST)
  assert.equal(again.ok, false)
  assert.match(again.message, /已停用/)

  const expand = expandSnapshotNode(snap.data!.id, 'root', EAST)
  assert.equal(expand.ok, false)
  assert.match(expand.message, /只读/)

  // 旧快照仍然可读。
  const guards = snapshotGuards(snap.data!, EAST)
  assert.equal(guards.access, 'manage')
})

test('并发修改：旧快照继续可读且不混入新层级', () => {
  resetDrillState()
  const created = createPath(newConfig(), EAST)
  const path = created.data!
  const snap = generateSnapshot(path.id, EAST)
  assert.equal(snap.data!.config.levels.length, 2)

  const bumped = bumpPathVersion(path.id, SOUTH)
  assert.equal(bumped.ok, true, '模拟他人修改不受查看者限制（版本事件）')
  assert.equal(bumped.data!.version, 2)

  const guards = snapshotGuards(snap.data!, EAST)
  assert.ok(guards.staleMessage)
  assert.match(guards.staleMessage!, /v2/)
  assert.equal(snap.data!.config.levels.length, 2, '旧快照冻结的层级不变')

  // 过期快照上拒绝继续展开，防止新口径混入。
  const expand = expandSnapshotNode(snap.data!.id, 'root', EAST)
  assert.equal(expand.ok, false)
  assert.match(expand.message, /重新生成快照/)

  // 重新生成的快照拿到新版本。
  const fresh = generateSnapshot(path.id, EAST)
  assert.equal(fresh.data!.pathVersion, 2)
})

test('保存即升版本，负层数与超过最大层数在服务层被阻断', () => {
  resetDrillState()
  const created = createPath(newConfig(), EAST)
  const path = created.data!
  const updated = updatePath(path.id, { ...newConfig(), defaultExpand: 2 }, EAST)
  assert.equal(updated.ok, true)
  assert.equal(updated.data!.version, 2)

  const negative = createPath({ ...newConfig(), code: 'DRIL-UT-2', maxRows: -5 }, EAST)
  assert.equal(negative.ok, false)
  assert.match(negative.message, /最多展示行数必须为正整数/)

  const tooDeep = createPath({
    ...newConfig(),
    code: 'DRIL-UT-3',
    levels: ['省份', '城市', '渠道', '品类', 'SKU', '区域', '省份'],
  }, EAST)
  assert.equal(tooDeep.ok, false)
  assert.match(tooDeep.message, /超过最大层数/)
})

test('切换查看身份后按新归属授权，停用的种子路径只保留只读快照', () => {
  resetDrillState()
  switchViewer(SOUTH)
  assert.equal(currentViewer().group, '华南组')
  const stopped = listPaths().find((path) => path.status === '已停用')!
  const denied = transitionPath(stopped.id, '启用路径', SOUTH)
  assert.equal(denied.ok, false)
})
