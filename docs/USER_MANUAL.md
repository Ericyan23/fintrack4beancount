# FinTrack User Manual

This manual explains how to operate FinTrack after it has been deployed.

FinTrack is a private personal finance app. It is not a bank, broker, tax tool, or accounting authority. Always review imported data before using it for financial decisions.

## 1. First Login

Open the app in your browser:

```text
http://<your-server>:3000
```

If `FINTRACK_PASSWORD` is set, the browser prompts for Basic Auth credentials.

Default username:

```text
fintrack
```

Use the password you configured in the Docker compose environment.

If the app opens without a password prompt, stop the container and set `FINTRACK_PASSWORD` before using it on a network.

## 2. Initial Setup

Open the Settings page.

Configure:

- SimpleFIN access URL, if you want automatic sync.
- Daily sync hour.
- Optional Gemini API key for AI classification.
- Optional Claude API key as a fallback classifier.

The settings page stores configured secrets in the local SQLite database. Keep the database private and backed up.

## 3. Syncing Transactions

Open the top navigation bar and click Sync.

FinTrack will:

1. Fetch accounts and transactions from SimpleFIN.
2. Upsert accounts.
3. Upsert transactions.
4. Update balances.
5. Create net worth snapshots.
6. Leave new transactions ready for review.

If sync fails:

- Confirm the SimpleFIN access URL is valid.
- Confirm the app can reach the network.
- Check whether your SimpleFIN bridge session needs to be refreshed.
- Review container logs.

## 4. Home Dashboard

The Home page summarizes:

- Account balances
- Net worth
- Spending trends
- Recent transactions
- Review progress

Use it as a quick health check after syncing.

## 5. Accounts

The Accounts page shows synced financial accounts.

Common actions:

- Review account names.
- Check current balances.
- Inspect recent sync status.
- Confirm whether an account is active or stale.

If an account looks wrong, fix it at the data source when possible and sync again.

## 6. Transactions

The Transactions page is the primary ledger review surface.

You can:

- Filter by date range.
- Filter by account.
- Filter by category.
- Search descriptions.
- Open transaction detail pages.
- Change categories.
- Mark transactions as reviewed.
- Cancel transactions that should not be exported.

Recommended routine:

1. Sync.
2. Review newest transactions.
3. Categorize anything uncategorized.
4. Confirm transfers.
5. Check reports.

## 7. Review Queue

The Review page focuses on transactions that still need attention.

Typical reasons a transaction appears in review:

- Missing category.
- Review category assigned.
- Pending transaction.
- Possible transfer.
- Classification confidence is low.

A transaction should leave review only when you understand where it belongs.

## 8. Categories

Categories are used for reporting and export.

FinTrack supports:

- Expense categories
- Income categories
- Equity categories
- Transfer categories
- Optional Beancount account names

Examples:

```text
Expenses:Food:Groceries
Expenses:Food:Restaurants
Income:Salary
Transfer:Internal
Transfer:CreditCardPayment
```

If Beancount is mounted read-only, FinTrack can read open Beancount accounts and show them in category selectors.

## 9. Rules

Rules classify transactions based on text patterns.

Use rules for stable, repeated transaction descriptions:

- Payroll
- Interest
- Credit card payments
- Common subscriptions
- Groceries
- Utilities

Avoid over-specific rules that only match one transaction unless that is intentional.

Rule priority controls which rule wins when multiple rules match. Higher priority wins.

Recommended workflow:

1. Manually categorize a transaction.
2. Create a rule only if similar transactions recur.
3. Apply rules.
4. Review the result before export.

## 10. AI Classification

AI classification is optional.

If configured, FinTrack can use Gemini or Claude to suggest categories. Gemini is tried first when available. Claude is used as a fallback when configured.

AI output should be reviewed. Do not treat it as authoritative.

Recommended usage:

- Use AI to speed up review.
- Keep important categories human-reviewed.
- Add deterministic rules for recurring transactions after confirming patterns.

## 11. Transfers

The Transfers page helps identify movement between accounts.

Common transfer types:

- Bank to bank transfer
- Credit card payment
- Wallet transfer
- Investment transfer

A transfer is safer when both sides are present and matched.

