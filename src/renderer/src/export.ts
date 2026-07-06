import type { ExtraShape, Marker, Project, Step, ExportImage } from '../../shared/types'
import { frameUrl } from './media'
import {
  FONT_STACK,
  boxBadgePos,
  boxBadgeRadius,
  boxLabelFontSize,
  boxLabelPos,
  captionMetrics,
  defaultCaptionPos,
  arrowHeadLen,
  extraArrowGeom,
  hexToRgba
} from './markerGeometry'

export function stepLabel(step: Step): string {
  if (step.keyLabel) return `${step.keyLabel} 키`
  if (step.clicks > 1) return '더블클릭'
  if (step.button === 'right') return '우클릭'
  if (step.button === 'middle') return '휠클릭'
  return ''
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = (): void => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

/** 박스 기반 도형(원=타원/사각형/화살표/형광펜)을 그린다. 배지·라벨 제외 */
function drawBoxShape(ctx: CanvasRenderingContext2D, s: Marker | ExtraShape): void {
  ctx.save()
  ctx.globalAlpha = s.opacity
  if (s.shape === 'highlight') {
    ctx.globalCompositeOperation = 'multiply'
    ctx.beginPath()
    ctx.roundRect(s.x, s.y, s.width, s.height, Math.min(s.width, s.height) * 0.12)
    ctx.fillStyle = hexToRgba(s.color, 0.45)
    ctx.fill()
  } else if (s.shape === 'arrow') {
    const g = extraArrowGeom(s, s.arrowTip, arrowHeadLen(s))
    ctx.beginPath()
    ctx.moveTo(g.tail.x, g.tail.y)
    ctx.lineTo(g.lineEnd.x, g.lineEnd.y)
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.strokeWidth
    ctx.lineCap = 'round'
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(g.head[0].x, g.head[0].y)
    ctx.lineTo(g.head[1].x, g.head[1].y)
    ctx.lineTo(g.head[2].x, g.head[2].y)
    ctx.closePath()
    ctx.fillStyle = s.color
    ctx.fill()
  } else {
    ctx.beginPath()
    if (s.shape === 'rect') {
      ctx.roundRect(s.x, s.y, s.width, s.height, Math.min(s.width, s.height) * 0.12)
    } else {
      ctx.ellipse(s.x + s.width / 2, s.y + s.height / 2, s.width / 2, s.height / 2, 0, 0, Math.PI * 2)
    }
    if (s.fill) {
      ctx.fillStyle = s.color + '26'
      ctx.fill()
    }
    ctx.lineWidth = s.strokeWidth
    ctx.strokeStyle = s.color
    ctx.stroke()
  }
  ctx.restore()
}

function drawMarker(ctx: CanvasRenderingContext2D, step: Step, stepNumber: number): void {
  const m = step.marker
  // 사용자가 추가한 도형을 먼저 (클릭 마커·배지 아래에) 그린다
  for (const extra of step.extras) drawBoxShape(ctx, extra)

  if (step.markerHidden) return // 마커 삭제됨 — 프레임/도형만 유지
  drawBoxShape(ctx, m)

  ctx.save()
  ctx.globalAlpha = m.opacity

  // 번호 배지
  if (m.showNumber) {
    const b = boxBadgePos(m)
    const br = boxBadgeRadius(m)
    ctx.beginPath()
    ctx.arc(b.x, b.y, br, 0, Math.PI * 2)
    ctx.fillStyle = m.color
    ctx.fill()
    ctx.lineWidth = Math.max(2, br * 0.12)
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 ${Math.round(br * 1.1)}px ${FONT_STACK}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(stepNumber), b.x, b.y + br * 0.05)
  }

  // 우클릭/더블클릭 라벨
  const label = m.showClickLabel ? stepLabel(step) : ''
  if (label) {
    const p = boxLabelPos(m)
    const fontSize = boxLabelFontSize(m)
    ctx.font = `700 ${fontSize}px ${FONT_STACK}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const ly = p.y + fontSize * 0.35
    ctx.lineWidth = Math.max(3, fontSize * 0.25)
    ctx.strokeStyle = '#ffffff'
    ctx.strokeText(label, p.x, ly)
    ctx.fillStyle = m.color
    ctx.fillText(label, p.x, ly)
  }

  ctx.restore()
}

function drawOverlayCaptions(
  ctx: CanvasRenderingContext2D,
  step: Step,
  videoWidth: number,
  videoHeight: number
): void {
  const style = step.captionStyle
  step.captions.forEach((cap, idx) => {
    const text = cap.text.trim()
    if (!text) return
    const metrics = captionMetrics(text, style)
    const pos = cap.pos ?? defaultCaptionPos(step.marker, metrics, videoWidth, videoHeight, idx)
    ctx.save()
    if (style.boxEnabled) {
      ctx.beginPath()
      ctx.roundRect(pos.x, pos.y, metrics.boxW, metrics.boxH, metrics.fontSize * 0.35)
      ctx.fillStyle = hexToRgba(style.boxColor, style.boxOpacity)
      ctx.fill()
      if (style.borderWidth > 0) {
        ctx.lineWidth = style.borderWidth
        ctx.strokeStyle = style.borderColor
        ctx.stroke()
      }
    }
    ctx.fillStyle = style.color
    ctx.font = `600 ${metrics.fontSize}px ${metrics.fontStack}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    metrics.lines.forEach((line, i) => {
      ctx.fillText(line, pos.x + metrics.padH, pos.y + metrics.padV + i * metrics.lineH)
    })
    ctx.restore()
  })
}

/** 프레임 + 마커(+캡션)를 합성해 PNG dataURL 생성 */
export async function renderStepToPng(
  project: Project,
  step: Step,
  stepNumber: number
): Promise<string> {
  const img = await loadImage(frameUrl(project, step))
  const w = img.naturalWidth
  const h = img.naturalHeight
  // 크롭: 원본 좌표계에서 잘라낼 영역
  const crop = step.crop
  const sx = crop?.x ?? 0
  const sy = crop?.y ?? 0
  const sw = crop?.width ?? w
  const sh = crop?.height ?? h

  // 하단 바 모드: 모든 캡션을 줄바꿈으로 합쳐 한 바에 표시
  const barText = step.captions
    .map((c) => c.text.trim())
    .filter(Boolean)
    .join('  |  ')
  const useBar = barText !== '' && step.captionMode === 'bar'
  const barH = useBar ? Math.max(64, Math.round(sh * 0.07)) : 0

  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh + barH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)

  // 마커·오버레이 캡션은 원본 좌표로 그리므로 크롭만큼 평행이동
  ctx.save()
  ctx.translate(-sx, -sy)
  drawMarker(ctx, step, stepNumber)
  if (step.captionMode === 'overlay') {
    drawOverlayCaptions(ctx, step, w, h)
  }
  ctx.restore()

  if (useBar) {
    ctx.fillStyle = '#1d1d1f'
    ctx.fillRect(0, sh, sw, barH)
    ctx.fillStyle = '#ffffff'
    const fontSize = Math.round(barH * 0.4)
    ctx.font = `600 ${fontSize}px ${FONT_STACK}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${stepNumber}. ${barText}`, Math.round(barH * 0.5), sh + barH / 2, sw - barH)
  }

  return canvas.toDataURL('image/png')
}

export async function renderAllSteps(project: Project): Promise<ExportImage[]> {
  const images: ExportImage[] = []
  for (let i = 0; i < project.steps.length; i++) {
    const dataUrl = await renderStepToPng(project, project.steps[i], i + 1)
    images.push({ fileName: `step-${String(i + 1).padStart(2, '0')}.png`, dataUrl })
  }
  return images
}
