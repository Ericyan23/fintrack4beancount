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
- [x] Keep CSV preview/mapping UI, but route it through ingestion instead of writing directly to `transactions`.
  - Progress: `/import` uses staged CSV import; compatibility `/api/import/transactions` no longer direct-writes canonical transactions and now advertises staged review.
- [x] Keep SimpleFIN account sync, pending handling, and transaction fetch, but split it into adapter/reconciliation/ingestion services.
  - Progress: SimpleFIN now uses adapter, staging, pending reconciliation, and post-import enrichment services; legacy `/api/sync` is retained as a compatibility entry point.
- [x] Keep Review queue and rule creation, but rename the workflow to Staging Review / Ledger Prep.
- [x] Keep transfer matching; export confirmed transfers as merged ledger intents.
- [x] Keep balance assertions as part of the export/preflight workflow.

## Features To Deprioritize

- [x] Move dashboard from primary workflow to Command Center.
- [x] Hide or freeze `/reports` until ingestion/export workflows are stable.
- [x] Stop investing in net worth and spending charts as core product features.
- [x] Keep PWA/manifest as low-maintenance only.
- [x] Reframe `/categories` away from generic category CRUD; focus on ledger accounts, rules, and suggestions.
  - Progress: standalone Categories is hidden from primary navigation; visible UI now frames the retained route as ledger account taxonomy; legacy category route/API names are retained for compatibility.
- [x] Keep AI categorization optional and behind rules/manual review.
  - Progress: AI only runs from explicit buttons/routes and records suggestions for posted, unreviewed, unassigned transactions; rules and manual review remain the authoritative assignment paths.
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

- [x] Define explicit states for raw/staged/canonical records:
  - [x] `raw_imported`
  - [x] `staged`
  - [x] `needs_review`
  - [x] `reviewed`
  - [x] `ignored`
  - [x] `deleted`
  - [x] `export_ready`
  - [x] `exported`
  - [x] `failed`
  - Progress: `lib/ingest/lifecycle.ts` defines the v2 lifecycle state vocabulary and maps legacy raw/staged/canonical persisted statuses into explicit `lifecycleState` values; import run APIs now return lifecycle summaries while preserving old `status` fields for compatibility.
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
  - [x] pending reconciliation
  - [x] transaction ingestion
  - [x] post-import enrichment
  - [x] sync/import logging
- [x] Move net worth snapshot/backfill out of SimpleFIN-specific sync.
- [x] Replace direct `INSERT OR IGNORE INTO transactions` from import paths.
  - Progress: exposed CSV/SimpleFIN import entry points no longer write canonical transactions directly; old direct-write helper modules have been removed.

### Pending Reconciliation

- [x] Stop treating disappeared pending transactions as automatically cancelled.
- [x] Add staged reconciliation states:
  - [x] pending matched to posted
  - [x] expired pending
  - [x] cancelled
  - [x] manual resolve
  - Progress: expired pending rows now produce staged validation errors; review can cancel the canonical pending transaction with `cancelled` audit metadata or keep it pending with `manual_resolve` audit metadata.
- [x] Add review UI for unresolved pending settlement cases.

### Manual Review, Edits, And Ignore

- [x] Add transaction manual-create flow.
  - Progress: `/transactions/new` creates audited manual canonical prep transactions with source provenance, review status, tags, and redirect to the new detail page.
- [x] Add edit flow for:
  - [x] date
  - [x] description
  - [x] amount
  - [x] account
  - [x] ledger account
  - [x] notes
  - [x] tags
  - [x] review status
- [x] Add soft ignore/delete behavior:
  - [x] ignored
  - [x] deleted
  - [x] excluded from export
- [x] Make re-import respect ignored/deleted source items.
- [x] Add edit audit metadata:
  - [x] created_at
  - [x] updated_at
  - [x] updated_by or actor label
  - [x] edit reason if useful
- [x] Add optional edit history table for manual changes.
  - Progress: transaction detail PATCH records actor, optional reason, changed fields, and before/after values in `transaction_edit_history`.

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
- [x] Show split summary in lists and review queues.
  - Progress: transaction/export queries expose split counts; review queue groups and samples show split transaction/posting counts.
- [x] Export split transactions as multi-posting Beancount entries.

### Classification And Review Semantics

- [x] Stop using `transactions.category` for multiple meanings.
  - Progress: rule, AI, review, manual create/edit, and staged promote writes now use dedicated ledger prep fields; legacy `category` values are read/backfilled only for compatibility and exact old mirrors are cleared opportunistically.
- [x] Introduce clearer fields or an enrichment table:
  - [x] `ledger_account`
  - [x] `review_status`
  - [x] `suggested_ledger_account`
  - [x] `classifier`
  - [x] `confidence`
  - [x] `suggested_at`
