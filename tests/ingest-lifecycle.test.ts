import assert from 'node:assert/strict'
import { test } from 'node:test'

const {
  canonicalTransactionLifecycleState,
  canonicalTransactionSourceId,
  importRunLifecycleState,
  rawImportItemLifecycleState,
  stagedTransactionLifecycleState,
  zeroLifecycleCounts,
} = require('../lib/ingest/lifecycle') as typeof import('../lib/ingest/lifecycle')

test('raw import lifecycle states preserve legacy raw statuses', () => {
  assert.equal(rawImportItemLifecycleState('pending'), 'raw_imported')
  assert.equal(rawImportItemLifecycleState('staged'), 'staged')
  assert.equal(rawImportItemLifecycleState('ignored'), 'ignored')
  assert.equal(rawImportItemLifecycleState('error'), 'failed')
})

test('staged transaction lifecycle states separate review state from legacy persistence status', () => {
  assert.equal(stagedTransactionLifecycleState({ status: 'staged', validationErrors: [] }), 'staged')
  assert.equal(stagedTransactionLifecycleState({ status: 'staged', validationErrors: ['account_id'] }), 'needs_review')
  assert.equal(stagedTransactionLifecycleState({ status: 'error', validationErrors: ['posted'] }), 'needs_review')
  assert.equal(stagedTransactionLifecycleState({ status: 'ready', category: null, validationErrors: [] }), 'needs_review')
  assert.equal(stagedTransactionLifecycleState({ status: 'ready', category: 'Expenses:Food', validationErrors: [] }), 'reviewed')
  assert.equal(stagedTransactionLifecycleState({ status: 'merged', transactionId: 'txn-1' }), 'export_ready')
  assert.equal(stagedTransactionLifecycleState({ status: 'ignored' }), 'ignored')
  assert.equal(stagedTransactionLifecycleState({ status: 'deleted' }), 'deleted')
})

test('canonical transaction lifecycle states distinguish review, export readiness, and export completion', () => {
  assert.equal(canonicalTransactionSourceId({ accountId: 'acct-1', id: 'txn-1' }), 'fintrack:acct-1:txn-1')
  assert.equal(canonicalTransactionLifecycleState({
    id: 'txn-1',
    accountId: 'acct-1',
    status: 'posted',
    reviewStatus: 'needs_review',
    ledgerAccount: null,
    category: null,
  }), 'needs_review')
  assert.equal(canonicalTransactionLifecycleState({
    id: 'txn-1',
    accountId: 'acct-1',
    status: 'posted',
    reviewStatus: 'reviewed',
    ledgerAccount: 'Expenses:Food',
    category: null,
  }), 'export_ready')
  assert.equal(canonicalTransactionLifecycleState({
    id: 'txn-1',
    accountId: 'acct-1',
    status: 'posted',
    reviewStatus: 'reviewed',
    ledgerAccount: 'Expenses:Food',
    category: null,
    exported: true,
  }), 'exported')
  assert.equal(canonicalTransactionLifecycleState({
    id: 'txn-1',
    accountId: 'acct-1',
    status: 'cancelled',
    reviewStatus: 'reviewed',
    ledgerAccount: 'Expenses:Food',
    category: null,
  }), 'deleted')
})

test('import run lifecycle states and count buckets are explicit v2 states', () => {
  assert.deepEqual(Object.keys(zeroLifecycleCounts()), [
    'raw_imported',
    'staged',
    'needs_review',
    'reviewed',
    'ignored',
    'deleted',
    'export_ready',
    'exported',
    'failed',
  ])
  assert.equal(importRunLifecycleState('running'), 'raw_imported')
  assert.equal(importRunLifecycleState('completed'), 'reviewed')
  assert.equal(importRunLifecycleState('failed'), 'failed')
})
