import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  bumpPathVersion,
  createPath,
  currentViewer,
  displayTotal,
  expandSnapshotNode,
  generateSnapshot,
  listPaths,
  listSnapshots,
  listViewers,
  lookupSnapshotNode,
  pathAccess,
  resetDrill,
  shareReadOnlyCopy,
  snapshotGuards,
  switchViewer,
  transitionPath,
  updatePath,
} from '@/api/drill-service'
import type { DrillPath, DrillSnapshot, PathConfigInput, SortDirection, Viewer } from '@/data/drill/types'
import DrillTree from './DrillTree'
import PathForm from './PathForm'
import './drill.css'

export default function DrillView() {
  const [paths, setPaths] = useState<DrillPath[]>([])
  const [snapshots, setSnapshots] = useState<DrillSnapshot[]>([])
  const [viewer, setViewer] = useState<Viewer>(() => currentViewer())
  const [selectedPathId, setSelectedPathId] = useState<number | null>(null)
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ mode: 'create' | 'edit'; path: DrillPath | null } | null>(null)
  const [direction, setDirection] = useState<SortDirection>('asc')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const reload = useCallback(() => {
    setPaths(listPaths())
    setSnapshots(listSnapshots())
    setViewer(currentViewer())
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const selectedPath = paths.find((path) => path.id === selectedPathId) ?? null
  const selectedSnapshot = snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? null
  const pathSnapshots = useMemo(
    () => snapshots.filter((snapshot) => snapshot.pathId === selectedPathId),
    [snapshots, selectedPathId],
  )

  const guards = selectedSnapshot ? snapshotGuards(selectedSnapshot, viewer) : null
  const access = selectedPath ? pathAccess(selectedPath, viewer) : 'forbidden'
  const blockedMessage = selectedSnapshot && guards
    ? selectedSnapshot.lockReason
      ?? guards.staleMessage
      ?? (guards.access === 'readonly' && !selectedSnapshot.shared
        ? `越权只读：快照按 ${selectedSnapshot.viewerGroup} 数据归属生成，${viewer.group} 不能改动，可生成只读共享副本`
        : null)
    : null
  const canExpand = selectedSnapshot ? !selectedSnapshot.locked && !selectedSnapshot.shared && guards?.access === 'manage' && !guards?.staleMessage : false

  const stats = useMemo(() => ({
    total: paths.length,
    enabled: paths.filter((path) => path.status === '已启用').length,
    pending: paths.filter((path) => path.status === '待校验').length,
    stopped: paths.filter((path) => path.status === '已停用').length,
  }), [paths])

  function flash(ok: boolean, text: string) {
    setMessage({ ok, text })
  }

  function handleSwitchViewer(next: Viewer) {
    const result = switchViewer(next)
    flash(result.ok, result.message)
    reload()
  }

  function handleCreate(input: PathConfigInput) {
    const result = createPath(input, viewer)
    flash(result.ok, result.message)
    if (result.ok && result.data) {
      setEditing(null)
      setSelectedPathId(result.data.id)
    }
    reload()
  }

  function handleUpdate(input: PathConfigInput) {
    if (!editing?.path) return
    const result = updatePath(editing.path.id, input, viewer)
    flash(result.ok, result.message)
    if (result.ok) setEditing(null)
    reload()
  }

  function handleAction(path: DrillPath, action: string) {
    const result = transitionPath(path.id, action, viewer)
    flash(result.ok, result.message)
    reload()
  }

  function handleBump(path: DrillPath) {
    const result = bumpPathVersion(path.id, viewer)
    flash(result.ok, result.message)
    reload()
  }

  function handleGenerate(path: DrillPath) {
    const result = generateSnapshot(path.id, viewer)
    flash(result.ok, result.message)
    if (result.ok && result.data) setSelectedSnapshotId(result.data.id)
    reload()
  }

  function handleToggle(nodeId: string) {
    if (!selectedSnapshot) return
    const result = expandSnapshotNode(selectedSnapshot.id, nodeId, viewer)
    flash(result.ok, result.message)
    reload()
  }

  function handleLookup(parentId: string, value: string) {
    if (!selectedSnapshot) return
    const result = lookupSnapshotNode(selectedSnapshot.id, parentId, value, viewer)
    flash(result.ok, result.message)
    reload()
  }

  function handleShare(snapshotId: string) {
    const result = shareReadOnlyCopy(snapshotId, viewer)
    flash(result.ok, result.message)
    if (result.ok && result.data) setSelectedSnapshotId(result.data.id)
    reload()
  }

  function handleReset() {
    const result = resetDrill()
    flash(result.ok, result.message)
    setSelectedPathId(null)
    setSelectedSnapshotId(null)
    setEditing(null)
    reload()
  }

  return (
    <section className="page drill-page" data-module="drill">
      <header className="page-head">
        <div>
          <h2>多维下钻管理</h2>
          <p className="page-desc">
            逐层读取层级维度目录、按聚合指标计算下钻结果并冻结成快照；空值/未知/断点分别标记，授权、并发与停用口径全程可验证。
          </p>
        </div>
        <div className="page-actions">
          <label className="viewer-switch">
            查看身份（数据归属授权）：
            <select value={viewer.group} onChange={(event) => {
              const target = listViewers().find((item) => item.group === event.target.value)
              if (target) handleSwitchViewer(target)
            }}
            >
              {listViewers().map((item) => <option key={item.group} value={item.group}>{item.group} · {item.name}</option>)}
            </select>
          </label>
          <button className="btn primary" type="button" onClick={() => setEditing({ mode: 'create', path: null })}>登记下钻路径</button>
          <button className="btn ghost" type="button" onClick={handleReset}>恢复示例数据</button>
        </div>
      </header>

      <div className="stat-row">
        <article className="stat-card"><span className="stat-label">下钻路径总数</span><strong className="stat-value">{stats.total}</strong></article>
        <article className="stat-card"><span className="stat-label">已启用路径</span><strong className="stat-value">{stats.enabled}</strong></article>
        <article className="stat-card"><span className="stat-label">待校验路径</span><strong className="stat-value">{stats.pending}</strong></article>
        <article className="stat-card"><span className="stat-label">已停用（历史快照只读）</span><strong className="stat-value">{stats.stopped}</strong></article>
      </div>

      {message && <p className={message.ok ? 'flash-ok' : 'flash-err'}>{message.text}</p>}

      {editing && (
        <PathForm
          initial={editing.mode === 'edit' ? editing.path : null}
          disabled={false}
          onSubmit={editing.mode === 'edit' ? handleUpdate : handleCreate}
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="drill-layout">
        <div className="card path-panel">
          <h4>下钻路径</h4>
          <table className="data-table compact">
            <thead>
              <tr>
                <th>路径编号 / 名称</th><th>层级维度列表</th><th>指标·展开层·行数</th><th>归属 / 状态 / 版本</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {paths.map((path) => {
                const level = pathAccess(path, viewer)
                return (
                  <tr key={path.id} className={selectedPathId === path.id ? 'selected-row' : ''} onClick={() => { setSelectedPathId(path.id); setSelectedSnapshotId(null) }}>
                    <td>
                      <strong>{path.code}</strong>
                      <span className="sub">{path.name}</span>
                      {path.validationIssues.length > 0 && (
                        <span className="check-warn" title={path.validationIssues.join('\n')}>⚠ {path.validationIssues.length} 条提示</span>
                      )}
                    </td>
                    <td>{path.rootDimension} → {path.levels.join(' → ') || '（未配置）'}</td>
                    <td>{path.metric} · 展开{path.defaultExpand}层 · 最多{path.maxRows}行 · {path.sortDirection === 'asc' ? '升序' : '降序'}</td>
                    <td>
                      {path.ownerGroup}
                      <span className={`status-pill status-${path.status}`}>{path.status}</span>
                      <span className="sub">v{path.version}</span>
                      <span className={`access-tag access-${level}`}>{level === 'manage' ? '本组可管理' : '别组只读'}</span>
                    </td>
                    <td className="row-actions" onClick={(event) => event.stopPropagation()}>
                      <button type="button" className="link" onClick={() => setEditing({ mode: 'edit', path })}>编辑</button>
                      <button type="button" className="link" onClick={() => handleAction(path, '提交校验')}>提交校验</button>
                      <button type="button" className="link" onClick={() => handleAction(path, '启用路径')}>启用</button>
                      <button type="button" className="link" onClick={() => handleAction(path, '停用路径')}>停用</button>
                      <button type="button" className="link" onClick={() => handleBump(path)}>模拟他人修改</button>
                      <button type="button" className="link" onClick={() => handleGenerate(path)}>生成快照</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {selectedPath && (
          <div className="card snapshot-panel">
            <h4>路径快照（{selectedPath.code}）</h4>
            <p className="hint">
              修改默认展开层只影响之后生成的快照；已生成快照的配置在创建时冻结。
              {access === 'readonly' && ` 当前身份对该路径为只读（归属 ${selectedPath.ownerGroup}）。`}
            </p>
            {pathSnapshots.length === 0 && <p className="empty-state">该路径还没有快照，点击「生成快照」按当前配置与你的数据归属计算。</p>}
            <ul className="snapshot-list">
              {pathSnapshots.map((snapshot) => {
                const info = snapshotGuards(snapshot, viewer)
                return (
                  <li key={snapshot.id} className={selectedSnapshotId === snapshot.id ? 'selected-snap' : ''}>
                    <button type="button" className="snap-item" onClick={() => setSelectedSnapshotId(snapshot.id)}>
                      <span>
                        {new Date(snapshot.createdAt).toLocaleTimeString()} 生成 · {snapshot.createdBy}
                        {snapshot.shared && <em className="access-tag access-readonly">共享只读副本</em>}
                        {snapshot.locked && <em className="access-tag access-locked">停用只读</em>}
                      </span>
                      <span className="sub">
                        冻结 v{snapshot.pathVersion}（现 v{selectedPath.version}）· 计算 {snapshot.computeCount} 次
                        {info.staleMessage && ' · 版本已过期'}
                      </span>
                    </button>
                    {info.access === 'readonly' && !snapshot.shared && (
                      <button type="button" className="link" onClick={() => handleShare(snapshot.id)}>生成只读共享副本</button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {selectedSnapshot && (
          <div className="card workbench">
            <div className="workbench-bar">
              <div>
                <h4>快照工作台</h4>
                <p className="hint">
                  节点路径条件：{selectedSnapshot.root.conditions.length === 0 ? '起点（无条件）' : ''}
                  根节点口径合计 {selectedSnapshot.root.metricValue}（{selectedSnapshot.root.valueCount} 行授权数据）
                </p>
              </div>
              <label className="viewer-switch">
                展示方向（仅重排同层）：
                <select
                  value={direction}
                  onChange={(event) => setDirection(event.target.value as SortDirection)}
                >
                  <option value="asc">升序</option>
                  <option value="desc">降序</option>
                </select>
              </label>
            </div>
            {selectedPath && (
              <p className="hint">
                根节点（{selectedPath.rootDimension}）同层展示合计：{displayTotal(selectedSnapshot.root).total ?? '—'}，
                排序方向切换不会改变该数值，也不会重算整棵树。
              </p>
            )}
            <DrillTree
              snapshot={selectedSnapshot}
              canExpand={canExpand}
              blockedMessage={canExpand ? null : blockedMessage}
              direction={direction}
              onToggle={handleToggle}
              onLookup={handleLookup}
            />
          </div>
        )}
      </div>
    </section>
  )
}
