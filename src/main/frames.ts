import { execFile } from 'child_process'
import { promisify } from 'util'
import ffmpegPath from 'ffmpeg-static'
import fs from 'fs/promises'

const execFileAsync = promisify(execFile)

function ffmpeg(): string {
  if (!ffmpegPath) throw new Error('ffmpeg binary not found')
  // asar 패키징 시 unpacked 경로로 치환 (개발 모드에서는 그대로)
  return (ffmpegPath as string).replace('app.asar', 'app.asar.unpacked')
}

/**
 * MediaRecorder가 만든 webm은 duration 메타데이터가 없어 탐색이 부정확하다.
 * 스트림 복사 리먹스로 탐색 가능한 파일을 만든다.
 */
export async function remux(src: string, dst: string): Promise<void> {
  await execFileAsync(ffmpeg(), ['-y', '-i', src, '-c', 'copy', dst])
}

export interface CropPx {
  x: number
  y: number
  width: number
  height: number
}

/** 지정 시각의 프레임 1장을 PNG로 추출 (crop은 영상 픽셀 단위). 성공 여부를 반환. */
export async function extractFrame(
  video: string,
  timeSec: number,
  outPng: string,
  crop?: CropPx | null
): Promise<boolean> {
  const t = Math.max(0, timeSec)
  try {
    const args = ['-y', '-ss', t.toFixed(3), '-i', video]
    if (crop) {
      args.push('-vf', `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`)
    }
    args.push('-frames:v', '1', outPng)
    await execFileAsync(ffmpeg(), args)
    await fs.access(outPng)
    return true
  } catch {
    return false
  }
}
