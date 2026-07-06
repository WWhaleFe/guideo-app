import type { CaptionItem, CaptionStyle, ExtraShape, Marker, Project, Step } from './types'

export function defaultStrokeWidth(radius: number): number {
  return Math.max(3, Math.round(radius * 0.16))
}

export function defaultCaptionFontSize(videoWidth: number): number {
  return Math.max(28, Math.round(videoWidth * 0.022))
}

export function defaultCaptionStyle(videoWidth: number): CaptionStyle {
  return {
    font: 'system',
    fontSize: defaultCaptionFontSize(videoWidth),
    color: '#ffffff',
    boxEnabled: true,
    boxColor: '#1d1d1f',
    boxOpacity: 0.88,
    borderColor: '#ffffff',
    borderWidth: 0
  }
}

/** 구버전(중심+반지름) 추가 도형을 박스 모델로 변환 */
function normalizeExtra(e: ExtraShape & { radius?: number }): ExtraShape {
  if (typeof e.width === 'number' && typeof e.height === 'number') return e
  const r = e.radius ?? 60
  return {
    id: e.id,
    shape: e.shape,
    x: Math.round(e.x - r),
    y: Math.round(e.y - r),
    width: Math.round(r * 2),
    height: Math.round(r * 2),
    color: e.color,
    arrowTip: e.arrowTip,
    strokeWidth: e.strokeWidth,
    fill: e.fill,
    opacity: e.opacity
  }
}

let idCounter = 0
export function genId(prefix = 'id'): string {
  idCounter += 1
  return `${prefix}-${idCounter}-${idCounter * 2654435761}`
}

/** 이전 버전 project.json에 없는 필드를 기본값으로 채운다 */
export function normalizeProject(project: Project): Project {
  return {
    ...project,
    region: project.region ?? null,
    steps: project.steps.map((s) => normalizeStep(s, project.videoWidth))
  }
}

interface LegacyStep extends Step {
  caption?: string
  captionPos?: { x: number; y: number } | null
}

/** 구버전(중심+반지름) 마커를 박스 모델로 변환 */
function normalizeMarker(m: Partial<Marker> & { radius?: number }): Marker {
  const shape = m.shape ?? 'circle'
  let x = m.x ?? 0
  let y = m.y ?? 0
  let width = m.width
  let height = m.height
  if (typeof width !== 'number' || typeof height !== 'number') {
    const r = m.radius ?? 60
    // 구버전 렌더 비율에 맞춰 박스 크기 산출 (x,y는 중심 → 좌상단으로 변환)
    if (shape === 'rect') {
      width = r * 2.4
      height = r * 1.5
    } else if (shape === 'highlight') {
      width = r * 3.2
      height = r
    } else {
      width = r * 2
      height = r * 2
    }
    x = (m.x ?? 0) - width / 2
    y = (m.y ?? 0) - height / 2
  }
  const radius = m.radius ?? Math.round(Math.min(width, height) / 2)
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    color: m.color ?? '#FF3B30',
    shape,
    arrowTip: m.arrowTip,
    arrowHead: m.arrowHead,
    strokeWidth: m.strokeWidth ?? defaultStrokeWidth(radius),
    fill: m.fill ?? false,
    opacity: m.opacity ?? 1,
    showNumber: m.showNumber ?? false,
    showClickLabel: m.showClickLabel ?? true
  }
}

function normalizeStep(step: Step, videoWidth: number): Step {
  const legacy = step as LegacyStep
  const styleIn = (step.captionStyle ?? {}) as Partial<CaptionStyle>
  const fallbackStyle = defaultCaptionStyle(videoWidth || 1920)

  // 구버전(단일 caption 문자열) → captions 배열로 마이그레이션
  let captions: CaptionItem[]
  if (Array.isArray(step.captions)) {
    captions = step.captions
  } else if (legacy.caption && legacy.caption.trim() !== '') {
    captions = [{ id: `${step.id}-cap0`, text: legacy.caption, pos: legacy.captionPos ?? null }]
  } else {
    captions = []
  }

  return {
    id: step.id,
    videoTimeSec: step.videoTimeSec,
    button: step.button,
    clicks: step.clicks,
    markerHidden: step.markerHidden ?? false,
    keyLabel: step.keyLabel,
    extras: Array.isArray(step.extras) ? step.extras.map(normalizeExtra) : [],
    captions,
    captionMode: step.captionMode ?? 'overlay',
    captionStyle: { ...fallbackStyle, ...styleIn },
    crop: step.crop ?? null,
    frameFile: step.frameFile,
    marker: normalizeMarker(step.marker as Partial<Marker> & { radius?: number })
  }
}
