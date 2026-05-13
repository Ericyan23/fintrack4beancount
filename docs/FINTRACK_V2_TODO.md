# FinTrack 2.0 TODO

FinTrack 2.0 should become a self-hosted Beancount ingestion hub: a staging
and review layer between financial data sources and the final Beancount ledger.

## Product Direction

FinTrack is not the source of truth ledger. Beancount remains the final ledger.

FinTrack owns:

- Data source connections and imports.
- Raw import retention for audit and replay.
- Normalization into reviewable financial events.
- Manual edits, ignores, and transaction splits.
- Classification and ledger-account suggestions.
- Export preflight checks.
- Beancount draft download and handoff output.

Primary flow:

```text
SimpleFIN / CSV / Fidelity / future APIs
  -> raw import archive
  -> normalized staging
  -> promote to canonical records
  -> review / edit / split / classify
  -> export candidates
  -> .bean download or handoff
```

## P0: Foundation

- [ ] Add ingestion core tables:
  - [ ] `sources`
  - [ ] `source_connections`
  - [ ] `source_accounts`
  - [ ] `import_runs`
  - [ ] `raw_import_items`
  - [ ] `staged_transactions`
- [ ] Extend canonical `transactions` with provenance fields:
  - [ ] `source_connection_id`
  - [ ] `source_account_id`
  - [ ] `external_id`
  - [ ] `source_item_key`
  - [ ] `import_run_id`
  - [ ] `raw_item_id`
  - [ ] `updated_at`
- [ ] Add uniqueness around `(source_connection_id, source_item_key)` for stable re-import behavior.
- [ ] Define normalized DTOs:
  - [ ] `NormalizedAccount`
  - [ ] `NormalizedTransaction`
  - [ ] `NormalizedBalance`
  - [ ] Future placeholders for `NormalizedSecurity`, `NormalizedPosition`, `NormalizedActivity`.
- [ ] Define pipeline stages:
  - [ ] `SourceAdapter`
  - [ ] `Normalizer`
  - [ ] `Staging`
  - [ ] `Promote`
  - [ ] `Enrich`
  - [ ] `Export`
- [ ] Add golden fixtures before heavy refactors:
  - [ ] SimpleFIN sample payload.
  - [ ] Generic bank CSV.
  - [ ] Fidelity CSV sample.
  - [ ] Duplicate import fixture.
  - [ ] Pending settlement fixture.
  - [ ] Beancount render snapshot.

## P0: Split Existing Import Paths

- [ ] Split `lib/sync/simplefin.ts` into:
  - [ ] SimpleFIN adapter: fetch and normalize only.
  - [ ] Generic transaction ingestion service.
  - [ ] Pending reconciliation service.
  - [ ] Import logging service.
  - [ ] Post-import enrichment trigger.
- [ ] Move net worth snapshot/backfill out of SimpleFIN-specific sync.
- [ ] Convert current CSV import into a generic CSV adapter using the same ingestion service.
- [ ] Ensure SimpleFIN and CSV imports produce comparable import runs and raw item records.

## P1: Manual Review And Editing

- [ ] Add transaction manual-create flow.
- [ ] Add transaction edit flow for:
  - [ ] Date.
  - [ ] Description.
  - [ ] Amount.
  - [ ] Account.
  - [ ] Ledger account/category.
  - [ ] Notes.
  - [ ] Tags.
- [ ] Add soft-delete / ignore behavior instead of physical deletion:
  - [ ] `ignored`
  - [ ] `deleted`
  - [ ] `excluded`
- [ ] Add edit audit metadata:
  - [ ] `created_by`
  - [ ] `updated_by`
  - [ ] `updated_at`
  - [ ] optional edit history table.
- [ ] Make re-import respect ignored/deleted source items.

## P1: Transaction Splits

- [ ] Add `transaction_splits` table:
  - [ ] parent transaction id.
  - [ ] split amount.
  - [ ] ledger account/category.
  - [ ] memo/notes.
  - [ ] ordering.
- [ ] Enforce split sum equals parent transaction amount.
- [ ] Add split editor in transaction detail page.
- [ ] Show split summary in transaction lists and review queues.
- [ ] Update Beancount export to render split postings.
- [ ] Add tests for:
  - [ ] Exact split totals.
  - [ ] Invalid split totals.
  - [ ] Positive and negative transaction splits.
  - [ ] Exported Beancount postings.

