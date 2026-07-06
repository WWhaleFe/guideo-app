import type { Project, Step } from '../../shared/types'

/** 프로젝트 내 프레임 파일의 media:// URL (경로는 쿼리 파라미터로 전달해 파싱 모호성 제거) */
export function frameUrl(project: Project, step: Step): string {
  return 'media://frame?path=' + encodeURIComponent(project.dir + '/' + step.frameFile)
}
