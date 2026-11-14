import { useState } from 'react'

import { displayTotal } from '@/api/drill-service'
import { sortNodes } from '@/data/drill/engine'
import type { DrillSnapshot, SnapshotNode, SortDirection } from '@/data/drill/types'

const KIND_BADGE: Record<SnapshotNode['kind'], string> = {
  value: '普通',
  empty: '空值',
  unknown: '未知',
  break: '断点',
}

interface Props {
  snapshot: DrillSnapshot
  canExpand: boolean
  blockedMessage: string | null
  direction: SortDirection
  onToggle: (nodeId: string) => void
  onLookup: (parentId: string, value: string) => void
}

function LookupBox({ parentId, disabled, onLookup }: { parentId: string; disabled: boolean; onLookup: (p: string, v: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <div className="lookup-box">
      <input
        value={value}
        disabled={disabled}
        placeholder="输入被截断的维度取值，单独查找"
        onChange={(event) => setValue(event.target.value)}
      />
      <button
        type="button"
        className="btn small"
        disabled={disabled || value.trim() === ''}
        onClick={() => {
          onLookup(parentId, value.trim())
          setValue('')
        }}
      >
        查找
      </button>
    </div>
  )
}

function TreeNode({
  node,
  snapshot,
  canExpand,
  blockedMessage,
  direction,
  depth,
  onToggle,
  onLookup,
  extras,
}: {
  node: SnapshotNode
  snapshot: DrillSnapshot
  canExpand: boolean
  blockedMessage: string | null
  direction: SortDirection
  depth: number
  onToggle: (nodeId: string) => void
  onLookup: (parentId: string, value: string) => void
  extras: SnapshotNode[]
}) {
  const [collapsed, setCollapsed] = useState(false)
  const hasNextLevel = node.depth <= snapshot.config.levels.length
  const total = displayTotal(node)
  const ordered = sortNodes(node.children, direction)

  return (
    <div className="tree-node" style={{ marginLeft: depth * 18 }}>
      <div className={`tree-row kind-${node.kind}`}>
        {node.loaded && hasNextLevel ? (
          <button type="button" className="tree-caret" onClick={() => setCollapsed((prev) => !prev)}>
            {collapsed ? '▶' : '▼'}
          </button>
        ) : (
          <span className="tree-caret placeholder" />
        )}
        <span className={`node-badge badge-${node.kind}`}>{KIND_BADGE[node.kind]}</span>
        <span className="node-label" title={node.conditions.map((c) => `${c.dimension}=${c.label}`).join(' 且 ')}>
          {node.label}
        </span>
        <span className="node-metric">
          {snapshot.config.metric}：{node.metricValue === null ? '—（断点不补零）' : node.metricValue}
          <em>（{node.valueCount} 行）</em>
        </span>
        {node.loaded && hasNextLevel && (
          <span className="node-total">
            同层展示 {total.count} 个 / 合计 {total.total === null ? '—' : total.total}
            {node.hiddenSiblingCount > 0 && <b>（另有 {node.hiddenSiblingCount} 个被行数限制隐藏，可单独查找，不计入此合计）</b>}
          </span>
        )}
        {node.loaded && !collapsed && !hasNextLevel && <span className="node-total muted">已到最大下钻层数</span>}
        {hasNextLevel && node.kind !== 'break' && (
          <button type="button" className="link" disabled={!canExpand} onClick={() => onToggle(node.id)}>
            {node.loaded ? (collapsed ? '重新打开（读缓存）' : '收起') : '展开下一层'}
          </button>
        )}
        {node.kind === 'break' && <span className="block-reason">断点之下无维度，禁止继续展开</span>}
      </div>

      {node.branchNote && <p className="branch-note" style={{ marginLeft: depth * 18 + 24 }}>{node.branchNote}</p>}

      {node.loaded && !collapsed && (
        <>
          <div className="tree-children">
            {ordered.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                snapshot={snapshot}
                canExpand={canExpand}
                blockedMessage={blockedMessage}
                direction={direction}
                depth={depth + 1}
                onToggle={onToggle}
                onLookup={onLookup}
                extras={snapshot.extras[child.id] ?? []}
              />
            ))}
          </div>
          {node.hiddenSiblingCount > 0 && (
            <div style={{ marginLeft: depth * 18 + 24 }}>
              <LookupBox parentId={node.id} disabled={!canExpand} onLookup={onLookup} />
            </div>
          )}
          {extras.length > 0 && (
            <div className="extras-list" style={{ marginLeft: depth * 18 + 24 }}>
              <p className="extras-title">单独查找结果（不进入父层合计）：</p>
              {extras.map((extra) => (
                <div key={extra.id} className={`tree-row kind-${extra.kind} extra-row`}>
                  <span className={`node-badge badge-${extra.kind}`}>{KIND_BADGE[extra.kind]}</span>
                  <span className="node-label">{extra.label}</span>
                  <span className="node-metric">
                    {snapshot.config.metric}：{extra.metricValue}<em>（{extra.valueCount} 行）</em>
                  </span>
                  {hasNextLevelFor(snapshot, extra) && (
                    <button type="button" className="link" disabled={!canExpand} onClick={() => onToggle(extra.id)}>
                      {extra.loaded ? '收起/读缓存' : '展开下一层'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function hasNextLevelFor(snapshot: DrillSnapshot, node: SnapshotNode) {
  return node.depth <= snapshot.config.levels.length && node.kind !== 'break'
}

export default function DrillTree({ snapshot, canExpand, blockedMessage, direction, onToggle, onLookup }: Props) {
  return (
    <div className="drill-tree card">
      <header className="tree-head">
        <div>
          <h4>下钻结果树（冻结配置 v{snapshot.pathVersion}）</h4>
          <p className="hint">
            生成于 {new Date(snapshot.createdAt).toLocaleString()}，授权口径：{snapshot.viewerGroup}；
            累计聚合计算 {snapshot.computeCount} 次，收起再展开不增加
          </p>
        </div>
        {blockedMessage && <p className="block-reason">{blockedMessage}</p>}
      </header>
      <TreeNode
        node={snapshot.root}
        snapshot={snapshot}
        canExpand={canExpand}
        blockedMessage={blockedMessage}
        direction={direction}
        depth={0}
        onToggle={onToggle}
        onLookup={onLookup}
        extras={snapshot.extras[snapshot.root.id] ?? []}
      />
    </div>
  )
}
