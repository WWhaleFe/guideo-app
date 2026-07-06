import { useCallback, useEffect, useState } from 'react'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 투명 오버레이 창에서 드래그로 녹화 영역을 선택 */
export default function RegionSelect(): JSX.Element {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)

  useEffect(() => {
    document.documentElement.classList.add('transparent-bg')
    document.body.classList.add('transparent-bg')
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void window.api.regionCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    setStart({ x: e.clientX, y: e.clientY })
    setRect(null)
  }, [])

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!start) return
      setRect({
        x: Math.min(start.x, e.clientX),
        y: Math.min(start.y, e.clientY),
        width: Math.abs(e.clientX - start.x),
        height: Math.abs(e.clientY - start.y)
      })
    },
    [start]
  )

  const onMouseUp = useCallback(() => {
    if (rect && rect.width > 24 && rect.height > 24) {
      void window.api.regionDone(rect)
    } else {
      setStart(null)
      setRect(null)
    }
  }, [rect])

  return (
    <div
      className="region-overlay"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {!rect && (
        <div className="region-hint">
          드래그하여 녹화 영역을 선택하세요 · <kbd>Esc</kbd> 취소
        </div>
      )}
      {rect && (
        <div
          className="region-rect"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          <span className="region-size">
            {rect.width} × {rect.height}
          </span>
        </div>
      )}
    </div>
  )
}