If one side is outside FinTrack, use an appropriate external asset or liability account if your Beancount workflow supports it.

Examples:

```text
Transfer:Internal
Transfer:CreditCardPayment
Transfer:Wallet
Assets:Wallet:Example
```

Review transfers carefully before Beancount handoff. Incorrect transfer matching can create duplicate spending or incorrect balances.

## 12. Reports

The Reports page summarizes financial activity.

Common views:

- Spending by category
- Income by category
- Net worth changes
- Account-level activity

Reports are only as accurate as the reviewed transactions. If reports look wrong, return to Transactions and Review.

## 13. Import and Export

The Import page can preview and stage transaction files for review before promotion.

The app also exposes export functions for:

- Transactions
- Accounts
- Net worth
- Backups
- Beancount drafts

Treat exported files as sensitive financial data.

## 14. Beancount Handoff Overview

FinTrack can hand reviewed monthly activity to a separate Beancount workflow.

The important boundary is:

```text
FinTrack writes handoff files.
Beancount worker validates and promotes them.
Fava reads only a checked Beancount artifact.
```

FinTrack should not write directly to `main.bean` or `book/`. It writes a handoff package to a shared directory. The Beancount worker reads that package, runs validation, waits for a FinTrack approval decision, and then promotes the reviewed entries into the Beancount ledger.

### Required mounts

In Docker, the typical FinTrack mounts are:

```text
/app/data     read-write  FinTrack SQLite database
/beancount    read-only   Beancount checkout
/handoff      read-write  Shared handoff directory
```

Environment variables inside the FinTrack container:

```text
DB_PATH=/app/data/fintrack.db
BEANCOUNT_ROOT=/beancount
FINTRACK_HANDOFF_ROOT=/handoff
```

The Beancount worker must mount the same handoff directory:

```text
/handoff      read-write  Same shared handoff directory
```

The Beancount worker also needs write access to its own Beancount checkout because it is responsible for promotion into `book/` and optional `main.bean` include updates.

Fava should not mount `/handoff`, FinTrack data, raw files, or the writable Beancount repo checkout. Fava should read a validated artifact only.

The FinTrack Docker image runs as UID/GID `1001`. The host data and handoff directories must be writable by that user or by an equivalent NAS ACL. The Beancount checkout mounted into FinTrack should be read-only.

### Handoff directory structure

For period `2026-05`, FinTrack writes:

```text
/handoff/2026-05/fintrack/
  manifest.json
  2026-05.bean
  2026-05-transactions.bean
  2026-05-balances.bean
```

The Beancount worker may later write:

```text
/handoff/2026-05/fintrack/status.json
```

FinTrack writes the approval decision:

```text
/handoff/2026-05/fintrack/decision.json
```

### State flow

The expected flow is:

```text
No handoff
  -> FinTrack writes manifest and drafts
  -> Beancount worker consumes draft
  -> ready_for_approval
  -> FinTrack approve or reject
  -> Beancount worker applies decision
  -> merged, rejected, or failed
```

Meaning of common statuses:

| Status | Meaning |
| --- | --- |
| No status | FinTrack wrote files, but the worker has not consumed them yet. |
| `ready_for_approval` | Worker validated the draft and is waiting for an approve/reject decision. |
| `rejected` | User rejected the handoff from FinTrack. |
| `failed` | Worker could not consume or apply the handoff. Read the worker error before retrying. |
| `merged` | Worker promoted the handoff into Beancount and validation passed. |

`merged` does not necessarily mean a Git commit was created. It also does not necessarily mean a Fava artifact was published.

## 15. Beancount Preflight

Open the Beancount page when you want to prepare a monthly export.

Select the month and refresh.

Preflight checks may report:

- Missing or review categories
- Unmatched transfers
- Duplicate existing postings
- Accounts that are not open
- Balance assertion issues

Fix blockers before writing a handoff.

### Preflight blockers

Common blockers:

- A transaction still uses a review category.
- A transfer has not been matched or explicitly handled.
- A transaction appears to duplicate an existing Beancount posting.
- A Beancount account is not open for the transaction date.
- A draft cannot be rendered safely.

