import fs from 'node:fs'
import path from 'node:path'

const nextDir = path.join(process.cwd(), '.next')

if (fs.existsSync(nextDir)) {
  const trashDir = path.join(
    path.dirname(process.cwd()),
    `.fintrack-next-build-trash-${process.pid}-${Date.now()}`,
  )
  fs.renameSync(nextDir, trashDir)
}
