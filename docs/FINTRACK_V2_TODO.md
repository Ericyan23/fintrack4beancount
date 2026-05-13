# FinTrack 2.0 TODO

FinTrack 2.0 is a self-hosted Beancount ingestion and preparation hub.

It should not become a Fava replacement or a general personal-finance dashboard.
Beancount remains the final source of truth. FinTrack prepares data before it
enters the ledger.

## Product Boundary

FinTrack owns:

- Source connections and imports.
- Raw import retention for audit and replay.
- Staging and normalization.
- Manual review, edits, ignores, and transaction splits.
- Ledger account suggestions and rules.
- Transfer matching.
- Export preflight.
- Beancount draft download and handoff output.

FinTrack does not own:

- Final ledger truth.
- Long-term financial reporting.
- Fava-style ledger browsing.
- Direct writes into the Beancount repository.
- Multi-user SaaS behavior.

Primary flow:

```text
SimpleFIN / CSV / future APIs
  -> raw import archive
  -> normalized staging
  -> review / edit / split / classify
  -> ledger intents
  -> preflight
  -> .bean download or handoff
```

## Core Assets To Keep

- [ ] Keep and strengthen Beancount export/handoff:
  - [ ] ledger scan
  - [ ] open/closed account checks
  - [ ] source_id duplicate checks
  - [ ] preflight
  - [ ] `.bean` rendering
  - [ ] handoff manifest and writer
- [ ] Keep account-to-Beancount-account mapping, but reframe it as Source Account -> Beancount Account Mapping.
- [ ] Keep CSV preview/mapping UI, but route it through ingestion instead of writing directly to `transactions`.
- [ ] Keep SimpleFIN account sync, pending handling, and transaction fetch, but split it into adapter/reconciliation/ingestion services.
- [ ] Keep Review queue and rule creation, but rename the workflow to Staging Review / Ledger Prep.
- [ ] Keep transfer matching; export confirmed transfers as merged ledger intents.
- [ ] Keep balance assertions as part of the export/preflight workflow.

## Features To Deprioritize

- [ ] Move dashboard from primary workflow to Command Center.
- [ ] Hide or freeze `/reports` until ingestion/export workflows are stable.
- [ ] Stop investing in net worth and spending charts as core product features.
- [ ] Keep PWA/manifest as low-maintenance only.
- [ ] Reframe `/categories` away from generic category CRUD; focus on ledger accounts, rules, and suggestions.
- [ ] Keep AI categorization optional and behind rules/manual review.
- [ ] Do not build a Fava-like ledger viewer.

## Existing Feature Disposition

Use this as the cleanup rule: first rename and hide from primary navigation,
then freeze, then remove only after the new prep workflow is stable.

| Area | Decision | v2 Role |
| --- | --- | --- |
| `/beancount` | Keep + rename | Export Center. Core Beancount preflight, draft download, handoff, balance assertions. |
| `/review` | Keep + rename | Staging Review / Ledger Prep. Core cleaning and rule workflow. |
| `/transactions` | Keep + rename | Staged Transactions / Prep Queue. Work queue, not ledger viewer. |
| `/transactions/[id]` | Keep + expand | Manual edit, ignore/delete, split editor. |
| `/transfers` | Keep + rename | Transfer Review. Confirmed transfers feed merged ledger intents. |
| `/accounts` | Keep + rename | Source Account Mapping. Mapping first, balances secondary. |
| `/import` | Keep + rename | Sources / Import. CSV profile and import-run entry point. |
| SimpleFIN sync | Keep + split | Source adapter plus generic ingestion/reconciliation. |
| `/rules` | Keep + rename | Ledger Account Rules. Rules first, AI suggestions optional. |
| `/categories` | Hide standalone | Keep tables/API for compatibility; fold UI into ledger accounts/rules. |
| `/reports` | Hide + freeze | Diagnostics/legacy only. Do not expand cashflow/spending reports. |
| Home dashboard | Rename + rebuild | Command Center with import health, review counts, export readiness, blockers. |
| Net worth | Hide + freeze | Compatibility only; later stop sync side effect and remove from UI. |
| Charts/Recharts | Freeze -> later delete | Not core to Beancount prep. |
| PWA/service worker | Freeze | Keep low-maintenance only; not a v2 investment area. |
| AI categorization | Later/optional | Suggestion helper after manual/rule workflow is reliable. |

