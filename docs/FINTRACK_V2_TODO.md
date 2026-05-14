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

- [x] Keep and strengthen Beancount export/handoff:
  - [x] ledger scan
  - [x] open/closed account checks
  - [x] source_id duplicate checks
  - [x] preflight
  - [x] `.bean` rendering
  - [x] handoff manifest and writer
- [x] Keep account-to-Beancount-account mapping, but reframe it as Source Account -> Beancount Account Mapping.
- [ ] Keep CSV preview/mapping UI, but route it through ingestion instead of writing directly to `transactions`.
  - Progress: staged CSV import path exists; legacy direct import API remains for compatibility and still needs retirement.
- [ ] Keep SimpleFIN account sync, pending handling, and transaction fetch, but split it into adapter/reconciliation/ingestion services.
  - Progress: adapter and staging path exist; legacy `/api/sync` is retained during migration.
- [x] Keep Review queue and rule creation, but rename the workflow to Staging Review / Ledger Prep.
- [x] Keep transfer matching; export confirmed transfers as merged ledger intents.
- [x] Keep balance assertions as part of the export/preflight workflow.

## Features To Deprioritize

- [x] Move dashboard from primary workflow to Command Center.
- [x] Hide or freeze `/reports` until ingestion/export workflows are stable.
- [x] Stop investing in net worth and spending charts as core product features.
- [x] Keep PWA/manifest as low-maintenance only.
- [ ] Reframe `/categories` away from generic category CRUD; focus on ledger accounts, rules, and suggestions.
  - Progress: standalone Categories is hidden from primary navigation; route/API are still retained.
- [ ] Keep AI categorization optional and behind rules/manual review.
- [x] Do not build a Fava-like ledger viewer.

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

- [x] Reports.
- [x] Standalone Categories.
- [x] Net worth views and CSV export.
- [x] Spending charts.
- [x] Account balance dashboard sections.
- [x] PWA install-oriented surfaces.

### Do Not Delete Yet

These are tied to Beancount preparation or migration compatibility:

- [x] `accounts` and `accounts.beancount_account`.
- [x] `transactions`.
- [x] `transactions.category`, `status`, `suggested_cat` until ledger-account migration exists.
- [x] `categories`.
- [x] `rules`.
- [x] `transfer_matches`.
- [x] `balance_assertions`.
- [x] `settings`.
- [x] `sync_log`.
- [x] `net_worth_snapshots` until existing exports/backups and migrations are handled.

Keep these APIs during v2 migration:

- [x] `/api/sync`.
- [x] `/api/import/transactions*`.
- [x] `/api/accounts*`.
- [x] `/api/beancount/accounts`.
- [x] `/api/transactions*`.
- [x] `/api/review`.
- [x] `/api/rules*`.
- [x] `/api/transfers*`.
- [x] `/api/beancount/balance-assertions`.
- [x] `/api/export/beancount/*`.
- [x] `/api/export/backup`.

Freeze these APIs:

- [x] `/api/reports`.
- [x] `/api/networth*`.
- [x] `/api/export/networth`.

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

- [x] Add a test script and test runner.
- [x] Add golden fixtures:
  - [x] SimpleFIN sample payload.
  - [x] Generic bank CSV.
  - [x] Duplicate import.
  - [ ] Pending-to-posted settlement.
  - [x] Ignored/deleted re-import behavior.
  - [x] Split transaction Beancount render.
  - [x] Beancount preflight/render snapshot.
- [x] Keep Fidelity fixtures limited to fake, non-blocking parser research samples until cash ingestion/export is stable.

### Ingestion Schema

- [x] Add ingestion tables:
  - [x] `sources`
  - [x] `source_connections`
  - [x] `source_accounts`
  - [x] `import_runs`
  - [x] `raw_import_items`
  - [x] `staged_transactions`
- [x] Add parser profile tables:
  - [x] `import_profiles`
  - [x] `import_profile_mappings`
- [x] Extend canonical `transactions` with provenance:
  - [x] `source_connection_id`
  - [x] `source_account_id`
  - [x] `external_id`
  - [x] `source_item_key`
  - [x] `import_run_id`
  - [x] `raw_item_id`
  - [x] `normalizer_version`
  - [x] `updated_at`
- [x] Add uniqueness around `(source_connection_id, source_item_key)`.
- [x] Backfill existing rows into a `legacy` source where provenance is unknown.

### State Machine

- [ ] Define explicit states for raw/staged/canonical records:
  - [ ] `raw_imported`
  - [x] `staged`
  - [ ] `needs_review`
  - [ ] `reviewed`
  - [x] `ignored`
  - [x] `deleted`
  - [ ] `export_ready`
  - [ ] `exported`
  - [ ] `failed`
  - Progress: current implementation has raw `pending/staged/ignored/error`, staged `staged/ready/merged/ignored/deleted/error`, and import run `pending/running/completed/failed`; final naming still needs consolidation.
