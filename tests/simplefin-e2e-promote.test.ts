import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readJsonFixture } from './helpers/fixtures'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-simplefin-e2e-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const store = require('../lib/ingest/store') as typeof import('../lib/ingest/store')
const {
  stageSimpleFinPayload,
} = require('../lib/ingest/simplefin-import') as typeof import('../lib/ingest/simplefin-import')
const {
  updateSourceAccountMapping,
} = require('../lib/ingest/account-mapping') as typeof import('../lib/ingest/account-mapping')
const {
  promoteStagedTransactions,
} = require('../lib/ingest/promote') as typeof import('../lib/ingest/promote')
const {
  buildSimpleFinSourceAccountId,
  SIMPLEFIN_NORMALIZER_VERSION,
} = require('../lib/ingest/simplefin') as typeof import('../lib/ingest/simplefin')

type SimpleFinPayload = import('../lib/ingest/simplefin').SimpleFinPayload

const CONNECTION_ID = 'simplefin-conn-e2e'
const CHECKING_ACCT_ID = 'acct-e2e-checking'
const CREDIT_ACCT_ID = 'acct-e2e-credit'

interface CanonicalRow {
  id: string
  accountId: string
  sourceConnectionId: string
  sourceAccountId: string
  externalId: string | null
  sourceItemKey: string
  importRunId: string | null
  rawItemId: string | null
  normalizerVersion: string | null
  source: string | null
  posted: number
  transactedAt: number | null
  amount: string
  description: string
  pending: number
  status: string
  category: string | null
  ledgerAccount: string | null
  reviewStatus: string | null
  classifier: string | null
  updatedAt: number
}

interface CountRow {
  n: number
}

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM staged_transactions;
    DELETE FROM transfer_matches;
    DELETE FROM transactions;
    DELETE FROM raw_import_items;
    DELETE FROM import_runs;
    DELETE FROM import_profile_mappings;
    DELETE FROM import_profiles;
    DELETE FROM source_accounts;
    DELETE FROM source_connections;
    DELETE FROM sources;
    DELETE FROM accounts;
  `)
}

function seedAccount(id: string, name: string, type: 'depository' | 'credit' = 'depository'): void {
  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, 'USD', '0.00', 1775001600, 'e2e-conn', 'Example Bank',
            'examplebank.test', ?, NULL, NULL, 1775001600)
  `).run(id, name, type)
}

function fixture(): SimpleFinPayload {
  return readJsonFixture<SimpleFinPayload>('simplefin', 'multi-account-pending.json')
}

function checkingSourceAccountId(): string {
  return buildSimpleFinSourceAccountId(CONNECTION_ID, 'simplefin-checking-001')
}

function creditSourceAccountId(): string {
  return buildSimpleFinSourceAccountId(CONNECTION_ID, 'simplefin-credit-001')
}

function stageAndMapFixture(): { importRunId: string } {
  seedAccount(CHECKING_ACCT_ID, 'E2E Checking', 'depository')
  seedAccount(CREDIT_ACCT_ID, 'E2E Credit', 'credit')

  const result = stageSimpleFinPayload(fixture(), { sourceConnectionId: CONNECTION_ID })

  updateSourceAccountMapping({
    importRunId: result.importRunId,
    sourceAccountId: checkingSourceAccountId(),
    accountId: CHECKING_ACCT_ID,
  })
  updateSourceAccountMapping({
    importRunId: result.importRunId,
    sourceAccountId: creditSourceAccountId(),
    accountId: CREDIT_ACCT_ID,
  })

  return { importRunId: result.importRunId }
}

