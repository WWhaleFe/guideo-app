import type { Marker, MarkerShape } from '../../shared/types'

export const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Segoe UI', sans-serif"

export interface Point {
  x: number
  y: number
}

/** 지오메트리 계산에 필요한 최소 형태 — Marker와 ExtraShape 모두 이 형태에 부합 */
export interface ShapeLike {
  shape: MarkerShape
  x: number
  y: number
  radius: number
}

export interface ArrowGeom {
  tail: Point
  /** 화살촉이 시작되는 지점 (선은 여기까지) */
  lineEnd: Point
  /** 화살촉 삼각형 꼭짓점 3개 (첫 번째가 클릭 지점) */
  head: [Point, Point, Point]
}

/** 화살표: 클릭 지점을 가리키도록 우하단에서 45°로 들어옴 */
export function arrowGeom(m: ShapeLike): ArrowGeom {
  const { x, y, radius: r } = m
  const tail = { x: x + r * 2.1, y: y + r * 2.1 }
  const len = Math.hypot(tail.x - x, tail.y - y)
  const dir = { x: (x - tail.x) / len, y: (y - tail.y) / len }
  const headLen = Math.max(14, r * 0.75)
  const headW = headLen * 0.9
  const base = { x: x - dir.x * headLen, y: y - dir.y * headLen }
  const perp = { x: -dir.y, y: dir.x }
  return {
    tail,
    lineEnd: base,
    head: [
      { x, y },
      { x: base.x + (perp.x * headW) / 2, y: base.y + (perp.y * headW) / 2 },
      { x: base.x - (perp.x * headW) / 2, y: base.y - (perp.y * headW) / 2 }
    ]
  }
}

export interface RectGeom {
  x: number
  y: number
  width: number
  height: number
  rx: number
}

export function rectGeom(m: ShapeLike): RectGeom {
  const { x, y, radius: r } = m
  return { x: x - r * 1.2, y: y - r * 0.75, width: r * 2.4, height: r * 1.5, rx: r * 0.18 }
}

/** 형광펜: 넓고 납작한 밴드 */
export function highlightGeom(m: ShapeLike): RectGeom {
  const { x, y, radius: r } = m
  return { x: x - r * 1.6, y: y - r * 0.5, width: r * 3.2, height: r, rx: r * 0.12 }
}

export function badgeRadius(m: ShapeLike): number {
  return Math.max(13, m.radius * 0.5)
}

/** 번호 배지 중심 위치 (도형별) */
export function badgePos(m: ShapeLike): Point {
  const br = badgeRadius(m)
  const { x, y, radius: r } = m
  if (m.shape === 'rect') return { x: x + r * 1.2, y: y - r * 0.75 }
  if (m.shape === 'highlight') return { x: x + r * 1.6, y: y - r * 0.5 }
  if (m.shape === 'arrow') {
    const { tail } = arrowGeom(m)
    return { x: tail.x + br * 0.9, y: tail.y + br * 0.9 }
  }
  return { x: x + r * 0.85, y: y - r * 0.85 }
}

/** 우클릭/더블클릭 라벨의 기준 위치 (이 아래에 그려짐) */
export function labelPos(m: ShapeLike): Point {
  const { x, y, radius: r } = m
  if (m.shape === 'rect') return { x, y: y + r * 0.75 }
  if (m.shape === 'highlight') return { x, y: y + r * 0.5 }
  if (m.shape === 'arrow') {
    const { tail } = arrowGeom(m)
    return { x: tail.x, y: tail.y + badgeRadius(m) * 1.6 }
  }
  return { x, y: y + r }
}

/** 자동 배치 시 캡션이 놓일 마커 아래 y 좌표 */
export function markerBottomY(m: ShapeLike): number {
  if (m.shape === 'arrow') return arrowGeom(m).tail.y + badgeRadius(m) * 2
  if (m.shape === 'highlight') return m.y + m.radius * 0.5 + m.radius
  if (m.shape === 'rect') return m.y + rectGeom(m).height * 0.5 + m.radius * 0.5
  return m.y + m.radius * 1.5
}

export function labelFontSize(m: ShapeLike): number {
  return Math.max(15, Math.round(m.radius * 0.55))
}

