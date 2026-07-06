import { app, nativeImage, screen } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { remux, extractFrame, CropPx } from './frames'
import { getDefaults } from './settings'
import {
  defaultCaptionStyle,
  defaultStrokeWidth,
  normalizeProject
} from '../shared/normalize'
import type { Project, RawClickEvent, Region, Step, ExportImage } from '../shared/types'

/** 클릭 "직전" 화면을 잡기 위한 오프셋 (초) */
const PRE_CLICK_OFFSET = 0.08

const MARKER_COLORS: Record<string, string> = {
  left: '#FF3B30',
  right: '#007AFF',
  middle: '#8E8E93'
}

export function projectsRoot(): string {
  return path.join(app.getPath('documents'), 'Guideo')
}

function timestampName(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export interface BuildInput {
  videoBuffer: Buffer
  /** MediaRecorder onstart 시각 (epoch ms) */
  t0: number
  /** 녹화 대상 디스플레이의 Electron display id */
  displayId: number
  /** 영역 녹화 시 선택 영역 (전역 화면 좌표, 포인트) */
  region?: Region | null
  events: RawClickEvent[]
}

export async function buildProject(input: BuildInput): Promise<Project> {
  const created = new Date()
  const name = timestampName(created)
  const dir = path.join(projectsRoot(), name)
  await fs.mkdir(path.join(dir, 'frames'), { recursive: true })

  const rawPath = path.join(dir, 'raw.webm')
  const videoFile = 'recording.webm'
  const videoPath = path.join(dir, videoFile)
  await fs.writeFile(rawPath, input.videoBuffer)
  try {
    await remux(rawPath, videoPath)
    await fs.rm(rawPath)
  } catch {
    await fs.rename(rawPath, videoPath)
  }

  // 영상 실제 해상도: 첫 프레임을 뽑아 측정 (Retina 배율을 정확히 반영)
  const probePng = path.join(dir, 'frames', 'probe.png')
  let videoWidth = 0
  let videoHeight = 0
  if (await extractFrame(videoPath, 0, probePng)) {
    const size = nativeImage.createFromPath(probePng).getSize()
    videoWidth = size.width
    videoHeight = size.height
    await fs.rm(probePng, { force: true })
  }

  const display =
    screen.getAllDisplays().find((d) => d.id === input.displayId) ?? screen.getPrimaryDisplay()
  const scaleX = videoWidth > 0 ? videoWidth / display.bounds.width : display.scaleFactor
  const scaleY = videoHeight > 0 ? videoHeight / display.bounds.height : display.scaleFactor

  // 영역 녹화: 영상은 전체 화면으로 녹화하고, 프레임 추출 시 선택 영역만 크롭
  const region = input.region ?? null
  let crop: CropPx | null = null
  if (region && videoWidth > 0) {
    const cx = Math.round((region.x - display.bounds.x) * scaleX)
    const cy = Math.round((region.y - display.bounds.y) * scaleY)
    const cw = Math.round(region.width * scaleX)
    const ch = Math.round(region.height * scaleY)
    crop = {
      x: Math.max(0, Math.min(cx, videoWidth - 2)),
      y: Math.max(0, Math.min(cy, videoHeight - 2)),
      width: Math.max(2, Math.min(cw, videoWidth - Math.max(0, cx))),
      height: Math.max(2, Math.min(ch, videoHeight - Math.max(0, cy)))
    }
  }
  const outWidth = crop ? crop.width : videoWidth
  const outHeight = crop ? crop.height : videoHeight

  // 사용자가 저장한 앱 기본 스타일 (없으면 내장 기본값)
  const defaults = await getDefaults()
  const markerRadius = defaults?.marker.width
    ? Math.round(defaults.marker.width / 2)
    : Math.max(24, Math.round((outWidth || 1920) * 0.022))
  const captionStyle = defaults?.captionStyle ?? defaultCaptionStyle(outWidth || 1920)
  const captionMode = defaults?.captionMode ?? 'overlay'

  const steps: Step[] = []
  for (const ev of input.events) {
    if (ev.time <= input.t0) continue
    // 영역 밖 클릭/드래그는 스텝에서 제외 (키 입력은 예외)
    if (
      region &&
      ev.kind !== 'key' &&
      (ev.x < region.x ||
        ev.x > region.x + region.width ||
        ev.y < region.y ||
        ev.y > region.y + region.height)
    ) {
      continue
    }
    const videoTimeSec = (ev.time - input.t0) / 1000 - PRE_CLICK_OFFSET
    const frameFile = path.join('frames', `step-${String(steps.length + 1).padStart(2, '0')}.png`)
    const ok = await extractFrame(videoPath, videoTimeSec, path.join(dir, frameFile), crop)
    if (!ok) continue
    const originX = region ? region.x : display.bounds.x
    const originY = region ? region.y : display.bounds.y
    const color = defaults?.marker.color ?? MARKER_COLORS[ev.button] ?? MARKER_COLORS.left
    const commonStyle = {
      color,
      strokeWidth: defaults?.marker.strokeWidth ?? defaultStrokeWidth(markerRadius),
      fill: defaults?.marker.fill ?? false,
      opacity: defaults?.marker.opacity ?? 1,
      showNumber: defaults?.marker.showNumber ?? false,
      showClickLabel: defaults?.marker.showClickLabel ?? true
    }

    const boxW = defaults?.marker.width ?? markerRadius * 2
    const boxH = defaults?.marker.height ?? markerRadius * 2
    const markerShape = defaults?.marker.shape ?? 'circle'
    const circleAt = (px: number, py: number): Step['marker'] => ({
      x: Math.round(px - boxW / 2),
      y: Math.round(py - boxH / 2),
      width: Math.round(boxW),
      height: Math.round(boxH),
      shape: markerShape,
      ...commonStyle
    })

    const cx = Math.round((ev.x - originX) * scaleX)
    const cy = Math.round((ev.y - originY) * scaleY)
    const marker = circleAt(cx, cy)
    const extras: Step['extras'] = []

    if (ev.kind === 'drag' && ev.x2 != null && ev.y2 != null) {
      // 드래그 → 시작점 마커(위) + 끝점 마커 + 시작→끝 화살표
      const exx = Math.round((ev.x2 - originX) * scaleX)
      const eyy = Math.round((ev.y2 - originY) * scaleY)
      const bx = Math.min(cx, exx)
      const by = Math.min(cy, eyy)
      const bw = Math.max(12, Math.abs(exx - cx))
      const bh = Math.max(12, Math.abs(eyy - cy))
      const tip = `${eyy >= cy ? 's' : 'n'}${exx >= cx ? 'e' : 'w'}` as 'nw' | 'ne' | 'sw' | 'se'
      // 경로 화살표
      extras.push({
        id: crypto.randomUUID(),
        shape: 'arrow',
        x: bx,
        y: by,
        width: bw,
        height: bh,
        arrowTip: tip,
        arrowHead: Math.round(markerRadius * 0.9),
        color: commonStyle.color,
        strokeWidth: commonStyle.strokeWidth,
        fill: false,
        opacity: commonStyle.opacity
      })
      // 끝점 마커
      const endCircle = circleAt(exx, eyy)
      extras.push({
        id: crypto.randomUUID(),
        shape: markerShape === 'arrow' ? 'circle' : markerShape,
        x: endCircle.x,
        y: endCircle.y,
        width: endCircle.width,
        height: endCircle.height,
        color: commonStyle.color,
        strokeWidth: commonStyle.strokeWidth,
        fill: commonStyle.fill,
        opacity: commonStyle.opacity
      })
    }

    steps.push({
      id: crypto.randomUUID(),
      videoTimeSec: Math.max(0, videoTimeSec),
      button: ev.button,
      clicks: ev.clicks,
      marker,
      markerHidden: false,
      keyLabel: ev.kind === 'key' ? ev.key : undefined,
      extras,
      captions: [],
      captionMode,
      captionStyle: { ...captionStyle },
      crop: null,
      frameFile
    })
  }

  const project: Project = {
    version: 1,
    name,
    dir,
    videoFile,
    videoWidth: outWidth,
    videoHeight: outHeight,
    region,
    createdAt: created.toISOString(),
    steps
  }
  await saveProject(project)
  return project
}

export async function saveProject(project: Project): Promise<void> {
  await fs.writeFile(path.join(project.dir, 'project.json'), JSON.stringify(project, null, 2))
}

export async function loadProject(jsonPath: string): Promise<Project> {
  const raw = await fs.readFile(jsonPath, 'utf-8')
  const project = JSON.parse(raw) as Project
  // 폴더가 이동됐을 수 있으므로 실제 경로 기준으로 갱신
  project.dir = path.dirname(jsonPath)
  // 이전 버전 프로젝트의 누락 필드를 기본값으로 채움
  return normalizeProject(project)
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** step-03.png + n → step-03_003.png */
export function addNumberSuffix(fileName: string, n: number): string {
  const dot = fileName.lastIndexOf('.')
  const base = dot === -1 ? fileName : fileName.slice(0, dot)
  const ext = dot === -1 ? '' : fileName.slice(dot)
  return `${base}_${String(n).padStart(3, '0')}${ext}`
}

/** 주어진 파일명들 중 하나라도 이미 존재하는지 */
export async function hasNameConflict(dir: string, fileNames: string[]): Promise<boolean> {
  for (const name of fileNames) {
    if (await fileExists(path.join(dir, name))) return true
  }
  return false
}

/** 모든 파일명에 대해 비어있는 공통 번호(_###)를 찾는다 */
export async function nextBatchSuffix(dir: string, fileNames: string[]): Promise<number> {
  for (let n = 1; n < 10000; n++) {
    let free = true
    for (const name of fileNames) {
      if (await fileExists(path.join(dir, addNumberSuffix(name, n)))) {
        free = false
        break
      }
    }
    if (free) return n
  }
  return 1
}

/** images를 지정한 파일명(names)으로 dir에 저장 */
export async function writeNamedImages(
  dir: string,
  images: ExportImage[],
  names: string[]
): Promise<string[]> {
  await fs.mkdir(dir, { recursive: true })
  const written: string[] = []
  for (let i = 0; i < images.length; i++) {
    const base64 = images[i].dataUrl.replace(/^data:image\/png;base64,/, '')
    const filePath = path.join(dir, names[i])
    await fs.writeFile(filePath, Buffer.from(base64, 'base64'))
    written.push(filePath)
  }
  return written
}
