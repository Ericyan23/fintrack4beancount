export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { sqlite } from '@/lib/db'
import { REVIEW_CATEGORY_NAMES } from '@/lib/classify/defaults'

// ── Data types ────────────────────────────────────────────────────────────────

interface RunRow {
  id: string
  status: string
  itemCount: number
  startedAt: number | null
  error: string | null
  connectionName: string | null
  sourceKind: string | null
  eligibleCount: number
  errorCount: number
  mergedCount: number
}

interface StagedCount {
  status: string
  count: number
}

interface ScalarRow {
  count: number
}

// ── Queries ───────────────────────────────────────────────────────────────────

function loadRecentRuns(): RunRow[] {
  return sqlite.prepare(`
    SELECT
      ir.id,
      ir.status,
      ir.item_count                                                       AS itemCount,
      ir.started_at                                                       AS startedAt,
      ir.error,
      sc.name                                                             AS connectionName,
      s.kind                                                              AS sourceKind,
      COALESCE(SUM(CASE WHEN st.status IN ('staged','ready') THEN 1 ELSE 0 END), 0) AS eligibleCount,
      COALESCE(SUM(CASE WHEN st.status = 'error'            THEN 1 ELSE 0 END), 0) AS errorCount,
      COALESCE(SUM(CASE WHEN st.status = 'merged'           THEN 1 ELSE 0 END), 0) AS mergedCount
    FROM import_runs ir
    LEFT JOIN source_connections sc ON sc.id = ir.source_connection_id
    LEFT JOIN sources s             ON s.id  = sc.source_id
    LEFT JOIN staged_transactions st ON st.import_run_id = ir.id
    GROUP BY ir.id
    ORDER BY ir.created_at DESC
    LIMIT 8
  `).all() as RunRow[]
}

function loadStagedCounts(): Map<string, number> {
  const rows = sqlite.prepare(`
    SELECT status, COUNT(*) AS count
    FROM staged_transactions
    WHERE status IN ('staged', 'ready', 'error')
    GROUP BY status
  `).all() as StagedCount[]

  return new Map(rows.map(r => [r.status, r.count]))
}

function countUnmappedSourceAccounts(): number {
  const row = sqlite.prepare(`
    SELECT COUNT(*) AS count FROM source_accounts WHERE fintrack_account_id IS NULL
  `).get() as ScalarRow
  return row.count
}

function countReviewTransactions(): number {
  const placeholders = REVIEW_CATEGORY_NAMES.map(() => '?').join(', ')
  const row = sqlite.prepare(`
    SELECT COUNT(*) AS count
    FROM transactions
    WHERE status = 'posted'
      AND (
        ledger_account IS NULL
        OR review_status = 'needs_review'
        OR (
          review_status IS NULL
          AND (category IS NULL OR category IN (${placeholders}))
        )
      )
  `).get(...REVIEW_CATEGORY_NAMES) as ScalarRow
  return row.count
}