function canonicalByExternalId(externalId: string): CanonicalRow | null {
  return sqlite.prepare(`
    SELECT id,
           account_id            AS accountId,
           source_connection_id  AS sourceConnectionId,
           source_account_id     AS sourceAccountId,
           external_id           AS externalId,
           source_item_key       AS sourceItemKey,
           import_run_id         AS importRunId,
           raw_item_id           AS rawItemId,
           normalizer_version    AS normalizerVersion,
           source,
           posted,
           transacted_at         AS transactedAt,
           amount,
           description,
           pending,
           status,
           category,
           ledger_account AS ledgerAccount,
           review_status AS reviewStatus,
           classifier,
           updated_at            AS updatedAt
    FROM transactions
    WHERE external_id = ?
    LIMIT 1
  `).get(externalId) as CanonicalRow | null
}

function canonicalCount(): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as CountRow).n
}

beforeEach(() => {
  resetDb()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

// ──────────────────────────────────────────────────────────────────────────────
// Test 1: Full E2E happy path with provenance verification
// ──────────────────────────────────────────────────────────────────────────────
test('full SimpleFIN E2E: stage, map source accounts, promote, verify provenance', () => {
  seedAccount(CHECKING_ACCT_ID, 'E2E Checking', 'depository')
  seedAccount(CREDIT_ACCT_ID, 'E2E Credit', 'credit')

  // Stage with no pre-existing mappings → all rows should be 'error' (unmapped)
  const stageResult = stageSimpleFinPayload(fixture(), { sourceConnectionId: CONNECTION_ID })

  assert.equal(stageResult.accounts, 2)
  assert.equal(stageResult.transactions, 7)
  assert.equal(stageResult.rawInserted, 7)
  assert.equal(stageResult.staged, 0, 'unmapped: no staged rows yet')
  assert.equal(stageResult.validationErrors, 7, 'one error per transaction: missing account_id')
  assert.equal(stageResult.merged, 0)
  assert.equal(canonicalCount(), 0)

  const stagedStatuses = sqlite.prepare(`
    SELECT status FROM staged_transactions WHERE import_run_id = ?
  `).all(stageResult.importRunId) as Array<{ status: string }>

  assert.ok(stagedStatuses.every(row => row.status === 'error'), 'all rows error before mapping')

  // Map checking source account → 3 checking rows become ready
  updateSourceAccountMapping({
    importRunId: stageResult.importRunId,
    sourceAccountId: checkingSourceAccountId(),
    accountId: CHECKING_ACCT_ID,
  })

  const checkingReady = sqlite.prepare(`
    SELECT COUNT(*) AS n FROM staged_transactions
    WHERE source_account_id = ? AND status = 'ready'
  `).get(checkingSourceAccountId()) as CountRow

  assert.equal(checkingReady.n, 3)

  // Map credit source account → 4 credit rows become ready
  updateSourceAccountMapping({
    importRunId: stageResult.importRunId,
    sourceAccountId: creditSourceAccountId(),
    accountId: CREDIT_ACCT_ID,
  })

  const creditReady = sqlite.prepare(`
    SELECT COUNT(*) AS n FROM staged_transactions
    WHERE source_account_id = ? AND status = 'ready'
  `).get(creditSourceAccountId()) as CountRow

  assert.equal(creditReady.n, 4)

  // Promote
  const promoteResult = promoteStagedTransactions({ importRunId: stageResult.importRunId })

  assert.deepEqual(promoteResult, { promoted: 7, skipped: 0, enriched: 5, errors: [] })
  assert.equal(canonicalCount(), 7)

  // ── Verify payroll (posted checking transaction) ──────────────────────────
  const payroll = canonicalByExternalId('sf-checking-payroll-001')
  assert.ok(payroll, 'payroll canonical exists')

  assert.equal(payroll.sourceConnectionId, CONNECTION_ID)
  assert.equal(payroll.sourceAccountId, checkingSourceAccountId())
  assert.equal(payroll.externalId, 'sf-checking-payroll-001')
  assert.equal(payroll.importRunId, stageResult.importRunId)
  assert.ok(payroll.rawItemId, 'raw_item_id is set')
  assert.equal(payroll.normalizerVersion, SIMPLEFIN_NORMALIZER_VERSION)
  assert.equal(payroll.source, 'simplefin')
  assert.equal(payroll.accountId, CHECKING_ACCT_ID)
  assert.equal(payroll.amount, '1500.00')
  assert.equal(payroll.description, 'Payroll Deposit')
  assert.equal(payroll.posted, 1774224000)
  assert.equal(payroll.transactedAt, 1774224000)
  assert.equal(payroll.pending, 0)
  assert.equal(payroll.status, 'posted')
  assert.equal(payroll.category, null)
  assert.equal(payroll.ledgerAccount, 'Income:Salary')
  assert.equal(payroll.reviewStatus, 'reviewed')
  assert.equal(payroll.classifier, 'rule')
  assert.ok(payroll.updatedAt > 0, 'updated_at is set')
  assert.match(payroll.id, /^txn:ingest:[a-f0-9]{32}$/)

  // source_item_key must be stable: based on externalId, not description
  assert.match(
    payroll.sourceItemKey,
    /^source-account:.+:external:sf-checking-payroll-001$/,
    'source_item_key uses external id',
  )

  // ── Verify pending checking transaction ───────────────────────────────────
  const pendingFuel = canonicalByExternalId('sf-checking-pending-fuel-001')
  assert.ok(pendingFuel)
  assert.equal(pendingFuel.pending, 1)
  assert.equal(pendingFuel.status, 'pending')
  assert.equal(pendingFuel.amount, '-42.10')
  assert.equal(pendingFuel.sourceConnectionId, CONNECTION_ID)
  assert.equal(pendingFuel.accountId, CHECKING_ACCT_ID)

  // ── Verify pending credit transaction ─────────────────────────────────────
  const pendingTravel = canonicalByExternalId('sf-credit-pending-travel-001')
  assert.ok(pendingTravel)
  assert.equal(pendingTravel.pending, 1)
  assert.equal(pendingTravel.status, 'pending')
  assert.equal(pendingTravel.amount, '-96.70')
  assert.equal(pendingTravel.sourceConnectionId, CONNECTION_ID)
  assert.equal(pendingTravel.sourceAccountId, creditSourceAccountId())
  assert.equal(pendingTravel.accountId, CREDIT_ACCT_ID)

  // ── All staged rows are now merged ────────────────────────────────────────
  const mergedCount = sqlite.prepare(`
    SELECT COUNT(*) AS n FROM staged_transactions
    WHERE import_run_id = ? AND status = 'merged'
  `).get(stageResult.importRunId) as CountRow

  assert.equal(mergedCount.n, 7)
})

// ──────────────────────────────────────────────────────────────────────────────
// Test 2: source_item_key and canonical id are stable — editing description
//         or category does not change the identity of a promoted transaction
// ──────────────────────────────────────────────────────────────────────────────
test('canonical transaction id is stable: derived from source_connection_id and source_item_key', () => {
  const { importRunId } = stageAndMapFixture()
  promoteStagedTransactions({ importRunId })

  const before = canonicalByExternalId('sf-checking-payroll-001')
  assert.ok(before)

  // Mutate mutable fields
  sqlite.prepare(`
    UPDATE transactions SET description = 'Edited Description', category = 'Expenses:Edited' WHERE id = ?
  `).run(before.id)

  const after = canonicalByExternalId('sf-checking-payroll-001')
  assert.ok(after)

  assert.equal(after.id, before.id, 'id unchanged after description edit')
  assert.equal(after.sourceItemKey, before.sourceItemKey, 'source_item_key unchanged')
  assert.equal(after.sourceConnectionId, before.sourceConnectionId, 'source_connection_id unchanged')
})

// ──────────────────────────────────────────────────────────────────────────────
// Test 3: Re-importing same payload marks staged rows merged at staging time
//         and produce no new canonical transactions on promote
// ──────────────────────────────────────────────────────────────────────────────
test('re-import same SimpleFIN payload: staged rows merge at staging time, promote yields 0 new', () => {
  // First import
  const { importRunId: run1Id } = stageAndMapFixture()
  const promote1 = promoteStagedTransactions({ importRunId: run1Id })
  assert.equal(promote1.promoted, 7)
  assert.equal(canonicalCount(), 7)

  // Second import of same payload — source accounts already mapped from first run
  // so findExistingSimpleFinTransaction will detect the canonical transactions
  const result2 = stageSimpleFinPayload(fixture(), { sourceConnectionId: CONNECTION_ID })
  assert.equal(result2.merged, 7, 'all rows merged at staging time (canonical duplicates exist)')
  assert.equal(result2.staged, 0)
  assert.equal(result2.validationErrors, 0)

  const promote2 = promoteStagedTransactions({ importRunId: result2.importRunId })
  assert.deepEqual(promote2, { promoted: 0, skipped: 7, enriched: 0, errors: [] })
  assert.equal(canonicalCount(), 7, 'no new canonical transactions')
})

// ──────────────────────────────────────────────────────────────────────────────
// Test 4: promote-level duplicate guard for runs where staging cannot detect
//         canonical duplicates (source accounts newly mapped after staging)
// ──────────────────────────────────────────────────────────────────────────────
test('promote skips canonical duplicates even when staging did not detect them', () => {
  seedAccount(CHECKING_ACCT_ID, 'E2E Checking', 'depository')
  seedAccount(CREDIT_ACCT_ID, 'E2E Credit', 'credit')

  // First run: stage → map → promote
  const result1 = stageSimpleFinPayload(fixture(), { sourceConnectionId: CONNECTION_ID })
  updateSourceAccountMapping({
    importRunId: result1.importRunId,
    sourceAccountId: checkingSourceAccountId(),
    accountId: CHECKING_ACCT_ID,
  })
  updateSourceAccountMapping({
    importRunId: result1.importRunId,
    sourceAccountId: creditSourceAccountId(),
    accountId: CREDIT_ACCT_ID,
  })
  promoteStagedTransactions({ importRunId: result1.importRunId })
  assert.equal(canonicalCount(), 7)

  // Temporarily unmap source accounts so second staging cannot detect duplicates
  sqlite.prepare(`UPDATE source_accounts SET fintrack_account_id = NULL`).run()

  // Second run: stage without account mappings → rows 'error', no merge detected
  const result2 = stageSimpleFinPayload(fixture(), { sourceConnectionId: CONNECTION_ID })
  assert.equal(result2.merged, 0, 'no merge detected during staging (accounts unmapped)')
  assert.equal(result2.staged, 0)
  assert.equal(result2.validationErrors, 7)

  // Re-map for second run so rows become promotable
  updateSourceAccountMapping({
    importRunId: result2.importRunId,
    sourceAccountId: checkingSourceAccountId(),
    accountId: CHECKING_ACCT_ID,
  })
  updateSourceAccountMapping({
    importRunId: result2.importRunId,
    sourceAccountId: creditSourceAccountId(),
    accountId: CREDIT_ACCT_ID,
  })

  // Promote second run — promote level detects canonical duplicates by
  // (source_connection_id, source_item_key) and skips them
  const promote2 = promoteStagedTransactions({ importRunId: result2.importRunId })
  assert.deepEqual(promote2, { promoted: 0, skipped: 7, enriched: 0, errors: [] })
  assert.equal(canonicalCount(), 7, 'no duplicate canonical transactions')
})

// ──────────────────────────────────────────────────────────────────────────────
// Test 5: Legacy SimpleFIN transactions detected at stage time are skipped at
//         promote time without creating duplicate canonical rows
// ──────────────────────────────────────────────────────────────────────────────
test('legacy SimpleFIN duplicate: merged staged rows are skipped at promote, not duplicated', () => {
  // Legacy accounts use the SimpleFIN external account ID as the Fintrack account ID
  const legacyCheckingId = 'simplefin-checking-001'
  const legacyCreditId = 'simplefin-credit-001'
  const legacyConnectionId = 'simplefin-conn-e2e-legacy'

  seedAccount(legacyCheckingId, 'Legacy Checking', 'depository')
  seedAccount(legacyCreditId, 'Legacy Credit', 'credit')

  // Pre-seed legacy source hierarchy (required for FKs on transactions)
  const legacySource = store.ensureSource({ id: 'simplefin', kind: 'simplefin', name: 'SimpleFIN' })
  const legacyConn = store.ensureSourceConnection({
    id: 'legacy:simplefin:examplebank.test',
    sourceId: legacySource.id,
    name: 'examplebank.test (legacy)',
  })
  const legacySourceAccount = store.ensureSourceAccount({
    id: `${legacyConn.id}:${legacyCheckingId}`,
    sourceConnectionId: legacyConn.id,
    fintrackAccountId: legacyCheckingId,
    externalAccountId: legacyCheckingId,
    name: 'Legacy Checking',
    currency: 'USD',
  })

  // Pre-seed one legacy canonical transaction for payroll
  const now = Math.floor(Date.now() / 1000)
  sqlite.prepare(`
    INSERT INTO transactions (
      id, account_id, source_connection_id, source_account_id, external_id,
      source_item_key, import_run_id, raw_item_id, normalizer_version, source,
      posted, transacted_at, amount, description, pending, status,
      category, suggested_cat, notes, tags, created_at, updated_at
    ) VALUES (
      'legacy-payroll-txn', ?, ?, ?,
      'sf-checking-payroll-001',
      'simplefin-checking-001:sf-checking-payroll-001',
      NULL, NULL, 'legacy-simplefin-v1', 'simplefin',
      1774224000, 1774224000, '1500.00', 'Payroll Deposit', 0, 'posted',
      NULL, NULL, NULL, NULL, ?, ?
    )
  `).run(legacyCheckingId, legacyConn.id, legacySourceAccount.id, now, now)

  assert.equal(canonicalCount(), 1)

  // Stage the full fixture with the legacy connection id
  const stageResult = stageSimpleFinPayload(fixture(), {
    sourceConnectionId: legacyConnectionId,
  })

  // findExistingAccountId('simplefin-checking-001') → 'simplefin-checking-001' ✓
  // findExistingSimpleFinTransaction('simplefin-checking-001', 'sf-checking-payroll-001') → 'legacy-payroll-txn'
  // → payroll staged row: status='merged'
  assert.equal(stageResult.merged, 1, 'payroll detected as legacy duplicate at staging time')
  assert.equal(stageResult.staged, 6, 'other 6 rows staged successfully')
  assert.equal(stageResult.errors, 0)

  const payrollStaged = sqlite.prepare(`
    SELECT status, transaction_id AS transactionId
    FROM staged_transactions
    WHERE external_id = 'sf-checking-payroll-001'
  `).get() as { status: string; transactionId: string }

  assert.equal(payrollStaged.status, 'merged')
  assert.equal(payrollStaged.transactionId, 'legacy-payroll-txn')

  // Promote
  const promoteResult = promoteStagedTransactions({ importRunId: stageResult.importRunId })

  assert.equal(promoteResult.promoted, 6)
  assert.equal(promoteResult.skipped, 1, 'merged legacy row skipped')
  assert.deepEqual(promoteResult.errors, [])

  // Total canonical: 1 legacy + 6 newly promoted = 7
  assert.equal(canonicalCount(), 7)

  // Legacy payroll transaction is unchanged
  const legacyPayroll = canonicalByExternalId('sf-checking-payroll-001')
  assert.ok(legacyPayroll)
  assert.equal(legacyPayroll.id, 'legacy-payroll-txn', 'legacy transaction id not changed')
  assert.equal(legacyPayroll.normalizerVersion, 'legacy-simplefin-v1', 'legacy normalizer version preserved')
})
