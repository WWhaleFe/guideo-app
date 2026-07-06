import { useCallback, useEffect, useRef, useState } from 'react'
import type { DisplaySource, Project } from '../../shared/types'
import Home from './screens/Home'
import Recording from './screens/Recording'
import Editor from './screens/Editor'

type View =
  | { kind: 'home' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'processing' }
  | { kind: 'editor'; project: Project }

export default function App(): JSX.Element {
  const [view, setView] = useState<View>({ kind: 'home' })
  const [error, setError] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const t0Ref = useRef(0)

  const startRecording = useCallback(async (source: DisplaySource, useRegion: boolean) => {
    setError(null)
    try {
      await window.api.selectSource(source.id, source.displayId)
      if (useRegion) {
        const region = await window.api.selectRegion()
        if (!region) return // 사용자가 영역 선택을 취소함
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false
      })
      streamRef.current = stream
      chunksRef.current = []
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      recorderRef.current = recorder
      recorder.ondataavailable = (e): void => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstart = (): void => {
        t0Ref.current = Date.now()
        void window.api.recordingStarted(t0Ref.current)
        setView({ kind: 'recording', startedAt: t0Ref.current })
      }
      recorder.start(1000)
    } catch (err) {
      setError('녹화를 시작할 수 없습니다. 화면 기록 권한을 확인해주세요. (' + String(err) + ')')
      setView({ kind: 'home' })
    }
  }, [])

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    setView({ kind: 'processing' })
    try {
      await new Promise<void>((resolve) => {
        recorder.onstop = (): void => resolve()
        recorder.stop()
      })
      streamRef.current?.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunksRef.current, { type: 'video/webm' })
      const buffer = await blob.arrayBuffer()
      const project = await window.api.finishRecording(buffer, t0Ref.current)
      setView({ kind: 'editor', project })
    } catch (err) {
      setError('녹화 처리 중 오류가 발생했습니다: ' + String(err))
      await window.api.cancelRecording()
      setView({ kind: 'home' })
    }
  }, [])

  // 전역 단축키(Cmd+Shift+2)로 중지 요청
  useEffect(() => {
    if (view.kind !== 'recording') return
    const off = window.api.onStopRequested(() => {
      void stopRecording()
    })
    return off
  }, [view.kind, stopRecording])

  const openProject = useCallback(async () => {
    const project = await window.api.openProject()
    if (project) setView({ kind: 'editor', project })
  }, [])

  return (
    <div className="app">
      {error && (
        <div className="error-banner" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {view.kind === 'home' && <Home onStart={startRecording} onOpenProject={openProject} />}
      {view.kind === 'recording' && (
        <Recording startedAt={view.startedAt} onStop={stopRecording} />
      )}
      {view.kind === 'processing' && (
        <div className="centered">
          <div className="spinner" />
          <h2>영상 처리 중…</h2>
          <p className="muted">클릭 시점의 프레임을 추출하고 있습니다</p>
        </div>
      )}
      {view.kind === 'editor' && (
        <Editor
          key={view.project.dir}
          initialProject={view.project}
          onGoHome={() => setView({ kind: 'home' })}
        />
      )}
    </div>
  )
}