function countCanonical(): { total: number; categorized: number; pending: number } {
  const row = sqlite.prepare(`
    SELECT
      COUNT(*)                                               AS total,
      SUM(CASE WHEN status = 'pending'                THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'posted' AND ledger_account IS NOT NULL THEN 1 ELSE 0 END) AS categorized
    FROM transactions
  `).get() as { total: number; categorized: number; pending: number }
  return row
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(ts: number | null): string {
  if (!ts) return '—'
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function sourceLabel(kind: string | null, name: string | null): string {
  if (name) return name
  if (kind === 'simplefin') return 'SimpleFIN'
  if (kind === 'csv') return 'CSV'
  return kind ?? 'Unknown'
}

function runStatusClass(status: string): string {
  if (status === 'completed') return 'border-emerald-800 bg-emerald-900/30 text-emerald-200'
  if (status === 'running') return 'border-blue-800 bg-blue-900/30 text-blue-200'
  if (status === 'error') return 'border-red-800 bg-red-900/30 text-red-200'
  return 'border-slate-700 bg-slate-800 text-slate-400'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PipelineCard({
  title,
  metric,
  metricClass,
  sub,
  href,
  cta,
  warn,
}: {
  title: string
  metric: string
  metricClass?: string
  sub: string
  href: string
  cta: string
  warn?: boolean
}) {
  return (
    <div className={`flex flex-col justify-between rounded-xl border p-4 ${
      warn ? 'border-amber-800 bg-amber-950/20' : 'border-slate-700 bg-slate-800'
    }`}>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
        <p className={`mt-2 text-3xl font-bold tabular-nums ${metricClass ?? 'text-slate-100'}`}>
          {metric}
        </p>
        <p className="mt-1 text-xs text-slate-400">{sub}</p>
      </div>
      <Link
        href={href}
        className="mt-4 self-start text-xs font-medium text-blue-400 hover:text-blue-300"
      >
        {cta} →
      </Link>
    </div>
  )
}

function RunRow({ run }: { run: RunRow }) {
  const hasWork = run.eligibleCount > 0 || run.errorCount > 0
  const label = sourceLabel(run.sourceKind, run.connectionName)

  return (
    <Link
      href={`/import/runs/${encodeURIComponent(run.id)}`}
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 hover:bg-slate-700/40 transition-colors"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-200 truncate">{label}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${runStatusClass(run.status)}`}>
            {run.status}
          </span>
          {run.error && (
            <span className="text-[11px] text-red-300 truncate max-w-[200px]">{run.error}</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
          <span>{run.itemCount} items</span>
          {run.eligibleCount > 0 && (
            <span className="text-amber-300">{run.eligibleCount} eligible to promote</span>
          )}
          {run.errorCount > 0 && (
            <span className="text-red-400">{run.errorCount} staging errors</span>
          )}
          {run.mergedCount > 0 && <span>{run.mergedCount} merged</span>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs text-slate-500">{timeAgo(run.startedAt)}</p>
        {hasWork && (
          <p className="mt-1 text-[11px] font-medium text-amber-300">Review</p>
        )}
      </div>
    </Link>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CommandCenter() {
  const recentRuns = loadRecentRuns()
  const stagedCounts = loadStagedCounts()
  const unmapped = countUnmappedSourceAccounts()
  const reviewCount = countReviewTransactions()
  const canonical = countCanonical()

  const stagedEligible = (stagedCounts.get('staged') ?? 0) + (stagedCounts.get('ready') ?? 0)
  const stagedErrors = stagedCounts.get('error') ?? 0
  const activeRuns = recentRuns.filter(r => r.eligibleCount > 0 || r.errorCount > 0)
  const hasBlockers = unmapped > 0 || stagedErrors > 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Command Center</h1>
        <p className="mt-1 text-sm text-slate-500">
          Beancount preparation pipeline status.
        </p>
      </div>

      {/* ── 3 pipeline cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <PipelineCard
          title="Import"
          metric={String(recentRuns.length > 0 ? recentRuns.length : '—')}
          metricClass={activeRuns.length > 0 ? 'text-amber-300' : 'text-slate-100'}
          sub={
            recentRuns.length > 0
              ? `Last: ${timeAgo(recentRuns[0]?.startedAt ?? null)}${activeRuns.length > 0 ? ` · ${activeRuns.length} run${activeRuns.length !== 1 ? 's' : ''} need review` : ''}`
              : 'No import runs yet'
          }
          href="/import"
          cta="Open Import"
          warn={activeRuns.length > 0}
        />
        <PipelineCard
          title="Ledger Prep"
          metric={reviewCount > 0 ? String(reviewCount) : stagedEligible > 0 ? String(stagedEligible) : '✓'}
          metricClass={reviewCount > 0 ? 'text-amber-300' : stagedEligible > 0 ? 'text-blue-300' : 'text-emerald-300'}
          sub={
            reviewCount > 0
              ? `${reviewCount} transaction${reviewCount !== 1 ? 's' : ''} need ledger account${stagedEligible > 0 ? ` · ${stagedEligible} staged rows ready to promote` : ''}`
              : stagedEligible > 0
                ? `${stagedEligible} staged rows ready to promote`
                : 'No review items'
          }
          href="/review"
          cta="Open Ledger Prep"
          warn={reviewCount > 0}
        />
        <PipelineCard
          title="Canonical Transactions"
          metric={String(canonical.total)}
          metricClass="text-slate-100"
          sub={`${canonical.categorized} categorized · ${canonical.pending} pending · ${reviewCount} need prep`}
          href="/beancount"
          cta="Open Export Center"
        />
      </div>

      {/* ── Blockers ─────────────────────────────────────────────────────── */}
      {hasBlockers && (
        <section className="rounded-xl border border-amber-800 bg-amber-950/20 p-4">
          <h2 className="text-sm font-semibold text-amber-200">Active blockers</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {unmapped > 0 && (
              <li className="flex items-center justify-between gap-3">
                <span className="text-slate-300">
                  {unmapped} source account{unmapped !== 1 ? 's' : ''} not mapped to a Fintrack account
                </span>
                <Link href="/accounts" className="shrink-0 text-xs text-blue-400 hover:text-blue-300">
                  Account Mapping →
                </Link>
              </li>
            )}
            {stagedErrors > 0 && (
              <li className="flex items-center justify-between gap-3">
                <span className="text-slate-300">
                  {stagedErrors} staged row{stagedErrors !== 1 ? 's' : ''} have validation errors
                </span>
                {activeRuns[0] && (
                  <Link
                    href={`/import/runs/${encodeURIComponent(activeRuns[0].id)}`}
                    className="shrink-0 text-xs text-blue-400 hover:text-blue-300"
                  >
                    Review run →
                  </Link>
                )}
              </li>
            )}
          </ul>
        </section>
      )}

      {/* ── Active import runs (need attention) ──────────────────────────── */}
      {activeRuns.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
          <div className="border-b border-slate-700 px-4 py-3">
            <h2 className="text-sm font-medium text-slate-300">Import runs needing attention</h2>
          </div>
          <div className="divide-y divide-slate-700">
            {activeRuns.map(run => (
              <RunRow key={run.id} run={run} />
            ))}
          </div>
        </section>
      )}

      {/* ── Recent import history ─────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
          <h2 className="text-sm font-medium text-slate-300">Recent import history</h2>
          <Link href="/import" className="text-xs text-blue-400 hover:text-blue-300">
            New import →
          </Link>
        </div>
        {recentRuns.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">
            No import runs yet.{' '}
            <Link href="/import" className="text-blue-400 hover:text-blue-300">
              Start an import
            </Link>{' '}
            to begin Beancount preparation.
          </div>
        ) : (
          <div className="divide-y divide-slate-700">
            {recentRuns
              .filter(r => r.eligibleCount === 0 && r.errorCount === 0)
              .map(run => (
                <RunRow key={run.id} run={run} />
              ))}
            {recentRuns.filter(r => r.eligibleCount === 0 && r.errorCount === 0).length === 0 && (
              <p className="px-4 py-4 text-sm text-slate-500">All recent runs need attention — see above.</p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
