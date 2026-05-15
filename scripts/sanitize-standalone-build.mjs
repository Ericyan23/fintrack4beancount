import fs from 'node:fs'
import path from 'node:path'

const STANDALONE_DIR = path.join('.next', 'standalone')
const SENSITIVE_EXTENSIONS = new Set([
  '.bean',
  '.beancount',
  '.csv',
  '.db',
  '.jsonl',
  '.ledger',
  '.log',
  '.shm',
  '.sqlite',
  '.sqlite3',
  '.tsv',
  '.wal',
])
const SENSITIVE_ARCHIVE_EXTENSIONS = [
  '.tar.gz',
  '.tar',
  '.tgz',
  '.zip',
]
const SENSITIVE_SUFFIXES = [
  '.db-shm',
  '.db-wal',
  '.sqlite-shm',
  '.sqlite-wal',
  '.sqlite3-shm',
  '.sqlite3-wal',
]

function isSensitiveStandaloneFile(filePath) {
  const basename = path.basename(filePath).toLowerCase()
  if (basename === '.env' || basename.startsWith('.env.')) return true
  if (SENSITIVE_SUFFIXES.some(suffix => basename.endsWith(suffix))) return true
  if (SENSITIVE_ARCHIVE_EXTENSIONS.some(suffix => basename.endsWith(suffix))) return true
  return SENSITIVE_EXTENSIONS.has(path.extname(basename))
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return []

  const stat = fs.lstatSync(root)
  if (stat.isSymbolicLink()) return []
  if (stat.isFile()) return [root]
  if (!stat.isDirectory()) return []

  const files = []
  for (const entry of fs.readdirSync(root)) {
    files.push(...walkFiles(path.join(root, entry)))
  }
  return files
}

function removeDirectoryIfEmpty(dir) {
  if (!fs.existsSync(dir)) return
  const stat = fs.lstatSync(dir)
  if (!stat.isDirectory() || stat.isSymbolicLink()) return
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
}

function findSensitiveStandaloneFiles(root = process.cwd()) {
  const standaloneRoot = path.join(root, STANDALONE_DIR)
  return walkFiles(standaloneRoot)
    .filter(isSensitiveStandaloneFile)
    .sort((a, b) => a.localeCompare(b))
}

function sanitizeStandaloneBuild(root = process.cwd()) {
  const standaloneRoot = path.join(root, STANDALONE_DIR)
  const sensitiveFiles = findSensitiveStandaloneFiles(root)

  for (const file of sensitiveFiles) {
    fs.unlinkSync(file)
  }

  removeDirectoryIfEmpty(path.join(standaloneRoot, 'data'))

  const remaining = findSensitiveStandaloneFiles(root)
  if (remaining.length > 0) {
    const relative = remaining.map(file => path.relative(root, file)).join(', ')
    throw new Error(`Sensitive files remain in standalone build: ${relative}`)
  }

  return sensitiveFiles.map(file => path.relative(root, file))
}

const removed = sanitizeStandaloneBuild()
if (removed.length > 0) {
  console.log(`Removed sensitive standalone build files: ${removed.join(', ')}`)
}