The correct fix is usually in FinTrack:

- Categorize or cancel the transaction.
- Confirm, merge, or dismiss a transfer.
- Choose a valid Beancount account.
- Review duplicate transactions and cancel true duplicates before export.

## 16. Writing a Beancount Handoff

When preflight passes, click Write handoff.

FinTrack writes files under:

```text
FINTRACK_HANDOFF_ROOT/YYYY-MM/fintrack/
```

FinTrack does not write to the Beancount repository.

After writing, the UI shows the handoff path and file list. At this point, the Beancount worker has not necessarily processed the files yet.

If the handoff was previously failed or rejected, writing again may replace the known handoff files for that period. FinTrack should not overwrite a handoff that has already been merged.

## 17. Running the Beancount Worker

The Beancount worker is a separate process. A typical command is:

```bash
make fintrack-handoff-worker HANDOFF_ROOT=/handoff
```

The worker scans:

```text
HANDOFF_ROOT/*/fintrack/manifest.json
```

For a new handoff, the worker:

1. Reads `manifest.json`.
2. Copies the reviewed draft into Beancount staging.
3. Runs import review checks.
4. Writes `status.json`.
5. Stops at `ready_for_approval`.

After the worker reports `ready_for_approval`, return to FinTrack and refresh the Beancount page.

## 18. Approving a Handoff

When the worker status is `ready_for_approval`, review:

- The manifest.
- The draft.
- The transaction count.
- The transfer count.
- Any warnings.
- The target month.

If the draft is correct, click Approve.

FinTrack writes:

```text
decision.json
```

The worker must run again after the decision is written.

On the next run, the worker:

1. Reads `decision.json`.
2. Verifies the handoff is still ready for approval.
3. Re-runs review checks.
4. Promotes the reviewed draft into Beancount.
5. Runs Beancount validation.
6. Writes final status.

If validation passes, the status becomes `merged`.

## 19. After `merged`

When FinTrack shows that the handoff was successfully written to Beancount and passed checks, the Beancount ledger has been updated by the worker.

A production Beancount/Fava workflow usually still has additional steps:

```text
Review Beancount git diff
  -> run ledger check
  -> git commit
  -> build Fava artifact
  -> validate artifact
  -> publish artifact
  -> reload Fava
```

These steps should belong to the Beancount deployment workflow, not FinTrack.

Recommended operator check after `merged`:

```bash
git status --short
git diff -- main.bean book/
make ledger-check
```

Then commit and publish according to your Beancount/Fava process.

## 20. Rejecting a Handoff

Reject a handoff if:

- The draft looks wrong.
- A category is wrong.
- A transfer is wrong.
- The period is wrong.
- The worker reports warnings that require review.
- The output should not be promoted.

After rejection:

1. Fix the root cause in FinTrack.
2. Write a fresh handoff.
3. Run the Beancount worker again.

## 21. Failed Handoffs

A failed handoff usually means the Beancount worker rejected the draft or validation failed.

Recommended recovery:

1. Read the worker error in the Beancount page.
2. Inspect `status.json`.
3. Inspect the Beancount worker logs.
4. Fix the root cause.
5. Write a fresh handoff from FinTrack.
6. Run the worker again.

Examples:

| Error type | Typical fix |
| --- | --- |
| Duplicate existing posting | Cancel the true duplicate in FinTrack or correct the date/account/category. |
| Unmatched transfer | Match the transfer, choose an external account, or recategorize it. |
| Account not open | Pick an open account or update the Beancount account lifecycle. |
| Ledger check failed | Fix the accounting issue before retrying. |

Do not manually edit Beancount production files just to bypass a failed handoff unless you understand the accounting effect.

## 22. Example End-to-End Handoff Runbook

This is a complete operator runbook for one month.

In FinTrack:

1. Sync transactions.
2. Review all transactions for the month.
3. Resolve transfer matches.
4. Open Beancount.
5. Select the target month.
6. Refresh preflight.
7. Fix blockers until preflight passes.
8. Click Write handoff.

In the Beancount worker environment:

```bash
make fintrack-handoff-worker HANDOFF_ROOT=/handoff
```

Back in FinTrack:

1. Refresh status.
2. Confirm the worker shows `ready_for_approval`.
3. Review manifest and draft.
4. Click Approve.

Run the worker again:

```bash
make fintrack-handoff-worker HANDOFF_ROOT=/handoff
```

Confirm in FinTrack:

```text
merged
```

In the Beancount repo:

```bash
git status --short
git diff -- main.bean book/
make ledger-check
git add main.bean book/
git commit -m "Import FinTrack YYYY-MM handoff"
```

If using Fava:

```bash
make ledger-fava-artifact-timestamped
make ledger-fava-check LEDGER_ARTIFACT=dist/fava-ledger-<timestamp>
```

Publish the checked artifact according to your Fava deployment process.

## 23. Fava Boundary

Fava should be treated as read-only presentation.

Recommended Fava mount:

```text
/ledger      read-only checked artifact
```

Do not mount:

```text
FinTrack data directory
FinTrack handoff directory
Beancount raw import directory
Beancount staging directory
Writable Beancount repo checkout
```

This keeps Fava from seeing raw imports, handoff drafts, SQLite databases, and unrelated private files.

## 24. Handoff Troubleshooting

### The Write handoff button says handoff root is not configured

Set:

```text
FINTRACK_HANDOFF_ROOT=/handoff
```

Also mount a writable host directory to `/handoff`.

### Worker status does not appear

Run the Beancount worker. FinTrack only reads status files; it does not run the worker.

### Approve button is disabled

The worker has not reached `ready_for_approval`, or a decision already exists.

### The worker says the handoff failed

Read the error message. Fix the root cause in FinTrack or Beancount, then write a fresh handoff.

### Fava does not show the new month

`merged` updates the Beancount repo checkout used by the worker. Fava may still be reading an older artifact. Build and publish a new Fava artifact from the committed Beancount ledger.

## 25. Import and Export

The Import page can preview and stage transaction files for review before promotion.

The app also exposes export functions for:

- Transactions
- Accounts
- Net worth
- Backups
- Beancount drafts

Treat exported files as sensitive financial data.

## 26. Backups

Back up the SQLite database regularly.

Recommended backup content:

```text
data/fintrack.db
```

If the app is running, SQLite may also have WAL/SHM files. Stop the container before copying the database, or use a SQLite-aware backup method.

Suggested schedule:

- Daily local backup
- Weekly off-device backup
- Monthly restore test

## 27. Updating the Docker Deployment

If you deploy from GHCR:

1. Push a new commit to GitHub.
2. Wait for the Docker image workflow to publish.
3. Pull the latest image on the NAS.
4. Recreate the container.
5. Check the app health.

The SQLite data directory should remain mounted and should not be replaced during updates.

## 28. Troubleshooting

### App opens without a password

`FINTRACK_PASSWORD` is probably empty. Set it in the compose environment and recreate the container.

### Sync does not import transactions

Check:

- SimpleFIN access URL
- Container network access
- SimpleFIN account permissions
- Sync logs
- Whether the lookback window includes the expected transactions

### Categories look wrong

Check:

- Manual rules
- AI classification result
- Beancount account import
- Category merge and rename history

### Beancount handoff is disabled

Check:

- `FINTRACK_HANDOFF_ROOT`
- Handoff directory mount
- Directory permissions

### Beancount accounts do not appear

Check:

- `BEANCOUNT_ROOT`
- Read-only Beancount mount
- Whether the mounted directory contains `main.bean`
- Whether account files are readable by the container user

### Docker container cannot write the database

Check:

- Host data directory exists
- Host data directory is writable by the container user
- On Linux/NAS hosts, UID/GID `1001` has write access or equivalent ACL permissions
- The volume is mounted at `/app/data`
- `DB_PATH=/app/data/fintrack.db`

## 29. Operational Checklist

Daily:

- Sync.
- Review new transactions.
- Check transfers.

Weekly:

- Review reports.
- Apply rules.
- Back up the database.

Monthly:

- Complete transaction review.
- Run Beancount preflight.
- Write handoff.
- Run Beancount worker.
- Approve or reject.
- Confirm worker result.
- Commit and publish Beancount/Fava artifacts if you use that workflow.