- [x] Make rules and AI suggestions write enrichment data, not source facts.
  - Progress: rules and AI now write `ledger_account` / `suggested_ledger_account` without mirroring into `category` / `suggested_cat`; promote runs rule-based enrichment for newly promoted posted transactions.
- [x] Preserve current review queue behavior during migration.

### Ledger Intent / Export Candidate Layer

- [x] Introduce `LedgerIntent` or `ExportCandidate` DTO.
- [x] Change Beancount preflight to consume ledger intents instead of querying `transactions` directly.
- [x] Support ledger intents from:
  - [x] normal cash transactions
  - [x] split transactions
  - [x] confirmed transfers
  - [x] balance assertions
- [x] Preserve existing preflight checks and handoff writer.
- [x] Let external Beancount validation or worker remain the final validation step.
  - Progress: Beancount draft downloads and handoff writes now run an external validator (`bean-check` by default) against a temporary file that includes the existing ledger plus the generated draft; failed validation blocks output/export-run creation, while missing optional tooling is recorded as unavailable.

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

- [x] Add `export_runs`:
  - [x] export range
  - [x] generated file names
  - [x] manifest path
  - [x] ledger revision
  - [x] exported source ids
  - [x] export target
  - Progress: Beancount handoff creation writes an `export_runs` row with file manifest details, ledger revision, exported source ids, target, and audit metadata.
- [x] Add “all reviewed not yet exported” export mode.
  - Progress: Export Center can run selected-period exports in not-yet-exported mode, filtering transaction and balance assertion source IDs already recorded in active `export_runs`.
- [x] Add import run detail page:
  - [x] raw/staged item review
  - [x] normalized editable fields
  - [x] errors
  - [x] duplicate/skipped counts
  - [x] replay selected import run
    - Progress: import run detail can create a new review run from stored raw/staged archive without writing canonical transactions.
- [x] Persist mapping profiles:
  - [x] CSV profile
  - [x] source account mapping
  - [x] default ledger account hints
  - Progress: `/import` can save and reload named CSV profiles backed by `import_profiles` / `import_profile_mappings`; profiles restore source name, default account, column mappings, and default ledger account hints, and staged runs retain `import_profile_id`.
- [x] Add complete audit log for:
  - [x] manual edits
    - Progress: transaction detail manual edits write `transaction_edit_history`; staged transaction edits write generic `audit_log` entries with actor, optional reason, field list, before/after values, and source metadata.
  - [x] ignore/unignore
    - Progress: staged ignore/delete/restore writes `staged_ignore`, `staged_delete`, and `staged_restore` audit entries.
  - [x] split create/update/delete
    - Progress: split replace/clear records `split_create`, `split_update`, and `split_delete` rows with actor, optional reason, and before/after split snapshots.
  - [x] rule application
    - Progress: rule-driven reclassification and post-import enrichment write `rule_application` audit entries with before/after classification fields and source provenance metadata.
  - [x] export run creation
    - Progress: successful Beancount handoff writes an `export_run_creation` audit entry linked to the `export_runs` row.
- [x] Merge or rename `/categories` into Ledger Accounts & Rules.
  - Progress: primary navigation is Rules-first, Rules embeds ledger account management, and `/categories` remains a compatibility taxonomy route/API for older links.
- [x] Improve rule management around ledger accounts and review statuses.
  - Progress: rules can be edited in place, API PATCH validates updates, and rule rows show whether the target ledger account auto-reviews or sends transactions to manual review.

## v2.2

Goal: add Fidelity/investment ingestion conservatively after cash-transaction
ingestion is stable.

- [x] Add Fidelity CSV raw import and parser profiles.
  - Progress: Fidelity brokerage CSV is auto-detected or selectable as a parser profile, raw rows are archived, investment activity metadata is extracted into staging payloads, and rows are blocked from cash promotion until investment staging models/export are implemented.
- [x] Add investment staging models as needed:
  - [x] `securities`
  - [x] `investment_activities`
  - [x] `positions`
  - [ ] `lots` only if cost basis support is needed.
- [ ] Support common Fidelity activity types:
  - [x] Buy
  - [x] Sell
  - [x] Dividend
  - [x] Reinvest dividend
  - [x] Interest
  - [x] Fee
  - [x] Cash sweep
  - [x] Transfer
  - [ ] Position or balance assertion
  - Progress: Fidelity activity metadata now records activity type, instrument type, option open/close position effect, option type, expiration, strike, quantity, prices, fees, settlement date, and blocked review status.
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
- [ ] Add external Beancount worker integration for promotion-time validation.
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