## P1: Classification And Review Semantics

- [ ] Stop using one `category` field for too many meanings.
- [ ] Introduce clearer fields or enrichment table:
  - [ ] `ledger_account`
  - [ ] `review_status`
  - [ ] `suggested_ledger_account`
  - [ ] `classifier`
  - [ ] `confidence`
  - [ ] `suggested_at`
- [ ] Keep source/import facts immutable where possible.
- [ ] Make rules and AI suggestions write enrichment data, not overwrite import facts.
- [ ] Keep existing review queue behavior during migration.

## P1: Export Candidate Layer

- [ ] Introduce `ExportCandidate` or `LedgerIntent` DTO.
- [ ] Change Beancount preflight to consume export candidates instead of querying `transactions` directly.
- [ ] Support export candidates from:
  - [ ] normal cash transactions.
  - [ ] split transactions.
  - [ ] confirmed transfers.
  - [ ] balance assertions.
  - [ ] future investment activities.
- [ ] Preserve source_id duplicate checks.
- [ ] Preserve handoff manifest and writer behavior.

## P2: Fidelity And Investments

- [ ] Add Fidelity CSV parser profile.
- [ ] Store original Fidelity rows in `raw_import_items`.
- [ ] Add investment-oriented models as needed:
  - [ ] `securities`
  - [ ] `investment_activities`
  - [ ] `positions`
  - [ ] `lots` if cost basis support is needed.
- [ ] Support common Fidelity activity types:
  - [ ] Buy.
  - [ ] Sell.
  - [ ] Dividend.
  - [ ] Reinvest dividend.
  - [ ] Interest.
  - [ ] Fee.
  - [ ] Cash sweep.
  - [ ] Transfer.
  - [ ] Position or balance assertion.
- [ ] Add investment review UI for unresolved securities, accounts, and activity mappings.
- [ ] Add Beancount investment renderer:
  - [ ] cash postings.
  - [ ] commodity/security postings.
  - [ ] fees.
  - [ ] dividend and interest income.
  - [ ] balance/position assertions.

## P2: Export Center

- [ ] Upgrade Beancount page into Export Center.
- [ ] Support export range choices:
  - [ ] monthly period.
  - [ ] custom start/end date.
  - [ ] all reviewed items not yet exported.
- [ ] Support output targets:
  - [ ] direct `.bean` download.
  - [ ] handoff directory.
  - [ ] future Git/worker integration.
- [ ] Support filenames:
  - [ ] `2026-05.fintrack.bean`
  - [ ] `2025-05_2026-05.fintrack.bean`
- [ ] Show preflight blockers and warnings before export.
- [ ] Record `export_runs` and exported source ids.

## P2: UX Cleanup

- [ ] Reframe UI copy around ingestion and ledger prep, not just tracking.
- [ ] Keep dashboard useful, but avoid making reports the core product.
- [ ] Add source/import status pages:
  - [ ] last run.
  - [ ] errors.
  - [ ] imported/skipped/duplicate counts.
  - [ ] raw item drill-down.
- [ ] Add better account/source mapping workflow.

## Non-Goals For 2.0

- [ ] Do not build multi-user SaaS yet.
- [ ] Do not make FinTrack the final accounting authority.
- [ ] Do not write directly into the Beancount repository from FinTrack.
- [ ] Do not force investment data into the existing cash transaction shape.

## Migration Strategy

- [ ] Keep current `transactions` table working while adding ingestion tables.
- [ ] Backfill provenance for existing SimpleFIN and CSV rows where possible.
- [ ] Treat unknown legacy provenance as `legacy` source.
- [ ] Keep old export behavior until export candidates are ready.
- [ ] Ship each migration idempotently for existing Docker/NAS users.

## First Implementation Slice

Recommended first PR sequence:

1. Add tests and fixtures around current import/export behavior.
2. Add ingestion schema with no UI behavior change.
3. Add generic ingestion service.
4. Move CSV import to ingestion service.
5. Move SimpleFIN sync to adapter plus ingestion service.
6. Add manual edit and soft ignore.
7. Add transaction splits.
8. Convert Beancount export to export candidates.
9. Add Fidelity CSV profile.