### Safe To Remove From Primary Navigation

- [ ] Reports.
- [ ] Standalone Categories.
- [ ] Net worth views and CSV export.
- [ ] Spending charts.
- [ ] Account balance dashboard sections.
- [ ] PWA install-oriented surfaces.

### Do Not Delete Yet

These are tied to Beancount preparation or migration compatibility:

- [ ] `accounts` and `accounts.beancount_account`.
- [ ] `transactions`.
- [ ] `transactions.category`, `status`, `suggested_cat` until ledger-account migration exists.
- [ ] `categories`.
- [ ] `rules`.
- [ ] `transfer_matches`.
- [ ] `balance_assertions`.
- [ ] `settings`.
- [ ] `sync_log`.
- [ ] `net_worth_snapshots` until existing exports/backups and migrations are handled.

Keep these APIs during v2 migration:

- [ ] `/api/sync`.
- [ ] `/api/import/transactions*`.
- [ ] `/api/accounts*`.
- [ ] `/api/beancount/accounts`.
- [ ] `/api/transactions*`.
- [ ] `/api/review`.
- [ ] `/api/rules*`.
- [ ] `/api/transfers*`.
- [ ] `/api/beancount/balance-assertions`.
- [ ] `/api/export/beancount/*`.
- [ ] `/api/export/backup`.

Freeze these APIs:

- [ ] `/api/reports`.
- [ ] `/api/networth*`.
- [ ] `/api/export/networth`.

### Low-Risk Cleanup Order

1. Rename navigation and page headings:
   - Home -> Command Center.
   - Ledger -> Export Center.
   - Review -> Ledger Prep.
   - Accounts -> Account Mapping.
   - Transfers -> Transfer Review.
2. Hide Reports and standalone Categories from primary navigation.
3. Rebuild Home into readiness/status view without schema changes.
4. Move account mapping to the top of Accounts; collapse balance cards into diagnostics.
5. Freeze Reports in diagnostics/legacy; keep code and API temporarily.
6. Hide net worth and spending charts from primary UI.
7. Stop net worth sync side effects only after ingestion pipeline is stable.
8. Fold Categories into Ledger Accounts & Rules after `ledger_account` migration.
9. Remove chart dependencies, reports code, and PWA service worker only after no routes depend on them.

## v2.0 MVP

Goal: make FinTrack a reliable, replayable cash-transaction ingestion and
Beancount preparation system for SimpleFIN and generic CSV.

### Tests And Fixtures

- [ ] Add a test script and test runner.
- [ ] Add golden fixtures:
  - [ ] SimpleFIN sample payload.
  - [ ] Generic bank CSV.
  - [ ] Duplicate import.
  - [ ] Pending-to-posted settlement.
  - [ ] Ignored/deleted re-import behavior.
  - [ ] Split transaction Beancount render.
  - [ ] Beancount preflight/render snapshot.
- [ ] Keep Fidelity fixtures out of v2.0 unless they are used only as non-blocking research samples.

### Ingestion Schema

- [ ] Add ingestion tables:
  - [ ] `sources`
  - [ ] `source_connections`
  - [ ] `source_accounts`
  - [ ] `import_runs`
  - [ ] `raw_import_items`
  - [ ] `staged_transactions`
- [ ] Add parser profile tables:
  - [ ] `import_profiles`
  - [ ] `import_profile_mappings`
- [ ] Extend canonical `transactions` with provenance:
  - [ ] `source_connection_id`
  - [ ] `source_account_id`
  - [ ] `external_id`
  - [ ] `source_item_key`
  - [ ] `import_run_id`
  - [ ] `raw_item_id`
  - [ ] `normalizer_version`
  - [ ] `updated_at`
- [ ] Add uniqueness around `(source_connection_id, source_item_key)`.
- [ ] Backfill existing rows into a `legacy` source where provenance is unknown.

### State Machine

- [ ] Define explicit states for raw/staged/canonical records:
  - [ ] `raw_imported`
  - [ ] `staged`
  - [ ] `needs_review`
  - [ ] `reviewed`
  - [ ] `ignored`
  - [ ] `deleted`
  - [ ] `export_ready`
  - [ ] `exported`
  - [ ] `failed`
