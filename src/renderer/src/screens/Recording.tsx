import { useEffect, useState } from 'react'

interface Props {
  startedAt: number
  onStop: () => void
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000)
  const m = String(Math.floor(sec / 60)).padStart(2, '0')
  const s = String(sec % 60).padStart(2, '0')
  return `${m}:${s}`
}

export default function Recording({ startedAt, onStop }: Props): JSX.Element {
  const [now, setNow] = useState(Date.now())
  const [clicks, setClicks] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500)
    const off = window.api.onClickCount(setClicks)
    return () => {
      clearInterval(timer)
      off()
    }
  }, [])

  return (
    <div className="centered recording">
      <div className="rec-indicator">
        <span className="rec-dot" /> 녹화 중
      </div>
      <div className="rec-time">{formatElapsed(now - startedAt)}</div>
      <div className="rec-clicks">감지된 클릭: {clicks}회</div>
      <button className="btn btn-danger btn-large" onClick={onStop}>
        ■ 녹화 중지
      </button>
      <p className="muted hint">
        화면 우측 상단의 <b>리모컨</b> 또는 전역 단축키 <kbd>⌘⇧2</kbd> 로 중지할 수 있습니다. 이
        창과 리모컨에서의 클릭은 스텝에 포함되지 않습니다.
      </p>
    </div>
  )
}
