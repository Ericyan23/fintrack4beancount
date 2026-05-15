import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { NextRequest } from 'next/server'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-rules-api-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const originalDateNow = Date.now
const fixedNowMs = 1775174400000

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const rulesRoute = require('../app/api/rules/route') as typeof import('../app/api/rules/route')

interface RuleRow {
  id: number
  pattern: string
  category: string
  priority: number
  createdAt: number
}

function request(pathname: string, init?: RequestInit): NextRequest {
  return new Request(`http://localhost${pathname}`, init) as NextRequest
}

function jsonRequest(pathname: string, body: unknown): NextRequest {
  return request(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function resetDb(): void {
  sqlite.exec('DELETE FROM rules')
}

function insertRule(): number {
  const response = sqlite.prepare(`
    INSERT INTO rules (pattern, category, priority, created_at)
    VALUES (?, ?, ?, ?)
  `).run(
    'COFFEE',
    'Expenses:Food:Coffee',
    5,
    1775001600,
  )
  return Number(response.lastInsertRowid)
}

function readRule(id: number): RuleRow {
  return sqlite.prepare(`
    SELECT id,
           pattern,
           category,
           priority,
           created_at AS createdAt
    FROM rules
    WHERE id = ?
  `).get(id) as RuleRow
}

beforeEach(() => {
  Date.now = () => fixedNowMs
  resetDb()
})

after(() => {
  Date.now = originalDateNow
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('POST /api/rules trims and creates a ledger-account rule', async () => {
  const response = await rulesRoute.POST(jsonRequest('/api/rules', {
    pattern: '  PAYROLL  ',
    category: '  Income:Salary  ',
    priority: '12',
  }))
  const payload = await response.json()

  assert.equal(response.status, 201)
  assert.equal(payload.rules.length, 1)
  assert.equal(payload.rules[0].pattern, 'PAYROLL')
  assert.equal(payload.rules[0].category, 'Income:Salary')
  assert.equal(payload.rules[0].priority, 12)
  assert.equal(payload.rules[0].createdAt, 1775174400)
})

test('PATCH /api/rules updates pattern, ledger account, and priority', async () => {
  const id = insertRule()

  const response = await rulesRoute.PATCH(jsonRequest('/api/rules', {
    id,
    pattern: 'PAYROLL',
    category: 'Income:Salary',
    priority: 20,
  }))
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.rules.length, 1)
  assert.equal(payload.rules[0].pattern, 'PAYROLL')
  assert.equal(payload.rules[0].category, 'Income:Salary')
  assert.equal(payload.rules[0].priority, 20)

  const row = readRule(id)
  assert.equal(row.pattern, 'PAYROLL')
  assert.equal(row.category, 'Income:Salary')
  assert.equal(row.priority, 20)
  assert.equal(row.createdAt, 1775001600)
})

test('PATCH /api/rules rejects invalid updates without mutating the rule', async () => {
  const id = insertRule()

  const response = await rulesRoute.PATCH(jsonRequest('/api/rules', {
    id,
    pattern: '[',
    category: 'Income:Salary',
  }))
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 400)
  assert.equal(payload.error, 'Invalid regex pattern')
  assert.deepEqual(readRule(id), {
    id,
    pattern: 'COFFEE',
    category: 'Expenses:Food:Coffee',
    priority: 5,
    createdAt: 1775001600,
  })
})

test('PATCH /api/rules validates ids', async () => {
  const invalidResponse = await rulesRoute.PATCH(jsonRequest('/api/rules', {
    id: 'not-a-number',
    pattern: 'PAYROLL',
    category: 'Income:Salary',
  }))
  const invalidPayload = await invalidResponse.json() as { error?: string }

  assert.equal(invalidResponse.status, 400)
  assert.equal(invalidPayload.error, 'valid id required')

  const missingResponse = await rulesRoute.PATCH(jsonRequest('/api/rules', {
    id: 999,
    pattern: 'PAYROLL',
    category: 'Income:Salary',
  }))
  const missingPayload = await missingResponse.json() as { error?: string }

  assert.equal(missingResponse.status, 404)
  assert.equal(missingPayload.error, 'rule not found')
})