- [ ] Define immutable source facts:
  - [ ] raw payload
  - [ ] payload hash
  - [ ] source item key
  - [ ] source account identity
- [ ] Define editable user fields separately from raw facts.

### Money And Identity

- [ ] Store money as decimal strings or integer minor units; do not rely on JS `number` for ledger-critical values.
- [ ] Keep display formatting separate from storage.
- [ ] Define stable `source_item_key` rules:
  - [ ] prefer provider external id in source-account namespace.
  - [ ] fallback to deterministic hash of source account, date, amount, description, and raw payload.
  - [ ] include normalizer version where needed.
- [ ] Ensure source_id used by Beancount export comes from provenance and does not change when the user edits description or category.

### Import Pipeline

- [ ] Define normalized DTOs:
  - [ ] `NormalizedAccount`
  - [ ] `NormalizedTransaction`
  - [ ] `NormalizedBalance`
- [ ] Define pipeline interfaces:
  - [ ] `SourceAdapter`
  - [ ] `Normalizer`
  - [ ] `Staging`
  - [ ] `Promote`
  - [ ] `Enrich`
  - [ ] `Export`
- [ ] Move generic CSV import to the ingestion service first.
- [ ] Then move SimpleFIN sync to the ingestion service.
- [ ] Split `lib/sync/simplefin.ts` into:
  - [ ] adapter fetch
  - [ ] account normalization
  - [ ] pending reconciliation
  - [ ] transaction ingestion
  - [ ] post-import enrichment
  - [ ] sync/import logging
- [ ] Move net worth snapshot/backfill out of SimpleFIN-specific sync.
- [ ] Replace direct `INSERT OR IGNORE INTO transactions` from import paths.

### Pending Reconciliation

- [ ] Stop treating disappeared pending transactions as automatically cancelled.
- [ ] Add staged reconciliation states:
  - [ ] pending matched to posted
  - [ ] expired pending
  - [ ] cancelled
  - [ ] manual resolve
- [ ] Add review UI for unresolved pending settlement cases.

### Manual Review, Edits, And Ignore

- [ ] Add transaction manual-create flow.
- [ ] Add edit flow for:
  - [ ] date
  - [ ] description
  - [ ] amount
  - [ ] account
  - [ ] ledger account
  - [ ] notes
  - [ ] tags
  - [ ] review status
- [ ] Add soft ignore/delete behavior:
  - [ ] ignored
  - [ ] deleted
  - [ ] excluded from export
- [ ] Make re-import respect ignored/deleted source items.
- [ ] Add edit audit metadata:
  - [ ] created_at
  - [ ] updated_at
  - [ ] updated_by or actor label
  - [ ] edit reason if useful
- [ ] Add optional edit history table for manual changes.

### Transaction Splits

- [ ] Add `transaction_splits` table:
  - [ ] parent transaction id
  - [ ] amount
  - [ ] currency
  - [ ] ledger account
  - [ ] memo
  - [ ] notes
  - [ ] ordering
  - [ ] created_at
  - [ ] updated_at
- [ ] Treat splits as ledger postings, not as separate source transactions.
- [ ] Enforce split sum equals parent transaction amount.
- [ ] Add split editor in transaction detail page.
- [ ] Show split summary in lists and review queues.
- [ ] Export split transactions as multi-posting Beancount entries.

### Classification And Review Semantics

- [ ] Stop using `transactions.category` for multiple meanings.
- [ ] Introduce clearer fields or an enrichment table:
  - [ ] `ledger_account`
  - [ ] `review_status`
  - [ ] `suggested_ledger_account`
  - [ ] `classifier`
  - [ ] `confidence`
  - [ ] `suggested_at`
- [ ] Make rules and AI suggestions write enrichment data, not source facts.
- [ ] Preserve current review queue behavior during migration.

### Ledger Intent / Export Candidate Layer

- [ ] Introduce `LedgerIntent` or `ExportCandidate` DTO.
- [ ] Change Beancount preflight to consume ledger intents instead of querying `transactions` directly.
- [ ] Support ledger intents from:
  - [ ] normal cash transactions
  - [ ] split transactions
  - [ ] confirmed transfers
  - [ ] balance assertions
