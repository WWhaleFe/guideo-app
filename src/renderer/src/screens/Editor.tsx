import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type {
  AppDefaults,
  ArrowCorner,
  CaptionItem,
  CaptionMode,
  CaptionStyle,
  ExtraShape,
  Marker,
  MarkerShape,
  Project,
  Region,
  Step
} from '../../../shared/types'
import { defaultStrokeWidth, genId, normalizeProject } from '../../../shared/normalize'
import { frameUrl } from '../media'
import { renderAllSteps, renderStepToPng, stepLabel } from '../export'
import {
  CAPTION_FONTS,
  RESIZE_HANDLES,
  ResizeHandle,
  Box,
  boxBadgePos,
  boxBadgeRadius,
  boxLabelFontSize,
  boxLabelPos,
  captionMetrics,
  cursorForHandle,
  defaultCaptionPos,
  arrowHeadLen,
  extraArrowGeom,
  fontStackOf,
  handlePoint,
  hexToRgba,
  resizeBox
} from '../markerGeometry'

const SWATCHES = ['#FF3B30', '#FF9500', '#FFD60A', '#34C759', '#007AFF', '#AF52DE', '#1d1d1f']

const SHAPES: { value: MarkerShape; label: string; title: string }[] = [
  { value: 'circle', label: '○', title: '원' },
  { value: 'rect', label: '▭', title: '사각형' },
  { value: 'arrow', label: '↖', title: '화살표' },
  { value: 'highlight', label: '▬', title: '형광펜' }
]

const CAPTION_MODES: { value: CaptionMode; label: string }[] = [
  { value: 'overlay', label: '이미지 위' },
  { value: 'bar', label: '하단 바' }
]

const CHROME_HEIGHT = 96

interface Props {
  initialProject: Project
  onGoHome: () => void
}

// ---------- 실행취소/다시실행 히스토리 (앞뒤 각 50개, 연속 동작은 coalesce) ----------

const HISTORY_LIMIT = 50
const COALESCE_MS = 500

interface HistoryState {
  past: Project[]
  present: Project
  future: Project[]
  lastKey: string | null
  lastT: number
}

type HistoryAction =
  | { type: 'set'; updater: (p: Project) => Project; key: string | null; t: number }
  | { type: 'sep' }
  | { type: 'undo' }
  | { type: 'redo' }

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'set': {
      const next = action.updater(state.present)
      if (next === state.present) return state
      // 같은 key + 500ms 이내면 새 히스토리 항목을 만들지 않고 present만 교체
      const coalesce =
        action.key != null && action.key === state.lastKey && action.t - state.lastT < COALESCE_MS
      if (coalesce) {
        return { ...state, present: next, future: [], lastT: action.t }
      }
      return {
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: next,
        future: [],
        lastKey: action.key,
        lastT: action.t
      }
    }
    case 'sep':
      return state.lastKey === null ? state : { ...state, lastKey: null }
    case 'undo': {
      if (state.past.length === 0) return state
      const present = state.past[state.past.length - 1]
      return {
        past: state.past.slice(0, -1),
        present,
        future: [state.present, ...state.future].slice(0, HISTORY_LIMIT),
        lastKey: null,
        lastT: 0
      }
    }
    case 'redo': {
      if (state.future.length === 0) return state
      const present = state.future[0]
      return {
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present,
        future: state.future.slice(1),
        lastKey: null,
        lastT: 0
      }
    }
    default:
      return state
  }
}

