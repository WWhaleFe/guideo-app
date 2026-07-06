import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  net,
  protocol,
  screen,
  session,
  shell,
  systemPreferences
} from 'electron'
import path from 'path'
import { pathToFileURL } from 'url'
import { startCapture, stopCapture } from './recorder'
import {
  buildProject,
  loadProject,
  projectsRoot,
  saveProject,
  writeExportImages
} from './project'
import { getDefaults, setDefaults } from './settings'
import type {
  AppDefaults,
  DisplaySource,
  ExportImage,
  PermissionStatus,
  Project,
  Region
} from '../shared/types'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  }
])

let mainWindow: BrowserWindow | null = null
let remoteWindow: BrowserWindow | null = null
let regionWindow: BrowserWindow | null = null
let regionResolver: ((region: Region | null) => void) | null = null

/** 녹화 대상으로 선택된 desktopCapturer source id → display id 매핑 */
let selectedSourceId: string | null = null
let selectedDisplayId: number = -1
/** 영역 녹화 시 선택된 영역 (전역 화면 좌표, 포인트) */
let pendingRegion: Region | null = null
/** MediaRecorder onstart 시각 */
let recordingT0 = 0

function rendererUrl(hash: string): { url?: string; file?: string; hash: string } {
  if (process.env.ELECTRON_RENDERER_URL) {
    return { url: `${process.env.ELECTRON_RENDERER_URL}#${hash}`, hash }
  }
  return { file: path.join(__dirname, '../renderer/index.html'), hash }
}

function loadWindow(win: BrowserWindow, hash: string): void {
  const target = rendererUrl(hash)
  if (target.url) {
    win.loadURL(target.url)
  } else if (target.file) {
    win.loadFile(target.file, { hash })
  }
}

function selectedDisplay(): Electron.Display {
  return (
    screen.getAllDisplays().find((d) => d.id === selectedDisplayId) ?? screen.getPrimaryDisplay()
  )
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'Guideo',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

/** 녹화 중 떠 있는 리모컨 창 — 녹화 결과물에는 찍히지 않음 (content protection) */
function createRemoteWindow(): void {
  const bounds = selectedDisplay().bounds
  remoteWindow = new BrowserWindow({
    x: bounds.x + bounds.width - 360,
    y: bounds.y + 28,
    width: 336,
    height: 84,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })
  remoteWindow.setContentProtection(true)
  remoteWindow.setAlwaysOnTop(true, 'screen-saver')
  remoteWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  remoteWindow.on('closed', () => {
    remoteWindow = null
  })
  loadWindow(remoteWindow, 'remote')
}

function closeRemoteWindow(): void {
  remoteWindow?.close()
  remoteWindow = null
}

function createRegionWindow(): void {
  const bounds = selectedDisplay().bounds
  regionWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    fullscreenable: false,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  regionWindow.setAlwaysOnTop(true, 'screen-saver')
  regionWindow.on('closed', () => {
    regionWindow = null
    if (regionResolver) {
      regionResolver(null)
      regionResolver = null
    }
  })
  loadWindow(regionWindow, 'region')
  regionWindow.focus()
}

function resolveRegion(region: Region | null): void {
  const resolver = regionResolver
  regionResolver = null
  regionWindow?.close()
  regionWindow = null
  resolver?.(region)
}

function endRecordingSession(): void {
  globalShortcut.unregister('CommandOrControl+Shift+2')
  closeRemoteWindow()
  if (mainWindow) {
    mainWindow.restore()
    mainWindow.focus()
  }
}

app.whenReady().then(() => {
  // 로컬 프레임 이미지: media://frame?path=<encoded absolute path>
  protocol.handle('media', (request) => {
    const filePath = new URL(request.url).searchParams.get('path')
    if (!filePath) return new Response('missing path', { status: 400 })
    return net.fetch(pathToFileURL(filePath).toString())
  })

  // getDisplayMedia 요청 시 사용자가 고른 디스플레이를 반환 (display id 우선 매칭)
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      const source =
        sources.find((s) => Number(s.display_id) === selectedDisplayId) ??
        sources.find((s) => s.id === selectedSourceId) ??
        sources[0]
      callback({ video: source })
    })
  })

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