- [x] Define immutable source facts:
  - [x] raw payload
  - [x] payload hash
  - [x] source item key
  - [x] source account identity
- [x] Define editable user fields separately from raw facts.

### Money And Identity

- [x] Store money as decimal strings or integer minor units; do not rely on JS `number` for ledger-critical values.
- [x] Keep display formatting separate from storage.
- [x] Define stable `source_item_key` rules:
  - [x] prefer provider external id in source-account namespace.
  - [x] fallback to deterministic hash of source account, date, amount, description, and raw payload.
  - [x] include normalizer version where needed.
- [x] Ensure source_id used by Beancount export comes from provenance and does not change when the user edits description or category.

### Import Pipeline

- [x] Define normalized DTOs:
  - [x] `NormalizedAccount`
  - [x] `NormalizedTransaction`
  - [x] `NormalizedBalance`
- [x] Define pipeline interfaces:
  - [x] `SourceAdapter`
  - [x] `Normalizer`
  - [x] `Staging`
  - [x] `Promote`
  - [x] `Enrich`
  - [x] `Export`
- [x] Move generic CSV import to the ingestion service first.
  - Progress: staged CSV import uses ingestion; compatibility `/api/import/transactions` now stages and returns legacy count fields.
- [x] Then move SimpleFIN sync to the ingestion service.
  - Progress: SimpleFIN staging uses ingestion; compatibility `/api/sync` and scheduler now stage through the shared ingestion helper.
- [x] Retire direct-write `lib/sync/simplefin.ts` by splitting replacement work into:
  - [x] adapter fetch
  - [x] account normalization
  - [ ] pending reconciliation
  - [x] transaction ingestion
  - [ ] post-import enrichment
  - [x] sync/import logging
- [x] Move net worth snapshot/backfill out of SimpleFIN-specific sync.
- [x] Replace direct `INSERT OR IGNORE INTO transactions` from import paths.
  - Progress: exposed CSV/SimpleFIN import entry points no longer write canonical transactions directly; old direct-write helper modules have been removed.

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
  - [x] date
  - [x] description
  - [x] amount
  - [x] account
  - [ ] ledger account
  - [x] notes
  - [x] tags
  - [x] review status
- [x] Add soft ignore/delete behavior:
  - [x] ignored
  - [x] deleted
  - [x] excluded from export
- [x] Make re-import respect ignored/deleted source items.
- [ ] Add edit audit metadata:
  - [x] created_at
  - [x] updated_at
  - [ ] updated_by or actor label
  - [ ] edit reason if useful
- [ ] Add optional edit history table for manual changes.

### Transaction Splits

- [x] Add `transaction_splits` table:
  - [x] parent transaction id
  - [x] amount
  - [x] currency
  - [x] ledger account
  - [x] memo
  - [x] notes
  - [x] ordering
  - [x] created_at
  - [x] updated_at
  - [x] split trace fields (`split_group_id`, `created_from`)
- [x] Treat splits as ledger postings, not as separate source transactions.
- [x] Enforce split sum equals parent transaction amount.
- [x] Add split editor in transaction detail page.
- [ ] Show split summary in lists and review queues.
  - Progress: transaction/export queries expose split counts; review queue display still needs confirmation.
- [x] Export split transactions as multi-posting Beancount entries.

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

- [x] Introduce `LedgerIntent` or `ExportCandidate` DTO.
- [x] Change Beancount preflight to consume ledger intents instead of querying `transactions` directly.
- [x] Support ledger intents from:
  - [x] normal cash transactions
  - [x] split transactions
  - [x] confirmed transfers
  - [x] balance assertions
- [x] Preserve existing preflight checks and handoff writer.
- [ ] Let external Beancount validation or worker remain the final validation step.

### v2.0 Page Changes

- [x] `/` -> Command Center:
  - [x] import health
  - [x] review count
  - [x] export readiness
  - [x] recent blockers
- [x] `/import` -> Sources / Import:
  - [x] source connections
  - [x] import runs
  - [x] CSV upload/profile
- [x] `/review` -> Staging Review / Ledger Prep.
- [x] `/accounts` -> Accounts & Ledger Mapping.
- [x] `/beancount` -> Export Center.
- [x] Keep `/transactions` as a preparation work queue, not a ledger viewer.
- [x] Hide or move `/reports` to diagnostics/legacy navigation.

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
  - [x] raw/staged item review
  - [x] normalized editable fields
  - [x] errors
  - [x] duplicate/skipped counts
  - [ ] replay selected import run
- [ ] Persist mapping profiles:
  - [ ] CSV profile
  - [x] source account mapping
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
  - Progress: fake brokerage CSV parser sample exists; investment ingestion models and export are not started.
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