- [ ] Preserve existing preflight checks and handoff writer.
- [ ] Let external Beancount validation or worker remain the final validation step.

### v2.0 Page Changes

- [ ] `/` -> Command Center:
  - [ ] import health
  - [ ] review count
  - [ ] export readiness
  - [ ] recent blockers
- [ ] `/import` -> Sources / Import:
  - [ ] source connections
  - [ ] import runs
  - [ ] CSV upload/profile
- [ ] `/review` -> Staging Review / Ledger Prep.
- [ ] `/accounts` -> Accounts & Ledger Mapping.
- [ ] `/beancount` -> Export Center.
- [ ] Keep `/transactions` as a preparation work queue, not a ledger viewer.
- [ ] Hide or move `/reports` to diagnostics/legacy navigation.

## v2.1

Goal: make repeated operation reliable and auditable.

- [ ] Add `export_runs`:
  - [ ] export range
  - [ ] generated file names
  - [ ] manifest path
  - [ ] ledger revision
  - [ ] exported source ids
  - [ ] export target
- [ ] Add “all reviewed not yet exported” export mode.
- [ ] Add import run detail page:
  - [ ] raw items
  - [ ] normalized items
  - [ ] errors
  - [ ] duplicate/skipped counts
  - [ ] replay selected import run
- [ ] Persist mapping profiles:
  - [ ] CSV profile
  - [ ] source account mapping
  - [ ] default ledger account hints
- [ ] Add complete audit log for:
  - [ ] manual edits
  - [ ] ignore/unignore
  - [ ] split create/update/delete
  - [ ] rule application
  - [ ] export run creation
- [ ] Merge or rename `/categories` into Ledger Accounts & Rules.
- [ ] Improve rule management around ledger accounts and review statuses.

## v2.2

Goal: add Fidelity/investment ingestion conservatively after cash-transaction
ingestion is stable.

- [ ] Add Fidelity CSV raw import and parser profiles.
- [ ] Add investment staging models as needed:
  - [ ] `securities`
  - [ ] `investment_activities`
  - [ ] `positions`
  - [ ] `lots` only if cost basis support is needed.
- [ ] Support common Fidelity activity types:
  - [ ] Buy
  - [ ] Sell
  - [ ] Dividend
  - [ ] Reinvest dividend
  - [ ] Interest
  - [ ] Fee
  - [ ] Cash sweep
  - [ ] Transfer
  - [ ] Position or balance assertion
- [ ] Add security mapping UI.
- [ ] Add investment activity review UI.
- [ ] Add Beancount investment renderer:
  - [ ] cash postings
  - [ ] commodity/security postings
  - [ ] fees
  - [ ] dividend and interest income
  - [ ] balance/position assertions
- [ ] Be conservative with complex lots, DRIP, transfer-in-kind, and cost basis:
  - [ ] block export when uncertain.
  - [ ] require review.
  - [ ] preserve raw rows for manual ledger work.

## Long-Term Optional

- [ ] Restore reports only as secondary diagnostics if they help the prep workflow.
- [ ] Add external Beancount worker integration for final validation.
- [ ] Add Git PR/export target only after download and handoff are stable.
- [ ] Add AI categorization improvements after manual/rule workflows are reliable.

## Non-Goals

- [ ] Multi-user SaaS.
- [ ] Public internet deployment assumptions.
- [ ] Direct writes into the Beancount repository.
- [ ] Fava replacement.
- [ ] Full investment tax accounting in v2.0.
- [ ] Making reports and net worth the main product.

## Recommended PR Sequence

1. Add tests and fixtures around current import/export behavior.
2. Add ingestion schema and provenance fields without changing UI behavior.
3. Add generic ingestion service.
4. Move CSV import to ingestion service.
5. Move SimpleFIN sync to adapter plus ingestion service.
6. Add source/import status pages.
7. Add manual edit and soft ignore.
8. Add transaction splits.
9. Introduce LedgerIntent / ExportCandidate and migrate Beancount preflight.
10. Add export runs and “reviewed not yet exported” export.
11. Reframe navigation and page names around prep workflow.
12. Add Fidelity CSV support after cash ingestion/export is stable.
