# FinTrack User Manual

This manual describes the current FinTrack V2 workflow. The UI is Chinese-first; this English manual keeps the Chinese page names so they match the app.

FinTrack is a private Beancount ingestion and preparation tool. It is not a bank, broker, tax tool, accounting authority, investment performance system, or Fava replacement. Review imported data before using it for decisions.

## 1. Login And Privacy

Open the app in your browser:

```text
http://<your-server>:3000
```

If `FINTRACK_PASSWORD` is set, the browser prompts for Basic Auth credentials. The default username is:

```text
fintrack
```

If the app opens without a password prompt, stop the container and set `FINTRACK_PASSWORD` before using it on a network.

Do not paste real account numbers, real transactions, SimpleFIN access URLs, Basic Auth URLs, CSV files, SQLite databases, ledgers, or handoff files into issues, commits, documentation, or chat logs. Use placeholders such as `<simplefin-access-url>`, `<account-name>`, and `<YYYY-MM>`.

## 2. Initial Setup

Open `设置`.

Configure:

- SimpleFIN access URL, if you want automatic sync.
- Daily sync hour.
- Optional Gemini API key for AI Ledger account suggestions.
- Optional Claude API key as a fallback classifier.
- Beancount and handoff paths through environment variables if you use export or handoff.

The settings page stores configured secrets in the local SQLite database. Keep the database private and backed up.

## 3. Main V2 Workflow

Use FinTrack as a preparation pipeline:

```text
Source data
  -> raw import archive
  -> staged review
  -> source account mapping
  -> cash promotion or investment review
  -> Ledger preparation
  -> Beancount preflight
  -> draft download or handoff
```

The primary navigation is:

| UI page | Purpose |
| --- | --- |
| `控制中心` | Readiness summary, recent imports, review counts, export blockers. |
| `导入` | SimpleFIN and CSV import entry point. |
| `Ledger 准备` | Missing Ledger account and review marker cleanup for cash transactions. |
| `转账审核` | Confirm inferred transfer pairs and external account mappings. |
| `导出中心` | Beancount preflight, draft download, handoff write, worker approval status. |
| `账户映射` | Map source accounts to FinTrack accounts and Beancount accounts. |
| `Ledger 账户规则` | Deterministic rules and optional AI Ledger account suggestions. |

Reports, net worth, and category-management pages may still exist as compatibility or diagnostics. They are not the center of the V2 workflow.

## 4. Importing From SimpleFIN

Use SimpleFIN sync when you want automatic account and cash transaction import.

FinTrack will:

1. Fetch accounts and transactions from SimpleFIN.
2. Store source facts in the local database.
3. Create staged or canonical cash records depending on the sync path.
4. Preserve review state and pending-to-posted reconciliation data.
5. Leave new or incomplete records ready for review.

If sync fails, check:

- The SimpleFIN access URL is valid.
- The container has network access.
- The bridge session has not expired.
- The expected accounts are shared through SimpleFIN.
- Container logs and import history.

## 5. Importing CSV Files

Open `导入`, choose a CSV file, select or create a profile, and map columns.

For generic bank or cash CSV files:

- Map required fields such as date, amount, description, account, and optional Ledger account hints.
- Preview the file.
- Stage the import.
- Open the import run for `暂存导入审核`.
- Fix required field errors and source account mappings.
- Promote only rows that are valid cash transactions.

Promotion is not a blind import. FinTrack checks required fields, source account mapping, and promotion-time Beancount validation when requested or required.

## 6. Fidelity Brokerage CSV Imports

Fidelity Brokerage CSV files are handled as investment imports, not ordinary cash imports.

For these files, FinTrack:

- Archives raw rows for audit and replay.
- Builds import-run review data.
- Extracts source accounts, securities, positions, and investment activities when available.
- Requires source account mapping before export readiness.
- Lets you map securities to Beancount commodities.
- Includes reviewed investment activities in Beancount export preflight.

Fidelity Brokerage rows do not enter the cash promotion flow. You should not promote buys, sells, dividends, reinvestments, positions, or brokerage cash movement as generic cash transactions. Finish investment review, then run Beancount export preflight in `导出中心` or from the import run.

