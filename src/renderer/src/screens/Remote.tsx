import { useEffect, useState } from 'react'

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  const m = String(Math.floor(sec / 60)).padStart(2, '0')
  const s = String(sec % 60).padStart(2, '0')
  return `${m}:${s}`
}

/** 녹화 중 항상 위에 떠 있는 리모컨 — 이 창은 녹화 결과물에 찍히지 않습니다 */
export default function Remote(): JSX.Element {
  const [t0, setT0] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [clicks, setClicks] = useState(0)

  useEffect(() => {
    document.documentElement.classList.add('transparent-bg')
    document.body.classList.add('transparent-bg')
    void window.api.remoteInfo().then((info) => setT0(info.t0))
    const timer = setInterval(() => setNow(Date.now()), 500)
    const off = window.api.onClickCount(setClicks)
    return () => {
      clearInterval(timer)
      off()
    }
  }, [])

  return (
    <div className="remote">
      <span className="rec-dot" />
      <span className="remote-time">{t0 ? formatElapsed(now - t0) : '00:00'}</span>
      <span className="remote-clicks">클릭 {clicks}</span>
      <button className="remote-stop" onClick={() => void window.api.remoteStop()}>
        ■ 중지
      </button>
    </div>
  )
}
