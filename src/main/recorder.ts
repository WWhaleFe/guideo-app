import { uIOhook, UiohookKey, UiohookMouseEvent, UiohookKeyboardEvent } from 'uiohook-napi'
import { BrowserWindow } from 'electron'
import type { RawClickEvent, ClickButton } from '../shared/types'

// 기록할 주요 키 (활성 요소를 확정/취소하는 키)
const KEY_LABELS: Record<number, string> = {
  [UiohookKey.Enter]: 'Enter',
  [UiohookKey.Space]: 'Space',
  [UiohookKey.Escape]: 'Esc'
}

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
/** 마지막 커서 위치 (키 입력 스텝의 마커 위치로 사용) */
let lastMouse = { x: 0, y: 0 }

/** 앱 자체 창(메인/리모컨) 안에서의 클릭은 스텝에서 제외 */
function isInsideOwnWindow(x: number, y: number): boolean {
  return excludedWindows.some((win) => {
    if (win.isDestroyed() || win.isMinimized() || !win.isVisible()) return false
    const b = win.getBounds()
    return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height
  })
}

function handleMouseMove(e: UiohookMouseEvent): void {
  lastMouse = { x: e.x, y: e.y }
}

function handleMouseDown(e: UiohookMouseEvent): void {
  if (!capturing) return
  lastMouse = { x: e.x, y: e.y }
  const button = mapButton(e.button)
  if (!button) return
  if (isInsideOwnWindow(e.x, e.y)) return
  pending = { x: e.x, y: e.y, time: Date.now(), button, clicks: e.clicks || 1 }
}

function handleKeyDown(e: UiohookKeyboardEvent): void {
  if (!capturing) return
  const label = KEY_LABELS[e.keycode]
  if (!label) return
  // 같은 창(리모컨/메인) 위에서의 키는 굳이 기록하지 않음
  if (isInsideOwnWindow(lastMouse.x, lastMouse.y)) return
  events.push({
    time: Date.now(),
    kind: 'key',
    x: lastMouse.x,
    y: lastMouse.y,
    button: 'left',
    clicks: 1,
    key: label
  })
  onClickCount?.(events.length)
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
    uIOhook.on('mousemove', handleMouseMove)
    uIOhook.on('mousedown', handleMouseDown)
    uIOhook.on('mouseup', handleMouseUp)
    uIOhook.on('keydown', handleKeyDown)
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