// ---------- 추가 도형: 바운딩 박스 기반 ----------

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** 핸들의 화면 좌표 */
export function handlePoint(b: Box, h: ResizeHandle): Point {
  const midX = b.x + b.width / 2
  const midY = b.y + b.height / 2
  const right = b.x + b.width
  const bottom = b.y + b.height
  switch (h) {
    case 'nw':
      return { x: b.x, y: b.y }
    case 'n':
      return { x: midX, y: b.y }
    case 'ne':
      return { x: right, y: b.y }
    case 'e':
      return { x: right, y: midY }
    case 'se':
      return { x: right, y: bottom }
    case 's':
      return { x: midX, y: bottom }
    case 'sw':
      return { x: b.x, y: bottom }
    case 'w':
      return { x: b.x, y: midY }
  }
}

export function cursorForHandle(h: ResizeHandle): string {
  switch (h) {
    case 'nw':
    case 'se':
      return 'nwse-resize'
    case 'ne':
    case 'sw':
      return 'nesw-resize'
    case 'n':
    case 's':
      return 'ns-resize'
    case 'e':
    case 'w':
      return 'ew-resize'
  }
}

/** 핸들을 끌었을 때 새 박스 (반대편 고정, 최소 크기 보장) */
export function resizeBox(b: Box, h: ResizeHandle, px: number, py: number, min: number): Box {
  let { x, y, width, height } = b
  const right = b.x + b.width
  const bottom = b.y + b.height
  if (h === 'nw' || h === 'w' || h === 'sw') {
    x = Math.min(px, right - min)
    width = right - x
  }
  if (h === 'ne' || h === 'e' || h === 'se') {
    width = Math.max(min, px - b.x)
  }
  if (h === 'nw' || h === 'n' || h === 'ne') {
    y = Math.min(py, bottom - min)
    height = bottom - y
  }
  if (h === 'sw' || h === 's' || h === 'se') {
    height = Math.max(min, py - b.y)
  }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

type ArrowCorner = 'nw' | 'ne' | 'sw' | 'se'

function cornerPoint(b: Box, c: ArrowCorner): Point {
  switch (c) {
    case 'nw':
      return { x: b.x, y: b.y }
    case 'ne':
      return { x: b.x + b.width, y: b.y }
    case 'sw':
      return { x: b.x, y: b.y + b.height }
    case 'se':
      return { x: b.x + b.width, y: b.y + b.height }
  }
}

function oppositeCorner(c: ArrowCorner): ArrowCorner {
  const map: Record<ArrowCorner, ArrowCorner> = { nw: 'se', se: 'nw', ne: 'sw', sw: 'ne' }
  return map[c]
}

/** 화살촉 길이 (px): 명시값이 있으면 그대로, 없으면 선 굵기 기반 자동 */
export function arrowHeadLen(s: { strokeWidth: number; arrowHead?: number }): number {
  return s.arrowHead ?? Math.max(12, s.strokeWidth * 3)
}

/**
 * 박스 기반 화살표: tip 모서리를 가리키고 반대 모서리에서 들어옴 (기본 nw).
 * 화살촉(head)은 headLen으로 고정 크기 — 박스가 커지면 선분만 길어진다.
 */
export function extraArrowGeom(b: Box, tipCorner: ArrowCorner = 'nw', headLen?: number): ArrowGeom {
  const tip = cornerPoint(b, tipCorner)
  const tail = cornerPoint(b, oppositeCorner(tipCorner))
  const len = Math.hypot(tail.x - tip.x, tail.y - tip.y) || 1
  const dir = { x: (tip.x - tail.x) / len, y: (tip.y - tail.y) / len }
  // 화살촉 길이는 고정, 단 선분 길이의 90%를 넘지 않도록 clamp
  const hl = Math.min(headLen ?? Math.max(18, len * 0.25), len * 0.9)
  const headW = hl * 0.9
  const base = { x: tip.x - dir.x * hl, y: tip.y - dir.y * hl }
  const perp = { x: -dir.y, y: dir.x }
  return {
    tail,
    lineEnd: base,
    head: [
      { x: tip.x, y: tip.y },
      { x: base.x + (perp.x * headW) / 2, y: base.y + (perp.y * headW) / 2 },
      { x: base.x - (perp.x * headW) / 2, y: base.y - (perp.y * headW) / 2 }
    ]
  }
}

/** 선택 표시용 대략적 바운딩 박스 */
export function shapeBBox(m: ShapeLike): RectGeom {
  if (m.shape === 'rect') return rectGeom(m)
  if (m.shape === 'highlight') return highlightGeom(m)
  if (m.shape === 'arrow') {
    const g = arrowGeom(m)
    const xs = [g.tail.x, ...g.head.map((p) => p.x)]
    const ys = [g.tail.y, ...g.head.map((p) => p.y)]
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY, rx: 0 }
  }
  return { x: m.x - m.radius, y: m.y - m.radius, width: m.radius * 2, height: m.radius * 2, rx: 0 }
}

