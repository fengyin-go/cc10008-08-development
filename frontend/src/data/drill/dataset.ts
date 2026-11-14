import type { DimensionDef, DrillFact, MetricDef, PathConfigInput, PathStatus } from './types'

/** 层级维度目录：下钻每一层先读这里；不在目录里的维度在计算时标「断点」。 */
export const DIMENSIONS: DimensionDef[] = [
  { name: '区域', values: ['华北', '华东', '华南', '西南'] },
  { name: '省份', values: ['北京', '上海', '广东', '浙江', '江苏', '四川'] },
  { name: '城市', values: ['北京市', '上海市', '广州市', '深圳市', '杭州市', '南京市', '苏州市', '成都市', '通州'] },
  { name: '渠道', values: ['线上', '门店', '经销'] },
  { name: '品类', values: ['家电', '服饰', '食品'] },
  // 白名单为空：SKU 不做取值登记，任何非空值都按普通值处理。
  { name: 'SKU', values: null },
]

export const METRICS: MetricDef[] = [
  { name: '销售额', type: 'sum', field: 'amount' },
  { name: '销量', type: 'sum', field: 'qty' },
  { name: '客单价', type: 'avg', field: 'amount' },
]

export const AUTH_GROUPS = ['华北组', '华东组', '华南组'] as const

/**
 * 事实数据。刻意埋了三类口径：
 * - null：城市/渠道空值（北京、江苏、浙江、广东四个分支都有空城市）；
 * - 未知值：省份「天津/广西/海南」、城市「天津市/温州市/南宁市/三亚市」、渠道「社群团购」均不在白名单；
 * - 重复值：城市「通州」同时挂在北京与江苏两个分支下。
 */