## 7. Import Run Review

Open an import run from `导入` or `控制中心`.

Typical sections:

- `来源账户映射`: map imported institution/source accounts to FinTrack accounts.
- `证券映射`: map imported symbols or CUSIPs to Beancount commodities.
- `投资持仓`: review imported position snapshots.
- `投资活动`: review buys, sells, dividends, reinvestments, transfers, and fees.
- `Ledger 准备记录`: review staged cash rows that can become cash transactions.

The run page may show validation blockers. Fix blockers before promotion or export preflight. Investment imports may show a message that investment records do not use cash promotion; that is expected.

## 8. Account Mapping

There are two related mapping layers:

- Source account to FinTrack account mapping on the import run.
- FinTrack account to Beancount account mapping on `账户映射`.

Map asset accounts to appropriate `Assets:...` Beancount accounts and liabilities to `Liabilities:...` accounts. FinTrack reads the mounted Beancount checkout and can warn when an account is closed or not open for the relevant date.

Incomplete account mapping can block promotion and Beancount export.

## 9. Ledger Preparation

Open `Ledger 准备` to resolve cash transactions that still need attention.

Common reasons:

- Missing Ledger account.
- Review Ledger account marker.
- Pending or unresolved status.
- Low-confidence AI suggestion.
- Imported row still has validation errors.

Use manual selection first. Create deterministic rules for repeated descriptions. Optional AI suggestions can speed up review, but AI output is advisory and should be confirmed before export.

## 10. Rules And AI Suggestions

Open `Ledger 账户规则`.

Rules classify transactions based on stable text patterns. Use them for payroll, interest, subscriptions, utilities, and other repeated descriptions.

Recommended flow:

1. Manually assign a Ledger account for a known transaction.
2. Create a rule only if similar descriptions recur.
3. Apply rules.
4. Review the result before export.

AI classification is optional. If configured, FinTrack can ask Gemini or Claude for Ledger account suggestions. Suggestions are not authoritative and should not replace review.

## 11. Transfer Review

Open `转账审核` before export.

FinTrack can infer transfer pairs such as:

- Bank-to-bank transfers.
- Credit card payments.
- Wallet transfers.
- Investment transfers.

Confirm true pairs and map external sides when one side is outside FinTrack. Incorrect transfer matching can duplicate spending or create wrong balances, so review transfers before Beancount export.

## 12. Beancount Export Preflight

Open `导出中心`, select a month, and refresh preflight.

Preflight checks may report:

- Missing or review Ledger accounts.
- Unmatched transfers.
- Duplicate existing postings.
- Accounts that are not open for the date.
- Balance assertion issues.
- Investment activity blockers.
- Missing source account or security mappings.
- Draft rendering errors.

Fix blockers before downloading a draft or writing a handoff. The right fix is usually in FinTrack: map an account, choose a Ledger account, resolve a transfer, ignore a true duplicate, or complete investment review.

## 13. Promotion-Time Beancount Validation

Cash promotion can be checked against Beancount before rows are promoted from staged import review.

The import run provides an explicit `Beancount 导出预检` action. Promotion also honors the required validation gate:

- If validation is optional, FinTrack runs validation when requested or when a checker is available and reports the result.
- If validation is required, promotion is blocked unless Beancount preflight and external validation pass.
- If validation is disabled, external validation is skipped, but required field and preflight blockers still matter.

This gate prevents invalid staged cash records from entering the Ledger preparation flow when strict validation is configured.

## 14. External Beancount Validation Settings

Use these environment variables:

```text
FINTRACK_BEANCOUNT_VALIDATOR=bean-check
FINTRACK_BEANCOUNT_VALIDATION=optional
```

Validation modes:

| Mode | Behavior |
| --- | --- |
| `optional` | Default. Run validation when possible; missing validator is reported but does not block. |
| `required` | Validator must exist, run, and pass. Missing or failed validation blocks promotion/export. |
| `disabled` | Skip the external validator. FinTrack preflight still runs. |

Use `required` for production workflows that must not promote or hand off data unless Beancount validation succeeds.

