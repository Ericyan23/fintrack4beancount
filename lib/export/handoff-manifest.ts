import path from 'path'
import {
  defaultBeancountRoot,
  ledgerRevision,
  loadLedgerSnapshot,
} from '@/lib/export/beancount-ledger'
import { currentPeriod, runBeancountPreflight } from '@/lib/export/preflight'
import { runBalanceAssertionPreflight } from '@/lib/export/balance-assertions'

export interface BeancountHandoffManifest {
  schemaVersion: 1
  source: 'fintrack'
  period: string
  generatedAt: string
  ok: boolean
  beancountRoot: string
  ledger: {
    revision: string
    filesScanned: number
    openAccounts: number
    sourceIds: number
    balances: number
  }
  handoff: {
    directory: string
    manifestFile: string
    combinedDraftFile: string
    transactionDraftFile: string
    balanceAssertionDraftFile: string
  }
  counts: {
    transactions: number
    transfers: number
    balanceAssertions: number
    skipped: number
    transactionBlockers: number
    balanceAssertionBlockers: number
    reviewItems: number
    duplicateCandidates: number
  }
  preflight: {
    transactionsOk: boolean
    balanceAssertionsOk: boolean
  }
  sourceIds: string[]
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}

export function buildBeancountHandoffManifest(options: {
  period?: string
  generatedAt?: Date
  beancountRoot?: string
  excludeExported?: boolean
} = {}): BeancountHandoffManifest {
  const period = options.period ?? currentPeriod()
  const generatedAt = options.generatedAt ?? new Date()
  const beancountRoot = options.beancountRoot ?? defaultBeancountRoot()
  const transactionPreflight = runBeancountPreflight({
    period,
    beancountRoot,
    excludeExported: options.excludeExported,
  })
  const balancePreflight = runBalanceAssertionPreflight({
    period,
    beancountRoot,
    excludeExported: options.excludeExported,
  })
  const snapshot = loadLedgerSnapshot(beancountRoot)
  const directory = path.posix.join(period, 'fintrack')
  const transactionSourceIds = transactionPreflight.exportableIntents.map(intent => intent.sourceId)
  const balanceSourceIds = balancePreflight.exportableCandidates.map(candidate => candidate.sourceId)
  const transactionIntents = transactionPreflight.exportableIntents.filter(intent => intent.kind !== 'confirmed_transfer')
  const transferIntents = transactionPreflight.exportableIntents.filter(intent => intent.kind === 'confirmed_transfer')

  return {
    schemaVersion: 1,
    source: 'fintrack',
    period,
    generatedAt: generatedAt.toISOString(),
    ok: transactionPreflight.ok && balancePreflight.ok,
    beancountRoot,
    ledger: {
      revision: ledgerRevision(snapshot.root, snapshot.files),
      filesScanned: snapshot.files.length,
      openAccounts: snapshot.accounts.size,
      sourceIds: snapshot.sourceIds.size,
      balances: snapshot.balances.length,
    },
    handoff: {
      directory,
      manifestFile: path.posix.join(directory, 'manifest.json'),
      combinedDraftFile: path.posix.join(directory, `${period}.bean`),
      transactionDraftFile: path.posix.join(directory, `${period}-transactions.bean`),
      balanceAssertionDraftFile: path.posix.join(directory, `${period}-balances.bean`),
    },
    counts: {
      transactions: transactionIntents.length,
      transfers: transferIntents.length,
      balanceAssertions: balancePreflight.exportableCandidates.length,
      skipped: transactionPreflight.skipped.length,
      transactionBlockers: transactionPreflight.blockers.length,
      balanceAssertionBlockers: balancePreflight.blockers.length,
      reviewItems: transactionPreflight.reviewItems.length + balancePreflight.reviewItems.length,
      duplicateCandidates: transactionPreflight.duplicateCandidates.length + balancePreflight.duplicateCandidates.length,
    },
    preflight: {
      transactionsOk: transactionPreflight.ok,
      balanceAssertionsOk: balancePreflight.ok,
    },
    sourceIds: uniqueSorted([...transactionSourceIds, ...balanceSourceIds]),
  }
}
