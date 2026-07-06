import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppDefaults,
  DisplaySource,
  ExportImage,
  PermissionStatus,
  Project,
  Region
} from '../shared/types'

const api = {
  checkPermissions: (): Promise<PermissionStatus> => ipcRenderer.invoke('permissions:check'),
  requestAccessibility: (): Promise<boolean> =>
    ipcRenderer.invoke('permissions:request-accessibility'),

  listDisplays: (): Promise<DisplaySource[]> => ipcRenderer.invoke('displays:list'),
  selectSource: (sourceId: string, displayId: string): Promise<void> =>
    ipcRenderer.invoke('recording:select-source', sourceId, displayId),

  // 영역 선택
  selectRegion: (): Promise<Region | null> => ipcRenderer.invoke('region:select'),
  regionDone: (region: Region): Promise<void> => ipcRenderer.invoke('region:done', region),
  regionCancel: (): Promise<void> => ipcRenderer.invoke('region:cancel'),

  // 녹화
  recordingStarted: (t0: number): Promise<void> => ipcRenderer.invoke('recording:started', t0),
  finishRecording: (videoBuffer: ArrayBuffer, t0: number): Promise<Project> =>
    ipcRenderer.invoke('recording:finish', videoBuffer, t0),
  cancelRecording: (): Promise<void> => ipcRenderer.invoke('recording:cancel'),

  // 리모컨 창
  remoteInfo: (): Promise<{ t0: number }> => ipcRenderer.invoke('remote:info'),
  remoteStop: (): Promise<void> => ipcRenderer.invoke('remote:stop'),

  onClickCount: (cb: (count: number) => void): (() => void) => {
    const listener = (_e: unknown, count: number): void => cb(count)
    ipcRenderer.on('recording:click-count', listener)
    return () => ipcRenderer.removeListener('recording:click-count', listener)
  },
  onStopRequested: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('recording:stop-requested', listener)
    return () => ipcRenderer.removeListener('recording:stop-requested', listener)
  },

  // 프로젝트 / 내보내기 / 폴더 열기
  saveProject: (project: Project): Promise<void> => ipcRenderer.invoke('project:save', project),
  openProject: (): Promise<Project | null> => ipcRenderer.invoke('project:open'),
  projectsRoot: (): Promise<string> => ipcRenderer.invoke('app:projects-root'),
  getDefaults: (): Promise<AppDefaults | null> => ipcRenderer.invoke('defaults:get'),
  setDefaults: (defaults: AppDefaults): Promise<void> =>
    ipcRenderer.invoke('defaults:set', defaults),
  revealPath: (target: string): Promise<void> => ipcRenderer.invoke('reveal:path', target),
  exportToFolder: (dir: string, images: ExportImage[]): Promise<string[] | null> =>
    ipcRenderer.invoke('export:to-folder', dir, images),
  exportSaveAs: (images: ExportImage[]): Promise<string[] | null> =>
    ipcRenderer.invoke('export:save-as', images)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