export default function Editor({ initialProject, onGoHome }: Props): JSX.Element {
  const original = useRef<Project>(normalizeProject(initialProject))
  const [hist, dispatch] = useReducer(historyReducer, {
    past: [],
    present: original.current,
    future: [],
    lastKey: null,
    lastT: 0
  })
  const project = hist.present

  /**
   * key가 같고 500ms 이내의 연속 변경은 하나의 실행취소 단위로 합쳐진다.
   * (드래그·슬라이더 = key 지정 → 한 동작으로 묶임 / 구조 변경 = key 없음 → 개별)
   */
  const setProject = useCallback(
    (updater: Project | ((p: Project) => Project), key?: string) => {
      const fn = typeof updater === 'function' ? (updater as (p: Project) => Project) : () => updater
      dispatch({ type: 'set', updater: fn, key: key ?? null, t: Date.now() })
    },
    []
  )
  /** 연속 동작 경계 — 다음 변경은 새 실행취소 단위가 됨 */
  const separate = useCallback(() => dispatch({ type: 'sep' }), [])
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])

  const [selectedId, setSelectedId] = useState<string | null>(initialProject.steps[0]?.id ?? null)
  const [selectedExtraId, setSelectedExtraId] = useState<string | null>(null)
  const [markerSelected, setMarkerSelected] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [cropMode, setCropMode] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2500)
  }, [])

  const resetToOriginal = useCallback(() => {
    setProject(original.current)
    showToast('처음 상태로 초기화했습니다')
  }, [setProject, showToast])

  const isFirst = useRef(true)
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false
      return
    }
    const t = window.setTimeout(() => void window.api.saveProject(project), 800)
    return () => window.clearTimeout(t)
  }, [project])

  // 실행취소/다시실행 단축키 (⌘Z / ⌘⇧Z)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      const typing =
        !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (typing) return
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const updateStep = useCallback(
    (id: string, patch: Partial<Step>, key?: string) => {
      setProject(
        (p) => ({
          ...p,
          steps: p.steps.map((s) => (s.id === id ? { ...s, ...patch } : s))
        }),
        key
      )
    },
    [setProject]
  )

  const deleteStep = useCallback(
    (id: string) => {
      setProject((p) => {
        const steps = p.steps.filter((s) => s.id !== id)
        if (selectedId === id) setSelectedId(steps[0]?.id ?? null)
        return { ...p, steps }
      })
    },
    [selectedId]
  )

  const selected = project.steps.find((s) => s.id === selectedId) ?? null
  const selectedIndex = selected ? project.steps.indexOf(selected) : -1
  const exportDir = project.dir + '/exports'

  /** 이 스텝 한 장만 저장 */
  const saveOne = useCallback(async () => {
    if (!selected) return
    setExporting(true)
    try {
      const idx = project.steps.indexOf(selected)
      const dataUrl = await renderStepToPng(project, selected, idx + 1)
      const fileName = `step-${String(idx + 1).padStart(2, '0')}.png`
      const written = await window.api.exportSave(exportDir, [{ fileName, dataUrl }], false)
      if (written && written.length > 0) showToast(`✅ 저장 완료 → ${written[0].split('/').pop()}`)
    } catch (err) {
      showToast('저장 실패: ' + String(err))
    } finally {
      setExporting(false)
    }
  }, [project, selected, exportDir, showToast])

  /** 전체 스텝 저장 (충돌 시 1번만 물어봄) */
  const saveAll = useCallback(async () => {
    setExporting(true)
    try {
      const images = await renderAllSteps(project)
      const written = await window.api.exportSave(exportDir, images, true)
      if (written && written.length > 0) showToast(`✅ ${written.length}장 저장 완료 → exports 폴더`)
    } catch (err) {
      showToast('저장 실패: ' + String(err))
    } finally {
      setExporting(false)
    }
  }, [project, exportDir, showToast])

  const selectStep = useCallback((id: string) => {
    setSelectedId(id)
    setSelectedExtraId(null)
    setMarkerSelected(false)
    setCropMode(false)
  }, [])

  const selectMarker = useCallback(() => {
    setMarkerSelected(true)
    setSelectedExtraId(null)
  }, [])

  const selectExtra = useCallback((id: string) => {
    setSelectedExtraId(id)
    setMarkerSelected(false)
  }, [])

  const moveMarker = useCallback(
    (x: number, y: number) => {
      if (!selected) return
      updateStep(selected.id, { marker: { ...selected.marker, x, y } }, 'canvas')
    },
    [selected, updateStep]
  )

  /** 마커 박스 리사이즈 — 위치·크기는 스텝별 */
  const resizeMarker = useCallback(
    (box: Box) => {
      if (!selected) return
      updateStep(selected.id, { marker: { ...selected.marker, ...box } }, 'canvas')
    },
    [selected, updateStep]
  )

  /** 마커 스타일은 통일성을 위해 모든 스텝에 적용 */
  const updateMarkerStyle = useCallback(
    (patch: Partial<Omit<Marker, 'x' | 'y'>>) => {
      setProject(
        (p) => ({
          ...p,
          steps: p.steps.map((s) => ({ ...s, marker: { ...s.marker, ...patch } }))
        }),
        'm:' + Object.keys(patch).join(',')
      )
    },
    [setProject]
  )

  const updateCaptionStyle = useCallback(
    (patch: Partial<CaptionStyle>) => {
      setProject(
        (p) => ({
          ...p,
          steps: p.steps.map((s) => ({ ...s, captionStyle: { ...s.captionStyle, ...patch } }))
        }),
        'cs:' + Object.keys(patch).join(',')
      )
    },
    [setProject]
  )

  const setCaptionMode = useCallback((mode: CaptionMode) => {
    setProject((p) => ({ ...p, steps: p.steps.map((s) => ({ ...s, captionMode: mode })) }))
  }, [])

  // ----- 추가 도형 (현재 스텝 한정) -----
  const addExtra = useCallback(
    (shape: MarkerShape) => {
      if (!selected) return
      const view = selected.crop ?? {
        x: 0,
        y: 0,
        width: project.videoWidth || 1920,
        height: project.videoHeight || 1080
      }
      // 화면 중앙에 기본 크기의 박스로 생성
      const boxW = shape === 'highlight' ? view.width * 0.28 : view.width * 0.14
      const boxH = shape === 'highlight' ? view.height * 0.06 : boxW
      const extra: ExtraShape = {
        id: genId('shape'),
        shape,
        x: Math.round(view.x + (view.width - boxW) / 2),
        y: Math.round(view.y + (view.height - boxH) / 2),
        width: Math.round(boxW),
        height: Math.round(boxH),
        color: selected.marker.color,
        // 화살표는 촉을 박스 대비 적당한 크기로 지정 (지나치게 커지지 않도록)
        arrowHead: shape === 'arrow' ? Math.round(Math.min(boxW, boxH) * 0.35) : undefined,
        strokeWidth: defaultStrokeWidth(Math.min(selected.marker.width, selected.marker.height) / 2),
        fill: false,
        opacity: 1
      }
      updateStep(selected.id, { extras: [...selected.extras, extra] })
      selectExtra(extra.id)
    },
    [selected, project, updateStep, selectExtra]
  )

  const updateExtra = useCallback(
    (extraId: string, patch: Partial<ExtraShape>, key?: string) => {
      if (!selected) return
      updateStep(
        selected.id,
        { extras: selected.extras.map((e) => (e.id === extraId ? { ...e, ...patch } : e)) },
        key
      )
    },
    [selected, updateStep]
  )

  const deleteExtra = useCallback(
    (extraId: string) => {
      if (!selected) return
      updateStep(selected.id, { extras: selected.extras.filter((e) => e.id !== extraId) })
      setSelectedExtraId((cur) => (cur === extraId ? null : cur))
    },
    [selected, updateStep]
  )

  const duplicateExtra = useCallback(
    (extraId: string) => {
      if (!selected) return
      const ex = selected.extras.find((e) => e.id === extraId)
      if (!ex) return
      const copy: ExtraShape = { ...ex, id: genId('shape'), x: ex.x + 28, y: ex.y + 28 }
      updateStep(selected.id, { extras: [...selected.extras, copy] })
      selectExtra(copy.id)
    },
    [selected, updateStep, selectExtra]
  )

  /** 스텝 전체 복제 (프레임 공유), 바로 뒤에 삽입 */
  const duplicateStep = useCallback(
    (stepId: string) => {
      setProject((p) => {
        const idx = p.steps.findIndex((s) => s.id === stepId)
        if (idx < 0) return p
        const orig = p.steps[idx]
        const copy: Step = {
          ...orig,
          id: genId('step'),
          marker: { ...orig.marker },
          extras: orig.extras.map((e) => ({ ...e, id: genId('shape') })),
          captions: orig.captions.map((c) => ({ ...c, id: genId('cap') }))
        }
        const steps = [...p.steps]
        steps.splice(idx + 1, 0, copy)
        return { ...p, steps }
      })
      showToast('스텝을 복제했습니다')
    },
    [setProject, showToast]
  )

  /** 마커 삭제 = 숨김 (프레임은 유지) */
  const hideMarker = useCallback(() => {
    if (!selected) return
    updateStep(selected.id, { markerHidden: true })
    setMarkerSelected(false)
  }, [selected, updateStep])

  /** 마커 복제 → 마커와 동일한 도형을 추가 도형으로 생성 */
  const duplicateMarkerAsExtra = useCallback(() => {
    if (!selected) return
    const mk = selected.marker
    const copy: ExtraShape = {
      id: genId('shape'),
      shape: mk.shape,
      x: mk.x + 28,
      y: mk.y + 28,
      width: mk.width,
      height: mk.height,
      color: mk.color,
      arrowTip: mk.arrowTip,
      arrowHead: mk.arrowHead,
      strokeWidth: mk.strokeWidth,
      fill: mk.fill,
      opacity: mk.opacity
    }
    updateStep(selected.id, { extras: [...selected.extras, copy] })
    selectExtra(copy.id)
  }, [selected, updateStep, selectExtra])

  // ----- 캡션 CRUD -----
  const addCaption = useCallback(() => {
    if (!selected) return
    const cap: CaptionItem = { id: genId('cap'), text: '', pos: null }
    updateStep(selected.id, { captions: [...selected.captions, cap] })
  }, [selected, updateStep])

  const updateCaption = useCallback(
    (capId: string, patch: Partial<CaptionItem>, key?: string) => {
      if (!selected) return
      updateStep(
        selected.id,
        { captions: selected.captions.map((c) => (c.id === capId ? { ...c, ...patch } : c)) },
        key ?? `cap:${capId}:${Object.keys(patch).join(',')}`
      )
    },
    [selected, updateStep]
  )

  const deleteCaption = useCallback(
    (capId: string) => {
      if (!selected) return
      updateStep(selected.id, { captions: selected.captions.filter((c) => c.id !== capId) })
    },
    [selected, updateStep]
  )

  const saveAsDefaults = useCallback(async () => {
    if (!selected) return
    const { x: _x, y: _y, ...markerStyle } = selected.marker
    const defaults: AppDefaults = {
      marker: markerStyle,
      captionMode: selected.captionMode,
      captionStyle: { ...selected.captionStyle }
    }
    await window.api.setDefaults(defaults)
    showToast('⭐ 기본 스타일로 저장 — 다음 녹화부터 적용됩니다')
  }, [selected, showToast])

  const applyCropToAll = useCallback(() => {
    if (!selected) return
    const crop = selected.crop
    setProject((p) => ({ ...p, steps: p.steps.map((s) => ({ ...s, crop })) }))
    showToast(crop ? '모든 스텝에 크롭을 적용했습니다' : '모든 스텝의 크롭을 해제했습니다')
  }, [selected, showToast])

  const m = selected?.marker
  const style = selected?.captionStyle
  const selectedExtra = selected?.extras.find((e) => e.id === selectedExtraId) ?? null

  return (
    <div className="editor">
      <div className="toolbar">
        <button className="btn" onClick={onGoHome}>
          ← 새 녹화
        </button>
        <span className="toolbar-title">
          {project.name} · {project.steps.length}개 스텝
          <span className="toolbar-path" title={project.dir}>
            {project.dir}
          </span>
        </span>
        <span className="toolbar-spacer" />
        <button
          className="btn"
          disabled={hist.past.length === 0}
          title="실행취소 (⌘Z)"
          onClick={undo}
        >
          ↩︎
        </button>
        <button
          className="btn"
          disabled={hist.future.length === 0}
          title="다시실행 (⌘⇧Z)"
          onClick={redo}
        >
          ↪︎
        </button>
        <button className="btn" title="처음 상태(원본 마커)로 초기화" onClick={resetToOriginal}>
          ⟳ 초기화
        </button>
        <button className="btn" title="저장 폴더 열기" onClick={() => void window.api.revealPath(project.dir)}>
          📂 폴더 열기
        </button>
        <button
          className="btn"
          disabled={exporting || !selected}
          title="현재 스텝 한 장만 exports 폴더에 저장"
          onClick={() => void saveOne()}
        >
          🖼 저장
        </button>
        <button
          className="btn btn-primary"
          disabled={exporting || project.steps.length === 0}
          title="모든 스텝을 exports 폴더에 저장"
          onClick={() => void saveAll()}
        >
          {exporting ? '저장 중…' : '⬇︎ 전체 저장'}
        </button>
      </div>

      {project.steps.length === 0 ? (
        <div className="centered">
          <h2>감지된 클릭이 없습니다</h2>
          <p className="muted">
            녹화 중 클릭이 기록되지 않았습니다. 시스템 설정 → 개인정보 보호 및 보안 →{' '}
            <b>손쉬운 사용</b> 권한이 허용되어 있는지 확인한 뒤 다시 녹화해보세요.
          </p>
        </div>
      ) : (
        <div className="editor-body">
          <aside className="step-list">
            {project.steps.map((step, i) => (
              <div
                key={step.id}
                className={'step-item' + (step.id === selectedId ? ' selected' : '')}
                onClick={() => selectStep(step.id)}
              >
                {step.id === selectedId && (
                  <button
                    className="step-delete"
                    title="이 스텝 이미지 삭제 (실행취소로 복구 가능)"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteStep(step.id)
                    }}
                  >
                    ✕
                  </button>
                )}
                <img src={frameUrl(project, step)} alt={`Step ${i + 1}`} />
                <div className="step-item-meta">
                  <b>Step {i + 1}</b>
                  <span className="muted">
                    {step.videoTimeSec.toFixed(1)}s{stepLabel(step) && ` · ${stepLabel(step)}`}
                  </span>
                </div>
              </div>
            ))}
          </aside>

          <main className="canvas-area">
            {selected && (
              <StepCanvas
                project={project}
                step={selected}
                stepNumber={selectedIndex + 1}
                cropMode={cropMode}
                selectedExtraId={selectedExtraId}
                markerSelected={markerSelected}
                onMarkerMove={moveMarker}
                onMarkerResize={resizeMarker}
                onSelectMarker={selectMarker}
                onDuplicateMarker={duplicateMarkerAsExtra}
                onHideMarker={hideMarker}
                onExtraMove={(id, x, y) => updateExtra(id, { x, y }, 'canvas')}
                onExtraResize={(id, box) => updateExtra(id, box, 'canvas')}
                onSelectExtra={selectExtra}
                onDuplicateExtra={duplicateExtra}
                onDeleteExtra={deleteExtra}
                onCaptionMove={(capId, x, y) => updateCaption(capId, { pos: { x, y } }, 'canvas')}
                onGestureEnd={separate}
                onCropSelect={(crop) => {
                  updateStep(selected.id, { crop })
                  setCropMode(false)
                }}
              />
            )}
          </main>

          {selected && m && style && (
            <aside className="inspector">
              <div className="insp-header">
                <b>Step {selectedIndex + 1}</b>
                <span className="muted small">
                  {selected.videoTimeSec.toFixed(1)}s ·{' '}
                  {selected.button === 'left' ? '좌클릭' : selected.button === 'right' ? '우클릭' : '휠'}
                  {selected.clicks > 1 && ' ×2'}
                </span>
              </div>

              {/* ── 클릭 마커 ── */}
              <section className="insp-section">
                <h4 className="insp-title">
                  클릭 마커 <span className="badge-all">스타일 전체 적용</span>
                </h4>
                <label className="check-inline">
                  <input
                    type="checkbox"
                    checked={!selected.markerHidden}
                    onChange={(e) => updateStep(selected.id, { markerHidden: !e.target.checked })}
                  />
                  마커 표시 (끄면 이미지만 유지)
                </label>
                {!selected.markerHidden && (
                  <>
                    <MarkerControls m={m} onChange={updateMarkerStyle} />
                    <p className="muted small">
                      캔버스에서 마커를 드래그해 이동, <b>8개 핸들</b>로 크기를 조절합니다 (크기·위치는
                      스텝별).
                    </p>
                  </>
                )}
              </section>

              {/* ── 추가 도형 ── */}
              <section className="insp-section">
                <h4 className="insp-title">추가 도형</h4>
                <div className="shape-add-row">
                  {SHAPES.map((s) => (
                    <button
                      key={s.value}
                      className="btn btn-small"
                      title={`${s.title} 추가`}
                      onClick={() => addExtra(s.value)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                {selected.extras.length > 0 && (
                  <div className="extra-list">
                    {selected.extras.map((ex, i) => {
                      const meta = SHAPES.find((s) => s.value === ex.shape)
                      return (
                        <div
                          key={ex.id}
                          className={'extra-item' + (ex.id === selectedExtraId ? ' selected' : '')}
                          onClick={() => selectExtra(ex.id)}
                        >
                          <span className="extra-icon" style={{ color: ex.color }}>
                            {meta?.label}
                          </span>
                          <span className="extra-name">
                            {meta?.title} {i + 1}
                          </span>
                          <button
                            className="icon-btn"
                            title="삭제"
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteExtra(ex.id)
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {selectedExtra ? (
                  <div className="extra-editor">
                    <ExtraControls
                      e={selectedExtra}
                      onChange={(patch) =>
                        updateExtra(
                          selectedExtra.id,
                          patch,
                          `ex:${selectedExtra.id}:${Object.keys(patch).join(',')}`
                        )
                      }
                    />
                    <p className="muted small">
                      캔버스에서 도형을 드래그해 이동, <b>모서리·변의 점 8개</b>를 끌어 크기를 조절하세요.
                    </p>
                  </div>
                ) : (
                  <p className="muted small">
                    버튼으로 도형을 추가한 뒤 목록이나 캔버스에서 선택하세요. 캔버스에서 드래그로 이동,
                    8개 핸들로 크기 조절합니다.
                  </p>
                )}
              </section>

              {/* ── 이미지 ── */}
              <section className="insp-section">
                <h4 className="insp-title">이미지</h4>
                <div className="btn-row">
                  <button
                    className={'btn btn-small' + (cropMode ? ' btn-primary' : '')}
                    onClick={() => setCropMode((v) => !v)}
                  >
                    ✂️ {cropMode ? '크롭 취소' : '크롭'}
                  </button>
                  {selected.crop && (
                    <button className="btn btn-small" onClick={() => updateStep(selected.id, { crop: null })}>
                      해제
                    </button>
                  )}
                  <button className="btn btn-small" title="모든 스텝에 적용" onClick={applyCropToAll}>
                    전체 적용
                  </button>
                </div>
                {cropMode && <p className="muted small">캔버스에서 드래그해 남길 영역을 선택하세요.</p>}
              </section>

              {/* ── 캡션 ── */}
              <section className="insp-section">
                <h4 className="insp-title">캡션</h4>
                <div className="insp-row">
                  <label>표시</label>
                  <div className="segmented">
                    {CAPTION_MODES.map((mode) => (
                      <button
                        key={mode.value}
                        className={selected.captionMode === mode.value ? 'active' : ''}
                        onClick={() => setCaptionMode(mode.value)}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="caption-items">
                  {selected.captions.map((cap, i) => (
                    <div key={cap.id} className="caption-item">
                      <textarea
                        rows={2}
                        placeholder={`캡션 ${i + 1} (여러 줄 가능)`}
                        value={cap.text}
                        onChange={(e) => updateCaption(cap.id, { text: e.target.value })}
                      />
                      <button className="icon-btn" title="이 캡션 삭제" onClick={() => deleteCaption(cap.id)}>
                        ✕
                      </button>
                    </div>
                  ))}
                  <button className="btn btn-small add-caption" onClick={addCaption}>
                    + 캡션 추가
                  </button>
                </div>

                {selected.captionMode === 'overlay' && (
                  <>
                    <div className="insp-row">
                      <label>폰트</label>
                      <select value={style.font} onChange={(e) => updateCaptionStyle({ font: e.target.value })}>
                        {CAPTION_FONTS.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="insp-row">
                      <label>글자 크기</label>
                      <input
                        type="range"
                        min={12}
                        max={200}
                        value={style.fontSize}
                        onChange={(e) => updateCaptionStyle({ fontSize: Number(e.target.value) })}
                      />
                      <span className="val">{style.fontSize}</span>
                    </div>
                    <div className="insp-row">
                      <label>글자 색</label>
                      <input
                        type="color"
                        value={style.color}
                        onChange={(e) => updateCaptionStyle({ color: e.target.value })}
                      />
                    </div>
                    <label className="check-inline">
                      <input
                        type="checkbox"
                        checked={style.boxEnabled}
                        onChange={(e) => updateCaptionStyle({ boxEnabled: e.target.checked })}
                      />
                      배경 박스
                    </label>
                    {style.boxEnabled && (
                      <>
                        <div className="insp-row">
                          <label>박스 색</label>
                          <input
                            type="color"
                            value={style.boxColor}
                            onChange={(e) => updateCaptionStyle({ boxColor: e.target.value })}
                          />
                        </div>
                        <div className="insp-row">
                          <label>박스 투명</label>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={Math.round(style.boxOpacity * 100)}
                            onChange={(e) => updateCaptionStyle({ boxOpacity: Number(e.target.value) / 100 })}
                          />
                          <span className="val">{Math.round(style.boxOpacity * 100)}%</span>
                        </div>
                        <div className="insp-row">
                          <label>테두리</label>
                          <input
                            type="range"
                            min={0}
                            max={12}
                            value={style.borderWidth}
                            onChange={(e) => updateCaptionStyle({ borderWidth: Number(e.target.value) })}
                          />
                          <span className="val">{style.borderWidth}</span>
                        </div>
                        {style.borderWidth > 0 && (
                          <div className="insp-row">
                            <label>테두리 색</label>
                            <input
                              type="color"
                              value={style.borderColor}
                              onChange={(e) => updateCaptionStyle({ borderColor: e.target.value })}
                            />
                          </div>
                        )}
                      </>
                    )}
                    <p className="muted small">캔버스에서 캡션을 드래그해 위치를 옮길 수 있습니다.</p>
                  </>
                )}
              </section>

              <section className="insp-section">
                <h4 className="insp-title">스텝 · 기본 설정</h4>
                <div className="btn-row">
                  <button className="btn btn-small" onClick={() => duplicateStep(selected.id)}>
                    ⧉ 스텝 복제
                  </button>
                  <button className="btn btn-small btn-danger" onClick={() => deleteStep(selected.id)}>
                    🗑 스텝 삭제
                  </button>
                </div>
                <button className="btn btn-small full" onClick={() => void saveAsDefaults()}>
                  ⭐ 현재 스타일을 기본값으로 저장
                </button>
              </section>
            </aside>
          )}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

// ---------- 마커/도형 공통 컨트롤 ----------

interface MarkerControlsProps {
  m: Marker
  onChange: (patch: Partial<Omit<Marker, 'x' | 'y' | 'width' | 'height'>>) => void
}

/** 클릭 마커 스타일 컨트롤 (크기는 캔버스 8핸들로 조절 · 스타일은 모든 스텝 적용) */
function MarkerControls({ m, onChange }: MarkerControlsProps): JSX.Element {
  const allowFill = m.shape !== 'highlight' && m.shape !== 'arrow'
  return (
    <>
      <div className="insp-row">
        <label>모양</label>
        <div className="segmented">
          {SHAPES.map((s) => (
            <button
              key={s.value}
              title={s.title}
              className={m.shape === s.value ? 'active' : ''}
              onClick={() => onChange({ shape: s.value })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="insp-row">
        <label>색상</label>
        <input type="color" value={m.color} onChange={(e) => onChange({ color: e.target.value })} />
      </div>
      <div className="swatches">
        {SWATCHES.map((c) => (
          <button
            key={c}
            className={'swatch' + (m.color === c ? ' selected' : '')}
            style={{ background: c }}
            onClick={() => onChange({ color: c })}
          />
        ))}
      </div>

      {m.shape !== 'highlight' && (
        <div className="insp-row">
          <label>선 굵기</label>
          <input
            type="range"
            min={1}
            max={24}
            value={m.strokeWidth}
            onChange={(e) => onChange({ strokeWidth: Number(e.target.value) })}
          />
          <span className="val">{m.strokeWidth}</span>
        </div>
      )}

      {m.shape === 'arrow' && (
        <div className="insp-row">
          <label>화살촉 크기</label>
          <input
            type="range"
            min={8}
            max={200}
            value={Math.round(arrowHeadLen(m))}
            onChange={(e) => onChange({ arrowHead: Number(e.target.value) })}
          />
          <span className="val">{Math.round(arrowHeadLen(m))}</span>
        </div>
      )}

      <div className="insp-row">
        <label>불투명도</label>
        <input
          type="range"
          min={10}
          max={100}
          value={Math.round(m.opacity * 100)}
          onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })}
        />
        <span className="val">{Math.round(m.opacity * 100)}%</span>
      </div>

      <div className="insp-checks">
        {allowFill && (
          <label className="check-inline">
            <input type="checkbox" checked={m.fill} onChange={(e) => onChange({ fill: e.target.checked })} />
            채우기
          </label>
        )}
        <label className="check-inline">
          <input
            type="checkbox"
            checked={m.showNumber}
            onChange={(e) => onChange({ showNumber: e.target.checked })}
          />
          번호 배지
        </label>
        <label className="check-inline">
          <input
            type="checkbox"
            checked={m.showClickLabel}
            onChange={(e) => onChange({ showClickLabel: e.target.checked })}
          />
          클릭 유형 표시
        </label>
      </div>
    </>
  )
}

// ---------- 추가 도형 컨트롤 (크기는 캔버스 핸들로 조절하므로 슬라이더 없음) ----------

function ExtraControls({
  e,
  onChange
}: {
  e: ExtraShape
  onChange: (patch: Partial<ExtraShape>) => void
}): JSX.Element {
  const allowFill = e.shape !== 'highlight' && e.shape !== 'arrow'
  return (
    <>
      <div className="insp-row">
        <label>모양</label>
        <div className="segmented">
          {SHAPES.map((s) => (
            <button
              key={s.value}
              title={s.title}
              className={e.shape === s.value ? 'active' : ''}
              onClick={() => onChange({ shape: s.value })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="insp-row">
        <label>색상</label>
        <input type="color" value={e.color} onChange={(ev) => onChange({ color: ev.target.value })} />
      </div>
      <div className="swatches">
        {SWATCHES.map((c) => (
          <button
            key={c}
            className={'swatch' + (e.color === c ? ' selected' : '')}
            style={{ background: c }}
            onClick={() => onChange({ color: c })}
          />
        ))}
      </div>
      {e.shape !== 'highlight' && (
        <div className="insp-row">
          <label>선 굵기</label>
          <input
            type="range"
            min={1}
            max={24}
            value={e.strokeWidth}
            onChange={(ev) => onChange({ strokeWidth: Number(ev.target.value) })}
          />
          <span className="val">{e.strokeWidth}</span>
        </div>
      )}
      {e.shape === 'arrow' && (
        <div className="insp-row">
          <label>화살촉 크기</label>
          <input
            type="range"
            min={8}
            max={200}
            value={Math.round(arrowHeadLen(e))}
            onChange={(ev) => onChange({ arrowHead: Number(ev.target.value) })}
          />
          <span className="val">{Math.round(arrowHeadLen(e))}</span>
        </div>
      )}
      <div className="insp-row">
        <label>불투명도</label>
        <input
          type="range"
          min={10}
          max={100}
          value={Math.round(e.opacity * 100)}
          onChange={(ev) => onChange({ opacity: Number(ev.target.value) / 100 })}
        />
        <span className="val">{Math.round(e.opacity * 100)}%</span>
      </div>
      {allowFill && (
        <label className="check-inline">
          <input type="checkbox" checked={e.fill} onChange={(ev) => onChange({ fill: ev.target.checked })} />
          채우기
        </label>
      )}
    </>
  )
}

// ---------- SVG 도형 (마커·추가 도형 공용, 박스 기반) ----------

interface BoxShapeProps {
  shape: MarkerShape
  x: number
  y: number
  width: number
  height: number
  color: string
  strokeWidth: number
  fill: boolean
  arrowTip?: ArrowCorner
  arrowHead?: number
}

function BoxShapeSvg({ s }: { s: BoxShapeProps }): JSX.Element {
  if (s.shape === 'circle') {
    return (
      <ellipse
        cx={s.x + s.width / 2}
        cy={s.y + s.height / 2}
        rx={s.width / 2}
        ry={s.height / 2}
        fill={s.fill ? s.color + '26' : 'transparent'}
        stroke={s.color}
        strokeWidth={s.strokeWidth}
      />
    )
  }
  if (s.shape === 'rect') {
    return (
      <rect
        x={s.x}
        y={s.y}
        width={s.width}
        height={s.height}
        rx={Math.min(s.width, s.height) * 0.12}
        fill={s.fill ? s.color + '26' : 'transparent'}
        stroke={s.color}
        strokeWidth={s.strokeWidth}
      />
    )
  }
  if (s.shape === 'highlight') {
    return (
      <rect
        x={s.x}
        y={s.y}
        width={s.width}
        height={s.height}
        rx={Math.min(s.width, s.height) * 0.12}
        fill={hexToRgba(s.color, 0.45)}
        style={{ mixBlendMode: 'multiply' }}
      />
    )
  }
  const g = extraArrowGeom(s, s.arrowTip, arrowHeadLen(s))
  return (
    <>
      <line
        x1={g.tail.x}
        y1={g.tail.y}
        x2={g.lineEnd.x}
        y2={g.lineEnd.y}
        stroke={s.color}
        strokeWidth={s.strokeWidth}
        strokeLinecap="round"
      />
      <polygon points={g.head.map((p) => `${p.x},${p.y}`).join(' ')} fill={s.color} />
    </>
  )
}

/** 선택된 도형/마커의 바운딩 박스 + 8개 리사이즈 핸들 */
function ResizeHandles({
  box,
  viewWidth,
  onResize
}: {
  box: Box
  viewWidth: number
  onResize: (e: React.PointerEvent, handle: ResizeHandle) => void
}): JSX.Element {
  const hs = Math.max(6, viewWidth * 0.006)
  return (
    <g className="resize-overlay">
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill="none"
        stroke="#0a84ff"
        strokeWidth={Math.max(1.5, viewWidth * 0.0014)}
        strokeDasharray={`${viewWidth * 0.006} ${viewWidth * 0.004}`}
        pointerEvents="none"
      />
      {RESIZE_HANDLES.map((h) => {
        const p = handlePoint(box, h)
        return (
          <rect
            key={h}
            x={p.x - hs}
            y={p.y - hs}
            width={hs * 2}
            height={hs * 2}
            rx={hs * 0.4}
            fill="#fff"
            stroke="#0a84ff"
            strokeWidth={Math.max(1.5, viewWidth * 0.0012)}
            style={{ cursor: cursorForHandle(h) }}
            onPointerDown={(e) => onResize(e, h)}
          />
        )
      })}
    </g>
  )
}

// ---------- 캔버스 ----------

type DragState =
  | { type: 'marker'; dx: number; dy: number }
  | { type: 'extra'; id: string; dx: number; dy: number }
  | { type: 'resize'; target: 'marker' | string; handle: ResizeHandle }
  | { type: 'caption'; capId: string; dx: number; dy: number }
  | { type: 'crop'; startX: number; startY: number }
  | null

interface CanvasProps {
  project: Project
  step: Step
  stepNumber: number
  cropMode: boolean
  selectedExtraId: string | null
  markerSelected: boolean
  onMarkerMove: (x: number, y: number) => void
  onMarkerResize: (box: Box) => void
  onSelectMarker: () => void
  onDuplicateMarker: () => void
  onHideMarker: () => void
  onExtraMove: (id: string, x: number, y: number) => void
  onExtraResize: (id: string, box: Box) => void
  onSelectExtra: (id: string) => void
  onDuplicateExtra: (id: string) => void
  onDeleteExtra: (id: string) => void
  onCaptionMove: (capId: string, x: number, y: number) => void
  onGestureEnd: () => void
  onCropSelect: (crop: Region) => void
}

function StepCanvas({
  project,
  step,
  stepNumber,
  cropMode,
  selectedExtraId,
  markerSelected,
  onMarkerMove,
  onMarkerResize,
  onSelectMarker,
  onDuplicateMarker,
  onHideMarker,
  onExtraMove,
  onExtraResize,
  onSelectExtra,
  onDuplicateExtra,
  onDeleteExtra,
  onCaptionMove,
  onGestureEnd,
  onCropSelect
}: CanvasProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<DragState>(null)
  const [cropSel, setCropSel] = useState<Region | null>(null)

  const vw = project.videoWidth || 1920
  const vh = project.videoHeight || 1080
  const view: Region = step.crop ?? { x: 0, y: 0, width: vw, height: vh }

  const m = step.marker
  const br = boxBadgeRadius(m)
  const badge = boxBadgePos(m)
  const label = m.showClickLabel ? stepLabel(step) : ''
  const lp = boxLabelPos(m)
  const lfs = boxLabelFontSize(m)

  const overlayCaptions = step.captionMode === 'overlay' ? step.captions : []

  const toVideoCoords = (clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current
    if (!svg) return [0, 0]
    const rect = svg.getBoundingClientRect()
    return [
      view.x + ((clientX - rect.left) / rect.width) * view.width,
      view.y + ((clientY - rect.top) / rect.height) * view.height
    ]
  }

  const beginMarkerDrag = (e: React.PointerEvent): void => {
    if (cropMode) return
    e.stopPropagation()
    onSelectMarker()
    const [px, py] = toVideoCoords(e.clientX, e.clientY)
    drag.current = { type: 'marker', dx: px - m.x, dy: py - m.y }
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  const beginExtraDrag = (e: React.PointerEvent, ex: ExtraShape): void => {
    if (cropMode) return
    e.stopPropagation()
    onSelectExtra(ex.id)
    const [px, py] = toVideoCoords(e.clientX, e.clientY)
    drag.current = { type: 'extra', id: ex.id, dx: px - ex.x, dy: py - ex.y }
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  const beginResize = (e: React.PointerEvent, target: 'marker' | string, handle: ResizeHandle): void => {
    if (cropMode) return
    e.stopPropagation()
    drag.current = { type: 'resize', target, handle }
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  const beginCaptionDrag = (e: React.PointerEvent, capId: string, ox: number, oy: number): void => {
    if (cropMode) return
    e.stopPropagation()
    const [px, py] = toVideoCoords(e.clientX, e.clientY)
    drag.current = { type: 'caption', capId, dx: px - ox, dy: py - oy }
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  const ratio = view.width / view.height

  return (
    <div
      className={'step-canvas' + (cropMode ? ' cropping' : '')}
      style={{
        aspectRatio: `${view.width} / ${view.height}`,
        width: `min(100%, calc((100vh - ${CHROME_HEIGHT}px) * ${ratio}))`
      }}
    >
      <div className="crop-frame">
        <img
          src={frameUrl(project, step)}
          alt={`Step ${stepNumber}`}
          draggable={false}
          style={{
            width: `${(vw / view.width) * 100}%`,
            left: `${(-view.x / view.width) * 100}%`,
            top: `${(-view.y / view.height) * 100}%`
          }}
        />
      </div>
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        preserveAspectRatio="none"
        onPointerDown={(e) => {
          if (!cropMode) return
          const [px, py] = toVideoCoords(e.clientX, e.clientY)
          drag.current = { type: 'crop', startX: px, startY: py }
          setCropSel(null)
          svgRef.current?.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const [px, py] = toVideoCoords(e.clientX, e.clientY)
          if (d.type === 'marker') {
            onMarkerMove(
              Math.round(Math.max(0, Math.min(vw, px - d.dx))),
              Math.round(Math.max(0, Math.min(vh, py - d.dy)))
            )
          } else if (d.type === 'extra') {
            onExtraMove(
              d.id,
              Math.round(Math.max(0, Math.min(vw, px - d.dx))),
              Math.round(Math.max(0, Math.min(vh, py - d.dy)))
            )
          } else if (d.type === 'resize') {
            if (d.target === 'marker') {
              onMarkerResize(resizeBox(m, d.handle, px, py, 16))
            } else {
              const ex = step.extras.find((s) => s.id === d.target)
              if (ex) onExtraResize(d.target, resizeBox(ex, d.handle, px, py, 16))
            }
          } else if (d.type === 'caption') {
            onCaptionMove(d.capId, Math.round(px - d.dx), Math.round(py - d.dy))
          } else {
            setCropSel({
              x: Math.round(Math.min(d.startX, px)),
              y: Math.round(Math.min(d.startY, py)),
              width: Math.round(Math.abs(px - d.startX)),
              height: Math.round(Math.abs(py - d.startY))
            })
          }
        }}
        onPointerUp={() => {
          const d = drag.current
          drag.current = null
          if (d?.type === 'crop' && cropSel) {
            if (cropSel.width > 40 && cropSel.height > 40) {
              onCropSelect({
                x: Math.max(0, cropSel.x),
                y: Math.max(0, cropSel.y),
                width: Math.min(cropSel.width, vw - Math.max(0, cropSel.x)),
                height: Math.min(cropSel.height, vh - Math.max(0, cropSel.y))
              })
            }
            setCropSel(null)
          }
          // 드래그·리사이즈·캡션 이동 종료 → 다음 편집은 새 실행취소 단위
          if (d && (d.type === 'marker' || d.type === 'extra' || d.type === 'resize' || d.type === 'caption')) {
            onGestureEnd()
          }
        }}
      >
        {/* 추가 도형 (클릭 마커 아래) */}
        {step.extras.map((ex) => (
          <g
            key={ex.id}
            className="extra-shape"
            opacity={ex.opacity}
            onPointerDown={(e) => beginExtraDrag(e, ex)}
          >
            <BoxShapeSvg s={ex} />
          </g>
        ))}

        {/* 선택된 추가 도형의 리사이즈 핸들 */}
        {(() => {
          const ex = step.extras.find((s) => s.id === selectedExtraId)
          if (!ex || cropMode) return null
          return (
            <ResizeHandles box={ex} viewWidth={view.width} onResize={(e, h) => beginResize(e, ex.id, h)} />
          )
        })()}

        {/* 클릭 마커 (숨김 시 미표시 — 프레임은 유지) */}
        {!step.markerHidden && (
        <g className="marker" opacity={m.opacity} onPointerDown={beginMarkerDrag}>
          <BoxShapeSvg s={m} />
          {m.showNumber && (
            <>
              <circle
                cx={badge.x}
                cy={badge.y}
                r={br}
                fill={m.color}
                stroke="#fff"
                strokeWidth={Math.max(2, br * 0.12)}
              />
              <text
                x={badge.x}
                y={badge.y}
                fill="#fff"
                fontSize={br * 1.1}
                fontWeight={700}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {stepNumber}
              </text>
            </>
          )}
          {label && (
            <text
              x={lp.x}
              y={lp.y + lfs * 0.35}
              fill={m.color}
              stroke="#fff"
              strokeWidth={Math.max(3, lfs * 0.25)}
              paintOrder="stroke"
              fontSize={lfs}
              fontWeight={700}
              textAnchor="middle"
              dominantBaseline="hanging"
            >
              {label}
            </text>
          )}
        </g>
        )}

        {/* 클릭 마커 리사이즈 핸들 */}
        {markerSelected && !step.markerHidden && !cropMode && (
          <ResizeHandles box={m} viewWidth={view.width} onResize={(e, h) => beginResize(e, 'marker', h)} />
        )}

        {overlayCaptions.map((cap, idx) => {
          const text = cap.text.trim()
          if (!text) return null
          const cm = captionMetrics(text, step.captionStyle)
          const pos = cap.pos ?? defaultCaptionPos(m, cm, vw, vh, idx)
          return (
            <g
              key={cap.id}
              className="caption-box"
              transform={`translate(${pos.x}, ${pos.y})`}
              onPointerDown={(e) => beginCaptionDrag(e, cap.id, pos.x, pos.y)}
            >
              {step.captionStyle.boxEnabled && (
                <rect
                  width={cm.boxW}
                  height={cm.boxH}
                  rx={cm.fontSize * 0.35}
                  fill={hexToRgba(step.captionStyle.boxColor, step.captionStyle.boxOpacity)}
                  stroke={step.captionStyle.borderWidth > 0 ? step.captionStyle.borderColor : 'none'}
                  strokeWidth={step.captionStyle.borderWidth}
                />
              )}
              {cm.lines.map((line, i) => (
                <text
                  key={i}
                  x={cm.padH}
                  y={cm.padV + i * cm.lineH}
                  fill={step.captionStyle.color}
                  fontSize={cm.fontSize}
                  fontWeight={600}
                  fontFamily={fontStackOf(step.captionStyle.font)}
                  dominantBaseline="hanging"
                >
                  {line}
                </text>
              ))}
            </g>
          )
        })}

        {cropMode && cropSel && (
          <rect
            x={cropSel.x}
            y={cropSel.y}
            width={cropSel.width}
            height={cropSel.height}
            fill="rgba(10, 132, 255, 0.12)"
            stroke="#0a84ff"
            strokeWidth={Math.max(2, view.width * 0.002)}
            strokeDasharray={`${view.width * 0.008} ${view.width * 0.005}`}
            pointerEvents="none"
          />
        )}
      </svg>

      {/* 선택된 도형/마커 위(또는 아래)에 뜨는 복제·삭제 버튼 */}
      {!cropMode &&
        (() => {
          const markerActive = markerSelected && !step.markerHidden
          const selBox: Box | null = markerActive
            ? m
            : (step.extras.find((e) => e.id === selectedExtraId) ?? null)
          if (!selBox) return null
          const cxPct = ((selBox.x + selBox.width / 2 - view.x) / view.width) * 100
          const topPct = ((selBox.y - view.y) / view.height) * 100
          const botPct = ((selBox.y + selBox.height - view.y) / view.height) * 100
          const placeBelow = topPct < 12
          const yPct = placeBelow ? botPct : topPct
          const onDuplicate = markerActive ? onDuplicateMarker : () => onDuplicateExtra(selectedExtraId!)
          const onDelete = markerActive ? onHideMarker : () => onDeleteExtra(selectedExtraId!)
          return (
            <div
              className="shape-toolbar"
              style={{
                left: `${cxPct}%`,
                top: `${yPct}%`,
                transform: placeBelow
                  ? 'translate(-50%, 10px)'
                  : 'translate(-50%, calc(-100% - 10px))'
              }}
            >
              <button title="복제" onClick={onDuplicate}>
                ⧉ 복제
              </button>
              <button className="danger" title="삭제" onClick={onDelete}>
                🗑 삭제
              </button>
            </div>
          )
        })()}
    </div>
  )
}
