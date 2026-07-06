export type ClickButton = 'left' | 'right' | 'middle'

export interface RawClickEvent {
  /** epoch ms, Date.now() 기준 (누른 시점) */
  time: number
  /** 'click' = 제자리 클릭, 'drag' = 드래그 (x,y=시작 / x2,y2=끝) */
  kind: 'click' | 'drag'
  /** 전역 화면 좌표 (논리 포인트) — 클릭 지점 또는 드래그 시작점 */
  x: number
  y: number
  /** 드래그 끝점 (kind='drag'일 때) */
  x2?: number
  y2?: number
  button: ClickButton
  /** 1 = 단일 클릭, 2 이상 = 더블클릭 */
  clicks: number
}

/** 화면 영역 (포인트 단위, 전역 또는 로컬 좌표) */
export interface Region {
  x: number
  y: number
  width: number
  height: number
}

export type MarkerShape = 'circle' | 'rect' | 'arrow' | 'highlight'

/** 화살표 촉이 향하는 박스 모서리 */
export type ArrowCorner = 'nw' | 'ne' | 'sw' | 'se'

/** 캡션 표시 방식: overlay = 이미지 위(위치 지정 가능), bar = 내보낼 때 하단 바 합성 */
export type CaptionMode = 'overlay' | 'bar'

export interface Marker {
  /** 바운딩 박스 좌상단 (영상 픽셀) — 추가 도형과 동일하게 박스 기반, 8핸들 리사이즈 */
  x: number
  y: number
  width: number
  height: number
  color: string
  shape: MarkerShape
  /** arrow일 때 촉이 향하는 모서리 (기본 nw) */
  arrowTip?: ArrowCorner
  /** arrow 화살촉 길이 (px, 영상 픽셀). 없으면 선 굵기 기반 자동 */
  arrowHead?: number
  /** 외곽선 굵기 (px) */
  strokeWidth: number
  /** 도형 내부 채우기 여부 (false = 투명) */
  fill: boolean
  /** 0.1 ~ 1 */
  opacity: number
  /** 번호 배지 표시 여부 */
  showNumber: boolean
  /** 클릭 유형 라벨(더블클릭/우클릭) 표시 여부 */
  showClickLabel: boolean
}

/** 캡션 텍스트/박스 스타일 */
export interface CaptionStyle {
  /** 폰트 키 (system | serif | mono | round) */
  font: string
  fontSize: number
  /** 글자 색 */
  color: string
  /** 배경 박스 표시 여부 */
  boxEnabled: boolean
  boxColor: string
  /** 박스 배경 불투명도 0~1 */
  boxOpacity: number
  borderColor: string
  /** 0 = 테두리 없음 */
  borderWidth: number
}

/** 개별 캡션 — 한 스텝에 여러 개 넣을 수 있고 각각 여러 줄 가능 */
export interface CaptionItem {
  id: string
  text: string
  /** 박스 좌상단 위치 (영상 픽셀). null이면 마커 아래 자동 배치 */
  pos: { x: number; y: number } | null
}

/**
 * 사용자가 수동으로 추가한 도형 — 클릭 마커와 달리 번호 배지가 없고, 바운딩 박스(x,y,w,h)로
 * 정의되어 이미지 위에서 8개 핸들로 자유롭게 크기를 조절할 수 있다.
 */
export interface ExtraShape {
  id: string
  shape: MarkerShape
  /** 바운딩 박스 좌상단 (영상 픽셀) */
  x: number
  y: number
  width: number
  height: number
  color: string
  /** arrow일 때 촉이 향하는 모서리 (기본 nw) */
  arrowTip?: ArrowCorner
  /** arrow 화살촉 길이 (px). 없으면 선 굵기 기반 자동 */
  arrowHead?: number
  strokeWidth: number
  fill: boolean
  opacity: number
}

export interface Step {
  id: string
  videoTimeSec: number
  button: ClickButton
  clicks: number
  marker: Marker
  /** 마커 숨김 (삭제해도 프레임 이미지는 유지) */
  markerHidden?: boolean
  /** 사용자가 추가한 도형들 */
  extras: ExtraShape[]
  captions: CaptionItem[]
  captionMode: CaptionMode
  captionStyle: CaptionStyle
  /** 이미지 크롭 영역 (영상 픽셀, 원본 기준). null이면 전체 */
  crop: Region | null
  /** 프로젝트 디렉토리 기준 상대 경로 */
  frameFile: string
}

/** "현재 설정을 기본값으로" 저장되는 앱 기본 스타일 — 새 녹화의 스텝에 적용 */
export interface AppDefaults {
  marker: Omit<Marker, 'x' | 'y'>
  captionMode: CaptionMode
  captionStyle: CaptionStyle
}

export interface Project {
  version: 1
  name: string
  dir: string
  videoFile: string
  videoWidth: number
  videoHeight: number
  /** 영역 녹화 시 선택된 영역 (전역 화면 좌표, 포인트) */
  region?: Region | null
  createdAt: string
  steps: Step[]
}

export interface DisplaySource {
  /** desktopCapturer source id */
  id: string
  /** Electron display id (문자열) */
  displayId: string
  name: string
  thumbnailDataUrl: string
  width: number
  height: number
  /** 주 디스플레이 여부 */
  primary: boolean
  /** 목록 순번 (1부터) */
  index: number
  /** 전역 배치 위치 라벨 (예: "좌측", "우측", "위") */
  positionLabel: string
  /** Retina 배율 */
  scaleFactor: number
}

export interface PermissionStatus {
  screen: boolean
  accessibility: boolean
}

export interface ExportImage {
  fileName: string
  dataUrl: string
}
