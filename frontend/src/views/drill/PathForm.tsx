import { useMemo, useState } from 'react'

import { DIMENSIONS, MAX_LEVELS, METRICS } from '@/data/drill/dataset'
import { validatePath } from '@/data/drill/engine'
import type { DrillPath, PathConfigInput, SortDirection } from '@/data/drill/types'

interface Props {
  initial?: DrillPath | null
  onSubmit: (input: PathConfigInput) => void
  onCancel: () => void
  disabled: boolean
}

function blankForm(): PathConfigInput {
  return {
    code: '',
    name: '',
    rootDimension: DIMENSIONS[0].name,
    levels: [],
    metric: METRICS[0].name,
    defaultExpand: 1,
    sortDirection: 'asc',
    maxRows: 5,
    ownerGroup: '华北组',
  }
}

function fromPath(path: DrillPath): PathConfigInput {
  const { id: _id, status: _status, version: _version, updatedAt: _time, validationIssues: _issues, ...config } = path
  return { ...config, levels: [...config.levels] }
}

export default function PathForm({ initial, onSubmit, onCancel, disabled }: Props) {
  const [form, setForm] = useState<PathConfigInput>(() => (initial ? fromPath(initial) : blankForm()))
  const [levelText, setLevelText] = useState(() => (initial ? initial.levels.join('、') : ''))
  const validation = useMemo(() => validatePath(form), [form])

  function patch<K extends keyof PathConfigInput>(key: K, value: PathConfigInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function submit() {
    const levels = levelText
      .split(/[、,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
    const payload: PathConfigInput = { ...form, levels }
    const result = validatePath(payload)
    if (result.errors.length > 0) return
    onSubmit(payload)
  }

  return (
    <form
      className="drill-form card"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <h4>{initial ? `编辑路径 ${initial.code}（当前 v${initial.version}）` : '登记下钻路径'}</h4>
      <div className="form-grid">
        <label>
          <span>路径编号</span>
          <input value={form.code} disabled={disabled} onChange={(e) => patch('code', e.target.value)} />
        </label>
        <label>
          <span>路径名称</span>
          <input value={form.name} disabled={disabled} onChange={(e) => patch('name', e.target.value)} />
        </label>
        <label>
          <span>起点维度（先读层级维度目录）</span>
          <select value={form.rootDimension} disabled={disabled} onChange={(e) => patch('rootDimension', e.target.value)}>
            {DIMENSIONS.map((dim) => <option key={dim.name} value={dim.name}>{dim.name}</option>)}
          </select>
        </label>
        <label>
          <span>层级维度列表（顿号/逗号分隔，未登记维度运行时标断点）</span>
          <input value={levelText} disabled={disabled} placeholder="如：省份、城市、渠道" onChange={(e) => setLevelText(e.target.value)} />
        </label>
        <label>
          <span>聚合指标</span>
          <select value={form.metric} disabled={disabled} onChange={(e) => patch('metric', e.target.value)}>
            {METRICS.map((metric) => <option key={metric.name} value={metric.name}>{metric.name}（{metric.type}）</option>)}
          </select>
        </label>
        <label>
          <span>默认展开层（只影响之后生成的快照）</span>
          <input
            type="number"
            value={form.defaultExpand}
            disabled={disabled}
            onChange={(e) => patch('defaultExpand', Number(e.target.value))}
          />
        </label>
        <label>
          <span>最多展示行数（超出的节点可单独查找）</span>
          <input
            type="number"
            value={form.maxRows}
            disabled={disabled}
            onChange={(e) => patch('maxRows', Number(e.target.value))}
          />
        </label>
        <label>
          <span>排序方向（只改同层顺序，不重算）</span>
          <select
            value={form.sortDirection}
            disabled={disabled}
            onChange={(e) => patch('sortDirection', e.target.value as SortDirection)}
          >
            <option value="asc">升序</option>
            <option value="desc">降序</option>
          </select>
        </label>
        <label>
          <span>数据归属授权组</span>
          <select value={form.ownerGroup} disabled={disabled} onChange={(e) => patch('ownerGroup', e.target.value)}>
            {['华北组', '华东组', '华南组'].map((group) => <option key={group} value={group}>{group}</option>)}
          </select>
        </label>
      </div>
      <div className="form-checks">
        <p className="hint">最大下钻层数 {MAX_LEVELS}；负值、零值或越界会直接阻断保存。</p>
        {validation.errors.map((message) => <p key={message} className="check-error">阻断：{message}</p>)}
        {validation.warnings.map((message) => <p key={message} className="check-warn">提示：{message}</p>)}
      </div>
      <div className="form-actions">
        <button className="btn primary" type="submit" disabled={disabled || validation.errors.length > 0}>保存路径快照配置</button>
        <button className="btn ghost" type="button" disabled={disabled} onClick={onCancel}>取消</button>
      </div>
    </form>
  )
}
