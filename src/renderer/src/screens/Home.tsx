import { useEffect, useState } from 'react'
import type { DisplaySource, PermissionStatus } from '../../../shared/types'

interface Props {
  onStart: (source: DisplaySource, useRegion: boolean) => void
  onOpenProject: () => void
}

export default function Home({ onStart, onOpenProject }: Props): JSX.Element {
  const [displays, setDisplays] = useState<DisplaySource[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionStatus | null>(null)
  const [savePath, setSavePath] = useState('')

  const refreshDisplays = (): void => {
    void window.api.listDisplays().then((list) => {
      setDisplays(list)
      setSelected((cur) => {
        if (cur && list.some((d) => d.id === cur)) return cur
        return list.find((d) => d.primary)?.id ?? list[0]?.id ?? null
      })
    })
  }

  useEffect(() => {
    refreshDisplays()
    void window.api.checkPermissions().then(setPerms)
    void window.api.projectsRoot().then(setSavePath)
  }, [])

  const selectedSource = displays.find((d) => d.id === selected)
  const displayTitle = (d: DisplaySource): string => {
    if (displays.length < 2) return '전체 화면'
    const base = d.primary ? '주 화면' : `디스플레이 ${d.index}`
    return d.positionLabel && !d.primary ? `${base} (${d.positionLabel})` : base
  }

  return (
    <div className="home">
      <header className="home-header">
        <h1>🎬 Guideo</h1>
        <p className="muted">
          화면을 녹화하면 클릭한 순간들을 자동으로 찾아 단계별 안내 이미지를 만들어 드립니다
        </p>
      </header>

      {perms && (!perms.screen || !perms.accessibility) && (
        <div className="perm-warning">
          <strong>⚠️ 권한이 필요합니다</strong>
          <ul>
            {!perms.screen && (
              <li>
                화면 기록: 시스템 설정 → 개인정보 보호 및 보안 → <b>화면 기록</b>에서 Guideo(개발
                중에는 Electron)을 허용해주세요.
              </li>
            )}
            {!perms.accessibility && (
              <li>
                손쉬운 사용(클릭 감지용): 시스템 설정 → 개인정보 보호 및 보안 → <b>손쉬운 사용</b>
                에서 허용해주세요.{' '}
                <button
                  className="btn btn-small"
                  onClick={() =>
                    void window.api
                      .requestAccessibility()
                      .then(() => window.api.checkPermissions().then(setPerms))
                  }
                >
                  권한 요청
                </button>
              </li>
            )}
          </ul>
        </div>
      )}

      <section>
        <div className="section-head">
          <h2>녹화할 화면 선택 {displays.length > 1 && `· 모니터 ${displays.length}대`}</h2>
          <button className="btn btn-small" onClick={refreshDisplays} title="모니터 목록 새로고침">
            ↻ 새로고침
          </button>
        </div>
        <div className="display-grid">
          {displays.map((d) => (
            <button
              key={d.id}
              className={'display-card' + (selected === d.id ? ' selected' : '')}
              onClick={() => setSelected(d.id)}
            >
              <img src={d.thumbnailDataUrl} alt={displayTitle(d)} />
              <span className="display-name">
                {d.primary && <span className="primary-dot" title="주 화면">●</span>}
                {displayTitle(d)}
              </span>
              <span className="display-meta">
                {d.width}×{d.height}
                {d.scaleFactor > 1 && ` · @${d.scaleFactor}x`}
              </span>
            </button>
          ))}
          {displays.length === 0 && (
            <p className="muted small">
              감지된 화면이 없습니다. 화면 기록 권한을 허용한 뒤 새로고침을 눌러주세요.
            </p>
          )}
        </div>
      </section>

      <div className="home-actions">
        <button
          className="btn btn-primary btn-large"
          disabled={!selectedSource}
          onClick={() => selectedSource && onStart(selectedSource, false)}
        >
          ● 전체 화면 녹화
        </button>
        <button
          className="btn btn-primary btn-large"
          disabled={!selectedSource}
          onClick={() => selectedSource && onStart(selectedSource, true)}
        >
          ▭ 영역 선택 녹화
        </button>
        <button className="btn btn-large" onClick={onOpenProject}>
          📂 프로젝트 열기
        </button>
      </div>

      <p className="muted hint">
        녹화가 시작되면 이 창은 최소화되고, 화면 우측 상단에 <b>리모컨</b>이 나타납니다. 리모컨의{' '}
        <b>■ 중지</b> 버튼 또는 <kbd>⌘⇧2</kbd> 로 녹화를 마치세요. 리모컨과 이 앱에서의 클릭은
        결과물에 포함되지 않습니다.
      </p>

      <div className="save-location">
        <span className="muted">
          녹화 영상과 캡처 이미지 저장 위치: <code>{savePath}</code>
        </span>
        <button className="btn btn-small" onClick={() => void window.api.revealPath(savePath)}>
          폴더 열기
        </button>
      </div>
    </div>
  )
}