## 15. Beancount Handoff

FinTrack can write a handoff package for a separate Beancount worker.

Required FinTrack mounts:

```text
/app/data     read-write  FinTrack SQLite database
/beancount    read-only   Beancount checkout
/handoff      read-write  Shared handoff directory
```

FinTrack writes:

```text
FINTRACK_HANDOFF_ROOT/YYYY-MM/fintrack/
  manifest.json
  YYYY-MM.bean
  YYYY-MM-transactions.bean
  YYYY-MM-balances.bean
```

The worker may later write `status.json`. FinTrack writes `decision.json` when you approve or reject.

State flow:

```text
No handoff
  -> FinTrack writes manifest and drafts
  -> Beancount worker validates draft
  -> ready_for_approval
  -> FinTrack approve or reject
  -> Beancount worker applies decision
  -> merged, rejected, or failed
```

`merged` means the worker promoted the handoff and validation passed. It does not necessarily mean a Git commit was created or a Fava artifact was published.

## 16. Running And Approving The Worker

The Beancount worker is a separate process. A typical command is:

```bash
make fintrack-handoff-worker HANDOFF_ROOT=/handoff
```

For a new handoff, the worker:

1. Reads `manifest.json`.
2. Copies the reviewed draft into Beancount staging.
3. Runs import review checks.
4. Writes `status.json`.
5. Stops at `ready_for_approval`.

Return to `导出中心`, review the manifest, draft, transaction count, investment activity count, transfer count, warnings, and period. Approve only when the draft is correct.

After approval, run the worker again. It reads `decision.json`, re-runs checks, promotes the draft into Beancount, runs validation, and writes the final status.

## 17. After `merged`

Production Beancount/Fava workflows usually still need steps outside FinTrack:

```text
Review Beancount git diff
  -> run ledger check
  -> git commit
  -> build Fava artifact
  -> validate artifact
  -> publish artifact
  -> reload Fava
```

These steps belong to the Beancount deployment workflow, not FinTrack. Fava should read only a checked artifact and should not mount FinTrack data, raw imports, handoff drafts, or a writable Beancount checkout.

## 18. Troubleshooting

### App opens without a password

`FINTRACK_PASSWORD` is probably empty. Set it and recreate the container.

### CSV import has validation errors

Check required column mappings, source account mapping, date format, amount sign, and whether the file is an investment CSV that should go through investment review instead of cash promotion.

### Fidelity Brokerage import does not promote cash rows

That is expected for brokerage investment imports. Finish source account, security, position, and investment activity review, then run Beancount preflight.

### Promote button is blocked

Check missing required fields, unmapped source accounts, existing validation errors, and promotion-time Beancount validation. In `required` mode, the validator must be installed and passing.

### Beancount accounts do not appear

Check `BEANCOUNT_ROOT`, the read-only mount, whether the mounted directory contains `main.bean`, and whether the container user can read the files.

### Write handoff is disabled

Check `FINTRACK_HANDOFF_ROOT`, the handoff mount, directory permissions, and Beancount preflight blockers.

### Worker status does not appear

Run the Beancount worker. FinTrack reads status files; it does not run the worker.

### Fava does not show the new month

`merged` updates the worker's Beancount checkout. Build and publish a checked Fava artifact from the committed Beancount ledger.

## 19. Backup Checklist

Back up:

```text
data/fintrack.db
```

If the app is running, SQLite may also have WAL/SHM files. Stop the container before copying the database, or use a SQLite-aware backup method.

Recommended cadence:

- Daily local backup.
- Weekly off-device backup.
- Monthly restore test.

## 20. Operational Checklist

Daily:

- Sync or import new data.
- Review new import runs.
- Resolve urgent Ledger preparation items.

Weekly:

- Apply rules.
- Review transfers.
- Complete source account mappings.
- Back up the database.

Monthly:

- Complete cash transaction review.
- Complete investment activity and security review.
- Run Beancount preflight.
- Download a checked draft or write handoff.
- Run the Beancount worker.
- Approve or reject.
- Confirm final worker status.
- Commit and publish Beancount/Fava artifacts if you use that workflow.
