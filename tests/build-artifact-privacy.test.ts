import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const sanitizerScript = path.join(process.cwd(), 'scripts', 'sanitize-standalone-build.mjs')
const cleanerScript = path.join(process.cwd(), 'scripts', 'clean-next-build.mjs')
const CLEANER_TRASH_PREFIX = '.fintrack-next-build-trash-'

test('build cleaner removes stale Next output before rebuilds', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-next-cleaner-'))
  const trashParent = path.dirname(tempDir)
  const trashBefore = new Set(fs.readdirSync(trashParent).filter(entry => entry.startsWith(CLEANER_TRASH_PREFIX)))
  let movedTrash: string[] = []
  try {
    const nextDir = path.join(tempDir, '.next')
    const standaloneDir = path.join(nextDir, 'standalone')
    fs.mkdirSync(path.join(standaloneDir, 'nested'), { recursive: true })
    fs.writeFileSync(path.join(standaloneDir, 'nested', 'server.js'), 'old build')

    execFileSync(process.execPath, [cleanerScript], {
      cwd: tempDir,
      encoding: 'utf8',
    })

    assert.equal(fs.existsSync(nextDir), false)
    const trashAfter = fs.readdirSync(trashParent).filter(entry => entry.startsWith(CLEANER_TRASH_PREFIX))
    movedTrash = trashAfter.filter(entry => !trashBefore.has(entry))
    assert.equal(movedTrash.length, 1)
  } finally {
    for (const entry of movedTrash) {
      fs.rmSync(path.join(trashParent, entry), { recursive: true, force: true })
    }
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('standalone build sanitizer removes local financial artifacts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-standalone-sanitizer-'))
  try {
    const standaloneDir = path.join(tempDir, '.next', 'standalone')
    fs.mkdirSync(path.join(standaloneDir, 'data'), { recursive: true })
    fs.mkdirSync(path.join(standaloneDir, 'nested'), { recursive: true })
    fs.writeFileSync(path.join(standaloneDir, 'data', 'fintrack.db'), 'private database')
    fs.writeFileSync(path.join(standaloneDir, 'data', 'fintrack.db-wal'), 'private wal')
    fs.writeFileSync(path.join(standaloneDir, 'nested', 'statement.csv'), 'private csv')
    fs.writeFileSync(path.join(standaloneDir, 'nested', 'statement.ofx'), 'private ofx')
    fs.writeFileSync(path.join(standaloneDir, 'nested', 'statement.pdf'), 'private pdf')
    fs.writeFileSync(path.join(standaloneDir, 'nested', 'statement.xlsx'), 'private xlsx')
    fs.writeFileSync(path.join(standaloneDir, '.env.production'), 'SECRET=value')
    fs.writeFileSync(path.join(standaloneDir, 'server.js'), 'console.log("ok")')

    const output = execFileSync(process.execPath, [sanitizerScript], {
      cwd: tempDir,
      encoding: 'utf8',
    })

    assert.match(output, /Removed sensitive standalone build files:/)
    assert.equal(fs.existsSync(path.join(standaloneDir, 'data')), false)
    assert.equal(fs.existsSync(path.join(standaloneDir, 'nested', 'statement.csv')), false)
    assert.equal(fs.existsSync(path.join(standaloneDir, 'nested', 'statement.ofx')), false)
    assert.equal(fs.existsSync(path.join(standaloneDir, 'nested', 'statement.pdf')), false)
    assert.equal(fs.existsSync(path.join(standaloneDir, 'nested', 'statement.xlsx')), false)
    assert.equal(fs.existsSync(path.join(standaloneDir, '.env.production')), false)
    assert.equal(fs.readFileSync(path.join(standaloneDir, 'server.js'), 'utf8'), 'console.log("ok")')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
