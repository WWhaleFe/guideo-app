import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import type { AppDefaults } from '../shared/types'

function defaultsPath(): string {
  return path.join(app.getPath('userData'), 'defaults.json')
}

export async function getDefaults(): Promise<AppDefaults | null> {
  try {
    const raw = await fs.readFile(defaultsPath(), 'utf-8')
    return JSON.parse(raw) as AppDefaults
  } catch {
    return null
  }
}

export async function setDefaults(defaults: AppDefaults): Promise<void> {
  await fs.mkdir(path.dirname(defaultsPath()), { recursive: true })
  await fs.writeFile(defaultsPath(), JSON.stringify(defaults, null, 2))
}
