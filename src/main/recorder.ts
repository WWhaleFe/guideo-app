import { uIOhook, UiohookMouseEvent } from 'uiohook-napi'
import { BrowserWindow } from 'electron'
import type { RawClickEvent, ClickButton } from '../shared/types'

// uiohook(libuiohook) 버튼 코드: 1=left, 2=right, 3=middle
function mapButton(button: unknown): ClickButton | null {
  switch (button) {
    case 1:
      return 'left'
    case 2:
      return 'right'
    case 3:
      return 'middle'
    default:
      return null
  }
}

/** 이 거리(px) 이상 이동하며 눌렀다 떼면 드래그로 간주 */
const DRAG_THRESHOLD = 12

let capturing = false
let hookStarted = false
let events: RawClickEvent[] = []
let excludedWindows: BrowserWindow[] = []
let onClickCount: ((count: number) => void) | null = null

/** 눌린 상태 추적 (드래그 판정용) */
let pending: { x: number; y: number; time: number; button: ClickButton; clicks: number } | null =
  null

/** 앱 자체 창(메인/리모컨) 안에서의 클릭은 스텝에서 제외 */
function isInsideOwnWindow(x: number, y: number): boolean {
  return excludedWindows.some((win) => {
    if (win.isDestroyed() || win.isMinimized() || !win.isVisible()) return false
    const b = win.getBounds()
    return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height
  })
}

function handleMouseDown(e: UiohookMouseEvent): void {
  if (!capturing) return
  const button = mapButton(e.button)
  if (!button) return
  if (isInsideOwnWindow(e.x, e.y)) return
  pending = { x: e.x, y: e.y, time: Date.now(), button, clicks: e.clicks || 1 }
}

function handleMouseUp(e: UiohookMouseEvent): void {
  if (!capturing || !pending) return
  const start = pending
  pending = null
  const button = mapButton(e.button)
  if (!button || button !== start.button) return
  if (isInsideOwnWindow(e.x, e.y)) return

  const dist = Math.hypot(e.x - start.x, e.y - start.y)
  if (dist >= DRAG_THRESHOLD) {
    // 드래그 → 시작점~끝점 화살표
    events.push({
      time: start.time,
      kind: 'drag',
      x: start.x,
      y: start.y,
      x2: e.x,
      y2: e.y,
      button,
      clicks: 1
    })
  } else {
    // 제자리 클릭. 같은 지점의 연속 클릭은 더블클릭으로 병합
    const last = events[events.length - 1]
    if (
      last &&
      last.kind === 'click' &&
      (start.clicks > 1 || e.clicks > 1) &&
      last.button === button &&
      start.time - last.time < 700
    ) {
      last.clicks = Math.max(last.clicks, start.clicks, e.clicks || 1)
    } else {
      events.push({ time: start.time, kind: 'click', x: start.x, y: start.y, button, clicks: 1 })
    }
  }
  onClickCount?.(events.length)
}

export function startCapture(exclude: BrowserWindow[], onCount: (count: number) => void): void {
  events = []
  pending = null
  excludedWindows = exclude
  onClickCount = onCount
  capturing = true
  if (!hookStarted) {
    uIOhook.on('mousedown', handleMouseDown)
    uIOhook.on('mouseup', handleMouseUp)
    uIOhook.start()
    hookStarted = true
  }
}

export function stopCapture(): RawClickEvent[] {
  capturing = false
  pending = null
  onClickCount = null
  return events
}
