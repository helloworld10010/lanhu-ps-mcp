/**
 * PS 设计稿解析器 —— 将蓝湖 PS 版原始 JSON 转换为结构化节点树
 *
 * PS JSON 字段映射：
 *   textInfo.color.{r,g,b} (0-255)  → 文字颜色
 *   textInfo.size                   → 字号(pt)
 *   textInfo.fontPostScriptName     → 字体
 *   textInfo.justification          → 对齐
 *   fill.color.{red,green,blue}     → 背景色
 *   strokeStyle.strokeStyleContent.color → 边框色
 *   strokeStyle.strokeStyleLineWidth    → 边框宽度
 *   _orgBounds.{top,left,bottom,right}  → 位置 + 尺寸
 *   path.pathComponents[0].origin.radii → 圆角
 *
 * @param {object} psRoot - info[0] (page node)
 * @returns {object[]} 结构化节点树
 */

// color: {red, green, blue} (0-255) → "#RRGGBB"
function rgbToHex(red, green, blue) {
  const r = Math.round(red ?? 0)
  const g = Math.round(green ?? 0)
  const b = Math.round(blue ?? 0)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/** 提取 UnoCSS class 字符串 */
function buildClass(layer) {
  const classes = []

  // 尺寸 & 位置（_orgBounds: {top, left, bottom, right}）
  const b = layer._orgBounds
  if (b) {
    const w = Math.round(b.right - b.left)
    const h = Math.round(b.bottom - b.top)
    if (w > 0) classes.push(`w-${w}px`)
    if (h > 0) classes.push(`h-${h}px`)
    classes.push(`absolute`)
    classes.push(`left-${Math.round(b.left)}px`)
    classes.push(`top-${Math.round(b.top)}px`)
  }

  // ---------- textLayer ----------
  if (layer.type === 'textLayer' && layer.textInfo) {
    const ti = layer.textInfo
    // 颜色
    if (ti.color) {
      classes.push(`text-[${rgbToHex(ti.color.r, ti.color.g, ti.color.b)}]`)
    }
    // 字号
    if (ti.size) {
      classes.push(`text-${Math.round(ti.size)}px`)
    }
    // 对齐
    if (ti.justification) {
      const map = { center: 'text-center', right: 'text-right', left: 'text-left' }
      if (map[ti.justification]) classes.push(map[ti.justification])
    }
    // 行高
    if (ti.leading) {
      classes.push(`leading-${Math.round(ti.leading)}px`)
    }
  }

  // ---------- shapeLayer ----------
  if (layer.type === 'shapeLayer') {
    // 填充色
    if (layer.fill?.color) {
      const c = layer.fill.color
      classes.push(`bg-[${rgbToHex(c.red, c.green, c.blue)}]`)
    }
    // 边框
    const ss = layer.strokeStyle
    if (ss?.strokeEnabled) {
      const w = ss.strokeStyleLineWidth ?? 1
      classes.push(`border-${Math.round(w)}px`)
      classes.push('border-solid')
      if (ss.strokeStyleContent?.color) {
        const c = ss.strokeStyleContent.color
        classes.push(`border-[${rgbToHex(c.red, c.green, c.blue)}]`)
      }
    }
    // 圆角
    if (layer.path?.pathComponents?.[0]?.origin?.radii) {
      const r = layer.path.pathComponents[0].origin.radii
      // radii can be array or object
      if (Array.isArray(r) && r.length === 4) {
        if (r[0] === r[1] && r[1] === r[2] && r[2] === r[3] && r[0] > 0) {
          classes.push(`rounded-${Math.round(r[0])}px`)
        }
      } else if (typeof r === 'object') {
        const vals = [r.topLeft ?? r[0], r.topRight ?? r[1], r.bottomRight ?? r[2], r.bottomLeft ?? r[3]]
        if (vals[0] === vals[1] && vals[1] === vals[2] && vals[2] === vals[3] && vals[0] > 0) {
          classes.push(`rounded-${Math.round(vals[0])}px`)
        }
      }
    }
  }

  // 透明度（PS 用 fill.opacity 或整体 opacity）
  if (layer.fill?.opacity?.value) {
    const pct = Math.round(layer.fill.opacity.value)
    if (pct < 100) classes.push(`opacity-${pct}`)
  }

  return classes.join(' ')
}

/** 判断是否为图片/切图节点 */
function isImageNode(layer) {
  return layer.isAsset === true || layer.isSlice === true || !!layer.images
}

/** 获取图片 URL */
function getImageUrl(layer) {
  return layer.images?.orgUrl || null
}

/** 获取子节点列表 */
function getChildren(layer) {
  if (Array.isArray(layer.visible)) return layer.visible
  if (Array.isArray(layer.layers)) return layer.layers
  return []
}

/** 是否应该剪枝 */
function shouldPrune(layer) {
  if (!layer) return true
  if (layer.visible === false) return true
  const name = layer.name || ''
  if (name.startsWith('__lanhu') || name.startsWith('_annotation')) return true
  return false
}

/** 分类图片类型 */
function classifyImage(layer) {
  const b = layer._orgBounds
  if (!b) return 'img'
  const w = Math.abs(b.right - b.left)
  const h = Math.abs(b.bottom - b.top)
  const max = Math.max(w, h)
  if (max <= 128) return 'icon'
  if (w >= 600) return 'bg'
  return 'img'
}

/**
 * 递归处理单个图层
 * @param {object} layer
 * @returns {object|null}
 */
function processLayer(layer) {
  if (shouldPrune(layer)) return null

  const name = layer.name || ''
  const type = layer.type || ''
  const children = getChildren(layer)

  // 图片/切图
  if (isImageNode(layer)) {
    const node = {
      type: classifyImage(layer),
      name,
      class: buildClass(layer),
    }
    const url = getImageUrl(layer)
    if (url) node.imageRef = url
    return node
  }

  // 文字层
  if (type === 'textLayer') {
    return {
      type: 'text',
      name,
      class: buildClass(layer),
      text: typeof layer.text === 'string' ? layer.text : (layer.textInfo?.text || ''),
      fontFamily: layer.textInfo?.fontPostScriptName || layer.textInfo?.fontName || '',
    }
  }

  // 形状层
  if (type === 'shapeLayer') {
    return {
      type: 'shape',
      name,
      class: buildClass(layer),
    }
  }

  // 容器：递归处理子节点
  if (children.length > 0) {
    const processed = children.map(processLayer).filter(Boolean)
    if (processed.length === 0) return null
    if (processed.length === 1) return processed[0] // 单子节点扁平化

    return {
      type: 'container',
      name,
      class: buildClass(layer),
      children: processed,
    }
  }

  // 兜底：有 bounds 的形状
  if (layer._orgBounds) {
    return {
      type: 'shape',
      name,
      class: buildClass(layer),
    }
  }

  return null
}

/**
 * 解析 PS 设计稿
 * @param {object} psRoot - info[0] 页面节点
 * @param {number} sliceScale
 * @returns {object[]}
 */
export function parsePSJson(psRoot, sliceScale = 2) {
  if (!psRoot) return []

  // 页面下 children 在 visible 数组中
  const pageLayers = psRoot.visible || psRoot.layers || []

  const nodes = pageLayers
    .map(processLayer)
    .filter(Boolean)

  return nodes
}

/**
 * 收集节点树中所有图片引用
 * @param {object[]} nodes
 * @returns {{url: string, category: string}[]}
 */
export function collectImageRefs(nodes) {
  const refs = []
  function walk(list) {
    for (const n of list) {
      if (n.imageRef) refs.push({ url: n.imageRef, category: n.type })
      if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return refs
}