export const FACTS: DrillFact[] = [
  { id: 1, group: '华北组', region: '华北', province: '北京', city: '北京市', channel: '线上', category: '家电', sku: 'SKU-A1', amount: 12000, qty: 30 },
  { id: 2, group: '华北组', region: '华北', province: '北京', city: '北京市', channel: '门店', category: '家电', sku: 'SKU-A2', amount: 8000, qty: 12 },
  { id: 3, group: '华北组', region: '华北', province: '北京', city: '通州', channel: '经销', category: '食品', sku: 'SKU-F1', amount: 3200, qty: 160 },
  { id: 4, group: '华北组', region: '华北', province: '北京', city: null, channel: '线上', category: '服饰', sku: 'SKU-C1', amount: 5400, qty: 45 },
  { id: 5, group: '华北组', region: '华北', province: '天津', city: '天津市', channel: '门店', category: '食品', sku: 'SKU-F12', amount: 2700, qty: 90 },
  { id: 6, group: '华东组', region: '华东', province: '上海', city: '上海市', channel: '线上', category: '家电', sku: 'SKU-A3', amount: 21000, qty: 40 },
  { id: 7, group: '华东组', region: '华东', province: '上海', city: '上海市', channel: '门店', category: '服饰', sku: 'SKU-C2', amount: 7600, qty: 33 },
  { id: 8, group: '华东组', region: '华东', province: '浙江', city: '杭州市', channel: '线上', category: '家电', sku: 'SKU-A4', amount: 15000, qty: 22 },
  { id: 9, group: '华东组', region: '华东', province: '浙江', city: '杭州市', channel: '经销', category: '食品', sku: 'SKU-F2', amount: 4100, qty: 180 },
  { id: 10, group: '华东组', region: '华东', province: '浙江', city: '温州市', channel: '门店', category: '服饰', sku: 'SKU-C3', amount: 6200, qty: 28 },
  { id: 11, group: '华东组', region: '华东', province: '江苏', city: '南京市', channel: '线上', category: '家电', sku: 'SKU-A5', amount: 9800, qty: 17 },
  { id: 12, group: '华东组', region: '华东', province: '江苏', city: '苏州市', channel: '门店', category: '家电', sku: 'SKU-A6', amount: 11000, qty: 19 },
  { id: 13, group: '华东组', region: '华东', province: '江苏', city: '通州', channel: '经销', category: '食品', sku: 'SKU-F3', amount: 2800, qty: 95 },
  { id: 14, group: '华东组', region: '华东', province: '江苏', city: null, channel: '线上', category: '服饰', sku: 'SKU-C4', amount: 3300, qty: 21 },
  { id: 15, group: '华东组', region: '华东', province: '浙江', city: '杭州市', channel: '社群团购', category: '食品', sku: 'SKU-F4', amount: 2600, qty: 130 },
  { id: 16, group: '华东组', region: '华东', province: '上海', city: '上海市', channel: null, category: '家电', sku: 'SKU-A7', amount: 5000, qty: 9 },
  { id: 17, group: '华南组', region: '华南', province: '广东', city: '广州市', channel: '线上', category: '家电', sku: 'SKU-A8', amount: 18500, qty: 26 },
  { id: 18, group: '华南组', region: '华南', province: '广东', city: '广州市', channel: '门店', category: '服饰', sku: 'SKU-C5', amount: 7200, qty: 31 },
  { id: 19, group: '华南组', region: '华南', province: '广东', city: '深圳市', channel: '线上', category: '家电', sku: 'SKU-A9', amount: 16400, qty: 24 },
  { id: 20, group: '华南组', region: '华南', province: '广东', city: '深圳市', channel: '经销', category: '食品', sku: 'SKU-F5', amount: 4800, qty: 210 },
  { id: 21, group: '华南组', region: '华南', province: '广东', city: null, channel: '门店', category: '食品', sku: 'SKU-F6', amount: 1900, qty: 80 },
  { id: 22, group: '华南组', region: '华南', province: '广西', city: '南宁市', channel: '门店', category: '家电', sku: 'SKU-A10', amount: 5300, qty: 11 },
  { id: 23, group: '华南组', region: '华南', province: '广东', city: '广州市', channel: '社群团购', category: '服饰', sku: 'SKU-C6', amount: 2100, qty: 12 },
  { id: 24, group: '华南组', region: '华南', province: '海南', city: '三亚市', channel: '线上', category: '家电', sku: 'SKU-A11', amount: 4400, qty: 8 },
  { id: 25, group: '华北组', region: '华北', province: '北京', city: '北京市', channel: '线上', category: '食品', sku: 'SKU-F7', amount: 2200, qty: 110 },
  { id: 26, group: '华北组', region: '华北', province: '北京', city: '北京市', channel: '门店', category: '服饰', sku: 'SKU-C7', amount: 3800, qty: 26 },
  { id: 27, group: '华东组', region: '华东', province: '上海', city: '上海市', channel: '线上', category: '服饰', sku: 'SKU-C8', amount: 9100, qty: 40 },
  { id: 28, group: '华东组', region: '华东', province: '浙江', city: '杭州市', channel: '门店', category: '家电', sku: 'SKU-A12', amount: 7700, qty: 13 },
  { id: 29, group: '华东组', region: '华东', province: '江苏', city: '苏州市', channel: '线上', category: '食品', sku: 'SKU-F8', amount: 3600, qty: 150 },
  { id: 30, group: '华南组', region: '华南', province: '广东', city: '深圳市', channel: '门店', category: '服饰', sku: 'SKU-C9', amount: 6800, qty: 29 },
  { id: 31, group: '华南组', region: '华南', province: '广东', city: '广州市', channel: '经销', category: '食品', sku: 'SKU-F9', amount: 5200, qty: 240 },
  { id: 32, group: '华北组', region: '华北', province: '天津', city: '天津市', channel: '线上', category: '家电', sku: 'SKU-A13', amount: 6100, qty: 10 },
  { id: 33, group: '华东组', region: '华东', province: '浙江', city: null, channel: '经销', category: '家电', sku: 'SKU-A14', amount: 2400, qty: 6 },
  { id: 34, group: '华南组', region: '华南', province: '广东', city: '深圳市', channel: '线上', category: '食品', sku: 'SKU-F10', amount: 1700, qty: 75 },
  { id: 35, group: '华东组', region: '华东', province: '江苏', city: '南京市', channel: '门店', category: '服饰', sku: 'SKU-C10', amount: 4500, qty: 18 },
  { id: 36, group: '华北组', region: '华北', province: '北京', city: '通州', channel: '线上', category: '食品', sku: 'SKU-F11', amount: 1500, qty: 60 },
  // 华东组内也有同名「通州」：浙江下的通州与江苏下的通州构成同授权组内跨分支重复值。
  { id: 37, group: '华东组', region: '华东', province: '浙江', city: '通州', channel: '门店', category: '服饰', sku: 'SKU-C11', amount: 2300, qty: 14 },
]

/** 下钻层数上限：层数或默认展开层越界直接给出阻断理由。 */
export const MAX_LEVELS = 6

type SeedPath = PathConfigInput & { status: PathStatus }

export const SEED_PATHS: SeedPath[] = [
  {
    code: 'DRIL-0001',
    name: '区域销售逐层下钻',
    rootDimension: '区域',
    levels: ['省份', '城市', '渠道', '品类'],
    metric: '销售额',
    defaultExpand: 2,
    sortDirection: 'asc',
    maxRows: 2,
    ownerGroup: '华东组',
    status: '已启用',
  },
  {
    code: 'DRIL-0002',
    name: '渠道品类销量下钻',
    rootDimension: '渠道',
    levels: ['品类'],
    metric: '销量',
    defaultExpand: 1,
    sortDirection: 'desc',
    maxRows: 3,
    ownerGroup: '华南组',
    status: '待校验',
  },
  {
    code: 'DRIL-0003',
    name: '含断点的深度下钻',
    rootDimension: '区域',
    levels: ['省份', '城市', '渠道', '品类', 'SKU', '未登记维度'],
    metric: '销售额',
    defaultExpand: 1,
    sortDirection: 'asc',
    maxRows: 8,
    ownerGroup: '华北组',
    status: '草稿',
  },
  {
    code: 'DRIL-0004',
    name: '停用路径只读演示',
    rootDimension: '区域',
    levels: ['省份', '城市'],
    metric: '客单价',
    defaultExpand: 1,
    sortDirection: 'desc',
    maxRows: 4,
    ownerGroup: '华东组',
    status: '已停用',
  },
]