// ---------- 캡션 ----------

/** 캡션에서 선택 가능한 폰트 목록 */
export const CAPTION_FONTS: { value: string; label: string; stack: string }[] = [
  { value: 'system', label: '시스템 고딕', stack: FONT_STACK },
  {
    value: 'serif',
    label: '명조 (세리프)',
    stack: "'AppleMyungjo', 'Noto Serif KR', Georgia, serif"
  },
  {
    value: 'mono',
    label: '모노스페이스',
    stack: "Menlo, Monaco, 'Apple SD Gothic Neo', monospace"
  },
  {
    value: 'round',
    label: '둥근 고딕',
    stack: "'Arial Rounded MT Bold', 'Apple SD Gothic Neo', sans-serif"
  }
]

export function fontStackOf(fontKey: string): string {
  return CAPTION_FONTS.find((f) => f.value === fontKey)?.stack ?? FONT_STACK
}

/** #RRGGBB + 알파(0~1) → rgba() 문자열 */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export interface CaptionMetrics {
  lines: string[]
  boxW: number
  boxH: number
  padH: number
  padV: number
  lineH: number
  fontSize: number
  fontStack: string
}

let measureCtx: CanvasRenderingContext2D | null = null

/** 캡션 박스 크기 계산 — 에디터 미리보기와 내보내기가 동일한 측정을 사용 */
export function captionMetrics(
  text: string,
  style: { font: string; fontSize: number }
): CaptionMetrics {
  const fontSize = style.fontSize
  const fontStack = fontStackOf(style.font)
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')
  }
  const ctx = measureCtx!
  ctx.font = `600 ${fontSize}px ${fontStack}`
  const lines = text.split('\n')
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width), 1)
  const padH = fontSize * 0.75
  const padV = fontSize * 0.5
  const lineH = fontSize * 1.35
  return {
    lines,
    boxW: Math.round(textW + padH * 2),
    boxH: Math.round(lines.length * lineH + padV * 2),
    padH,
    padV,
    lineH,
    fontSize,
    fontStack
  }
}

/** pos가 없을 때 박스 아래 자동 배치. index로 여러 캡션을 세로로 쌓음 */
export function defaultCaptionPos(
  b: Box,
  metrics: CaptionMetrics,
  videoWidth: number,
  videoHeight: number,
  index = 0
): Point {
  const cx = b.x + b.width / 2
  const below = b.y + b.height + index * (metrics.boxH + metrics.fontSize * 0.4)
  return {
    x: Math.max(8, Math.min(cx - metrics.boxW / 2, videoWidth - metrics.boxW - 8)),
    y: Math.max(8, Math.min(below, videoHeight - metrics.boxH - 8))
  }
}

// ---------- 박스 기반 배지/라벨 (마커) ----------

export function boxBadgeRadius(b: Box): number {
  return Math.max(14, Math.round(Math.min(b.width, b.height) * 0.32))
}

/** 번호 배지: 박스 우상단 모서리 */
export function boxBadgePos(b: Box): Point {
  return { x: b.x + b.width, y: b.y }
}

/** 우클릭/더블클릭 라벨: 박스 아래 중앙 */
export function boxLabelPos(b: Box): Point {
  return { x: b.x + b.width / 2, y: b.y + b.height }
}

export function boxLabelFontSize(b: Box): number {
  return Math.max(15, Math.round(Math.min(b.width, b.height) * 0.34))
}
