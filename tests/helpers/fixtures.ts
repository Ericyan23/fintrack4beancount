import fs from 'node:fs'
import path from 'node:path'

export function fixturePath(...parts: string[]): string {
  return path.join(process.cwd(), 'fixtures', ...parts)
}

export function readFixture(...parts: string[]): string {
  return fs.readFileSync(fixturePath(...parts), 'utf8')
}

export function readJsonFixture<T>(...parts: string[]): T {
  return JSON.parse(readFixture(...parts)) as T
}