function registerIpc(): void {
  ipcMain.handle('permissions:check', (): PermissionStatus => {
    const screenOk =
      process.platform !== 'darwin' || systemPreferences.getMediaAccessStatus('screen') === 'granted'
    const accessibilityOk =
      process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(false)
    return { screen: screenOk, accessibility: accessibilityOk }
  })

  ipcMain.handle('permissions:request-accessibility', (): boolean => {
    if (process.platform !== 'darwin') return true
    return systemPreferences.isTrustedAccessibilityClient(true)
  })

  ipcMain.handle('displays:list', async (): Promise<DisplaySource[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 480, height: 300 }
    })
    const allDisplays = screen.getAllDisplays()
    const primary = screen.getPrimaryDisplay()

    const positionLabel = (d: Electron.Display | undefined): string => {
      if (!d || allDisplays.length < 2) return ''
      const p = primary.bounds
      if (d.id === primary.id) return '주 화면'
      if (d.bounds.x + d.bounds.width <= p.x) return '왼쪽'
      if (d.bounds.x >= p.x + p.width) return '오른쪽'
      if (d.bounds.y + d.bounds.height <= p.y) return '위'
      if (d.bounds.y >= p.y + p.height) return '아래'
      return '보조'
    }

    return sources.map((s, i) => {
      const display = allDisplays.find((d) => String(d.id) === s.display_id)
      const isPrimary = display?.id === primary.id
      return {
        id: s.id,
        displayId: s.display_id,
        name: s.name,
        thumbnailDataUrl: s.thumbnail.toDataURL(),
        width: display?.bounds.width ?? 0,
        height: display?.bounds.height ?? 0,
        primary: isPrimary,
        index: i + 1,
        positionLabel: positionLabel(display),
        scaleFactor: display?.scaleFactor ?? 1
      }
    })
  })

  ipcMain.handle('recording:select-source', (_e, sourceId: string, displayId: string): void => {
    selectedSourceId = sourceId
    selectedDisplayId = Number(displayId)
    pendingRegion = null
  })

  // ---------- 영역 선택 ----------
  ipcMain.handle('region:select', (): Promise<Region | null> => {
    return new Promise((resolve) => {
      regionResolver = (region) => {
        pendingRegion = region
        resolve(region)
      }
      createRegionWindow()
    })
  })

  ipcMain.handle('region:done', (_e, local: Region): void => {
    const bounds = selectedDisplay().bounds
    resolveRegion({
      x: bounds.x + local.x,
      y: bounds.y + local.y,
      width: local.width,
      height: local.height
    })
  })

  ipcMain.handle('region:cancel', (): void => {
    resolveRegion(null)
  })

  // ---------- 녹화 ----------
  ipcMain.handle('recording:started', (_e, t0: number): void => {
    if (!mainWindow) return
    recordingT0 = t0
    createRemoteWindow()
    const excluded = [mainWindow, remoteWindow].filter(Boolean) as BrowserWindow[]
    startCapture(excluded, (count) => {
      mainWindow?.webContents.send('recording:click-count', count)
      remoteWindow?.webContents.send('recording:click-count', count)
    })
    globalShortcut.register('CommandOrControl+Shift+2', () => {
      mainWindow?.webContents.send('recording:stop-requested')
    })
    mainWindow.minimize()
  })

  ipcMain.handle('remote:info', (): { t0: number } => ({ t0: recordingT0 }))

  ipcMain.handle('remote:stop', (): void => {
    mainWindow?.webContents.send('recording:stop-requested')
  })

  ipcMain.handle(
    'recording:finish',
    async (_e, videoBuffer: ArrayBuffer, t0: number): Promise<Project> => {
      const events = stopCapture()
      endRecordingSession()
      return buildProject({
        videoBuffer: Buffer.from(videoBuffer),
        t0,
        displayId: selectedDisplayId,
        region: pendingRegion,
        events
      })
    }
  )

  ipcMain.handle('recording:cancel', (): void => {
    stopCapture()
    endRecordingSession()
  })

  // ---------- 프로젝트/내보내기 ----------
  ipcMain.handle('project:save', async (_e, project: Project): Promise<void> => {
    await saveProject(project)
  })

  ipcMain.handle('project:open', async (): Promise<Project | null> => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '프로젝트 열기',
      defaultPath: projectsRoot(),
      filters: [{ name: 'Guideo 프로젝트', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return loadProject(result.filePaths[0])
  })

  ipcMain.handle('app:projects-root', (): string => projectsRoot())

  ipcMain.handle('defaults:get', async () => getDefaults())

  ipcMain.handle('defaults:set', async (_e, defaults: AppDefaults): Promise<void> => {
    await setDefaults(defaults)
  })

  ipcMain.handle('reveal:path', async (_e, target: string): Promise<void> => {
    await shell.openPath(target)
  })

  ipcMain.handle('export:images', async (_e, images: ExportImage[]): Promise<string[] | null> => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '내보낼 폴더 선택',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const written = await writeExportImages(result.filePaths[0], images)
    shell.openPath(result.filePaths[0])
    return written
  })
}
