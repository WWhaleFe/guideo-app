# 🎬 Guideo

화면 녹화 한 번으로 클릭 경로를 자동 캡처해 단계별 안내 이미지를 만들어주는 macOS 앱 (MVP).

녹화 중 클릭 이벤트(시각·좌표·버튼)를 함께 기록하고, 클릭 직전 프레임을 자동 추출해 클릭 위치에 편집 가능한 마커를 표시합니다. 결과물은 번호가 매겨진 PNG 이미지 세트로 내보내 메일·보고서에 바로 사용할 수 있습니다.

## 실행

```bash
npm install
npm run dev
```

## 필요한 macOS 권한 (최초 1회)

시스템 설정 → 개인정보 보호 및 보안에서:

- **화면 기록**: 화면 녹화용 (개발 중에는 Electron에 허용)
- **손쉬운 사용**: 전역 마우스 클릭 감지용

권한 변경 후에는 앱을 재시작해야 적용됩니다.

## 사용 흐름

1. 녹화할 디스플레이 선택 → **녹화 시작** (창이 자동 최소화됨)
2. 안내하려는 작업을 평소처럼 마우스로 진행
3. <kbd>⌘⇧2</kbd> 또는 창을 열어 **녹화 중지**
4. 클릭 단계별 프레임이 자동 추출됨 → 마커 위치·색·크기, 캡션 편집
5. **PNG 내보내기** → step-01.png, step-02.png, … 생성

프로젝트(영상 + 이벤트 + 마커 데이터)는 `~/Documents/Guideo/`에 저장되며 언제든 다시 열어 편집할 수 있습니다.

## 패키징 (설치 파일 만들기)

electron-builder로 빌드하며, 아이콘은 `build/icon.icns`(mac)·`build/icon.ico`(win)를 사용합니다 (원본 `icon.png` 1024×1024에서 생성).

```bash
npm run package:mac   # → release/Guideo-<ver>-arm64.dmg
npm run package:win   # → release/Guideo Setup <ver>.exe
```

산출물은 `release/`에 생성됩니다. 렌더러(디자인)는 두 플랫폼이 동일 코드라 Windows도 macOS와 같은 화면으로 나옵니다.

### 플랫폼 참고사항

- **네이티브 모듈**: `uiohook-napi`(클릭 감지), `ffmpeg-static`(프레임 추출)는 prebuilt 바이너리를 쓰므로 `npmRebuild: false`로 설정되어 있습니다.
- **ffmpeg**: `ffmpeg-static`은 설치 시 호스트 OS 바이너리만 받습니다. Windows 패키지에는 Windows용 `ffmpeg.exe`가 함께 번들되어야 합니다. macOS에서 크로스 빌드할 때는 아래로 받아 넣습니다:
  ```bash
  curl -sL https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64.gz \
    | gunzip > node_modules/ffmpeg-static/ffmpeg.exe
  ```
  Windows에서 직접 빌드하면 이 과정은 필요 없습니다.
- **코드 서명**: 현재 미서명 로컬 빌드입니다.
  - macOS: 첫 실행 시 Gatekeeper가 막으면 앱을 우클릭 → **열기**, 또는 `xattr -cr /Applications/Guideo.app`.
  - 배포하려면 Apple Developer ID 서명 + 공증(mac), 코드 서명 인증서(win)가 필요합니다. `build/entitlements.mac.plist`가 준비되어 있습니다.
- **권한(설치본)**: 시스템 설정 → 개인정보 보호 및 보안에서 **Guideo.app**에 화면 기록·손쉬운 사용 권한을 다시 허용해야 합니다(개발 중 Electron에 준 권한과 별개).

## 기술 스택

- Electron + React + TypeScript (electron-vite)
- 화면 녹화: `getDisplayMedia` + MediaRecorder (webm)
- 전역 클릭 감지: uiohook-napi
- 프레임 추출: ffmpeg-static
- 마커는 이미지에 굽지 않고 별도 데이터(project.json)로 저장 → 내보낼 때만 합성
