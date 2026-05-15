import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const sanitizerScript = path.join(process.cwd(), 'scripts', 'sanitize-standalone-build.mjs')

test('standalone build sanitizer removes local financial artifacts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-standalone-sanitizer-'))
  try {
    const standaloneDir = path.join(tempDir, '.next', 'standalone')
    fs.mkdirSync(path.join(standaloneDir, 'data'), { recursive: true })
    fs.mkdirSync(path.join(standaloneDir, 'nested'), { recursive: true })
    fs.writeFileSync(path.join(standaloneDir, 'data', 'fintrack.db'), 'private database')
    fs.writeFileSync(path.join(standaloneDir, 'data', 'fintrack.db-wal'), 'private wal')
    fs.writeFileSync(path.join(standaloneDir, 'nested', 'statement.csv'), 'private csv')
    fs.writeFileSync(path.join(standaloneDir, '.env.production'), 'SECRET=value')
    fs.writeFileSync(path.join(standaloneDir, 'server.js'), 'console.log("ok")')

    const output = execFileSync(process.execPath, [sanitizerScript], {
      cwd: tempDir,
      encoding: 'utf8',
    })

    assert.match(output, /Removed sensitive standalone build files:/)
    assert.equal(fs.existsSync(path.join(standaloneDir, 'data')), false)
    assert.equal(fs.existsSync(path.join(standaloneDir, 'nested', 'statement.csv')), false)
    assert.equal(fs.existsSync(path.join(standaloneDir, '.env.production')), false)
    assert.equal(fs.readFileSync(path.join(standaloneDir, 'server.js'), 'utf8'), 'console.log("ok")')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
