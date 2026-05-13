# FinTrack

FinTrack is a self-hosted personal finance application for transaction review, categorization, reporting, transfer matching, and optional Beancount handoff.

The project is designed for people who want to keep financial data under their own control. FinTrack stores data in a local SQLite database, can sync from SimpleFIN, and can write reviewed monthly handoff files for a separate Beancount workflow.

## What FinTrack Does

- Syncs accounts and transactions from SimpleFIN.
- Stores data locally in SQLite.
- Provides review queues for uncategorized and pending transactions.
- Supports manual rules and optional AI-assisted categorization.
- Tracks balances, net worth snapshots, spending reports, and account history.
- Detects and reviews internal transfers and credit card payments.
- Exports transactions, accounts, backups, reports, and Beancount drafts.
- Writes a Beancount handoff package to a shared directory without writing to the Beancount repository directly.
- Runs as a standalone Next.js app in Docker.

## User Guide

Read the full manual in your preferred language:

| Language | Manual |
| --- | --- |
| English | [User manual](docs/USER_MANUAL.md) |
| 简体中文 | [Chinese user manual](docs/USER_MANUAL.zh-CN.md) |

Typical workflow:

1. Configure SimpleFIN and optional AI keys on the Settings page.
2. Click Sync to import accounts, transactions, balances, and net worth snapshots.
3. Review new transactions on the Transactions and Review pages.
4. Assign categories manually, with rules, or with optional AI suggestions.
5. Review transfer matches before treating account-to-account movement as final.
6. Use Reports to inspect spending, income, cash flow, and account activity.
7. Export CSV/JSON backups or generate Beancount drafts after review.
8. Back up the SQLite database regularly and keep exported files private.

Important operating notes:

- FinTrack is a private personal finance tool, not a bank, broker, tax tool, or accounting authority.
- Imported and AI-suggested data should be reviewed before making financial decisions.
- The SQLite database, exports, backups, and Beancount handoff files contain sensitive financial data.
- If Beancount handoff is enabled, FinTrack should write only to the handoff directory, not directly to the Beancount ledger repository.

## Architecture

```text
SimpleFIN
  -> FinTrack
      -> SQLite database
      -> review UI
      -> reports
      -> optional Beancount handoff directory

Beancount worker, optional
  -> reads handoff directory
  -> validates reviewed draft
  -> waits for approval
  -> promotes into Beancount ledger

Fava, optional
  -> reads a checked Beancount artifact
  -> does not read FinTrack data
  -> does not read the handoff directory
```

FinTrack should not write directly to a Beancount repository. If you use the Beancount integration, mount the Beancount checkout read-only and mount a separate handoff directory read-write.

## Security Model

FinTrack handles sensitive financial data. Treat every deployment as private.

Required production practices:

- Set `FINTRACK_PASSWORD`.
- Run behind a private network, VPN, HTTPS reverse proxy, or trusted tunnel.
- Do not expose the app directly to the public internet without authentication and TLS.
- Back up the SQLite database.
- Do not commit `.env`, SQLite files, backups, exported CSV/JSON files, or handoff files.
- Keep the Beancount repository read-only inside the FinTrack container.

Basic Auth is enabled only when `FINTRACK_PASSWORD` is non-empty. An empty password means the app is open to anyone who can reach it.

## Deployment With Docker Compose

The default `docker-compose.yml` is intended for NAS UI deployment where you paste a single YAML file and pull a prebuilt image.

Before using it, publish your image to GHCR or replace the image name with your own registry image.

```yaml
services:
  fintrack:
    image: ghcr.io/ericyan23/fintrack:latest
    container_name: fintrack
    restart: unless-stopped
    environment:
      - SIMPLEFIN_ACCESS_URL=${SIMPLEFIN_ACCESS_URL:-}
      - FINTRACK_USERNAME=${FINTRACK_USERNAME:-fintrack}
      - FINTRACK_PASSWORD=${FINTRACK_PASSWORD:?set FINTRACK_PASSWORD before starting FinTrack}
      - DB_PATH=/app/data/fintrack.db
      - BEANCOUNT_ROOT=/beancount
      - FINTRACK_HANDOFF_ROOT=/handoff
      - SYNC_HOUR=${SYNC_HOUR:-3}
      - TZ=${TZ:-UTC}
      - GEMINI_API_KEY=${GEMINI_API_KEY:-}
      - CLAUDE_API_KEY=${CLAUDE_API_KEY:-}
    volumes:
      - type: bind
        source: ${FINTRACK_DATA_HOST:-./data}
        target: /app/data
      - type: bind
        source: ${BEANCOUNT_ROOT_HOST:-./beancount}
        target: /beancount
        read_only: true
      - type: bind
        source: ${FINTRACK_HANDOFF_ROOT_HOST:-./handoff}
        target: /handoff
    ports:
      - "${FINTRACK_PORT:-3000}:3000"
```

For a NAS deployment, create host directories first:

```text
/volume1/docker/fintrack/data
/volume1/docker/fintrack/handoff
/volume1/docker/beancount
```

The container runs as UID/GID `1001`. Make the writable host directories owned by that user, or grant equivalent ACL permissions in your NAS UI:

```bash
sudo chown -R 1001:1001 /volume1/docker/fintrack/data /volume1/docker/fintrack/handoff
```

The Beancount checkout only needs to be readable by the FinTrack container.

Example environment values:

```text
FINTRACK_IMAGE=ghcr.io/ericyan23/fintrack:latest
FINTRACK_PORT=3000
FINTRACK_DATA_HOST=/volume1/docker/fintrack/data
BEANCOUNT_ROOT_HOST=/volume1/docker/beancount
FINTRACK_HANDOFF_ROOT_HOST=/volume1/docker/fintrack/handoff
FINTRACK_USERNAME=fintrack
FINTRACK_PASSWORD=change-this-password
SYNC_HOUR=3
TZ=UTC
SIMPLEFIN_ACCESS_URL=
GEMINI_API_KEY=
CLAUDE_API_KEY=
```

For a real deployment, replace `change-this-password` and set `TZ` to your local timezone, for example `America/New_York`.

If you do not use Beancount, you may still leave the Beancount mount as an empty readable directory. Handoff writes require `FINTRACK_HANDOFF_ROOT` and the handoff mount.

## Publishing a GHCR Image

This repository includes `.github/workflows/docker-image.yml`.

After pushing the repository to GitHub:

1. Open the repository settings.
2. Enable GitHub Actions if needed.
3. Push to `main` or run the workflow manually.
4. The workflow publishes:

```text
ghcr.io/ericyan23/fintrack:latest
ghcr.io/ericyan23/fintrack:sha-<commit>
```

Make sure the package visibility is public if your NAS must pull the image without authentication. For private images, configure Docker registry credentials on the NAS.

## Local Development

Requirements:

- Node.js compatible with the project dependencies.
- npm.

Install dependencies and start the development server:

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open:

```text
http://localhost:3000
```

Useful commands:

```bash
npm run typecheck
npm run build
npm run db:generate
npm run db:push
```

`npm run lint` uses the legacy `next lint` command. If your Next.js version no longer supports it, replace it with an ESLint CLI configuration.

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `DB_PATH` | No | SQLite database path. Defaults to `./data/fintrack.db` locally and `/app/data/fintrack.db` in Docker. |
| `SIMPLEFIN_ACCESS_URL` | No | SimpleFIN read-only access URL used by sync. You can also set it from the Settings page. |
| `FINTRACK_USERNAME` | No | Basic Auth username. Defaults to `fintrack`. |
| `FINTRACK_PASSWORD` | Production yes | Basic Auth password. Set this for any networked deployment. |
| `SYNC_HOUR` | No | Daily sync hour, 0-23. Defaults to `3`. |
| `TZ` | No | Container timezone used by scheduled sync. Defaults to `UTC`. |
| `GEMINI_API_KEY` | No | Optional Gemini API key for classification. |
| `CLAUDE_API_KEY` | No | Optional Claude API key used as classification fallback. |
| `BEANCOUNT_ROOT` | No | Beancount checkout path inside the app container. |
| `FINTRACK_HANDOFF_ROOT` | No | Writable handoff directory inside the app container. Leave unset to disable handoff writes. |
| `FINTRACK_DATA_HOST` | Docker only | Host path mounted at `/app/data`. |
| `BEANCOUNT_ROOT_HOST` | Docker only | Host path mounted read-only at `/beancount`. |
| `FINTRACK_HANDOFF_ROOT_HOST` | Docker only | Host path mounted read-write at `/handoff`. |
| `FINTRACK_IMAGE` | Docker only | Container image used by compose. |
| `FINTRACK_PORT` | Docker only | Host port mapped to container port 3000. |

## Data Directory

FinTrack stores local state in SQLite. The database contains sensitive data:

- Accounts
- Transactions
- Categories
- Review state
- Rules
- Transfer matches
- Net worth snapshots
- Settings

Back up the database regularly. Do not commit it.

## Beancount Handoff

FinTrack can generate a handoff package for a separate Beancount worker.

The package is written under:

```text
FINTRACK_HANDOFF_ROOT/YYYY-MM/fintrack/
```

Typical files:

```text
manifest.json
YYYY-MM.bean
YYYY-MM-transactions.bean
YYYY-MM-balances.bean
status.json
decision.json
```

FinTrack responsibilities:

- Read the Beancount checkout for accounts and preflight checks.
- Generate draft handoff files.
- Read worker status.
- Record approve/reject decisions.

Beancount worker responsibilities:

- Consume the handoff.
- Validate review state and duplicate checks.
- Wait for approval.
- Promote reviewed output into the ledger.
- Run Beancount validation.

Fava responsibilities:

- Read a checked Beancount artifact.
- Stay read-only.
- Avoid access to FinTrack data, raw imports, staging, and handoff directories.

## Backup and Restore

Minimum backup target:

```text
data/fintrack.db
```

If SQLite write-ahead logging files exist while the app is running, stop the container before copying the database or use a SQLite-aware backup method.

Recommended routine:

1. Stop the container or run a consistent database backup.
2. Copy the SQLite database to encrypted storage.
3. Keep multiple dated backups.
4. Test restore on a non-production instance.

## Repository Hygiene

The repository intentionally ignores:

- `.env*`
- `data/`
- `handoff/`
- exports and backups
- SQLite files
- CSV/log files
- generated Beancount files
- `node_modules/`
- `.next/`
- TypeScript build cache

Before publishing your fork:

```bash
find . -maxdepth 3 -type f | sort
git status --ignored
```

Run a secret scan if you have stored real financial data in the working tree.

## License

FinTrack is released under the MIT License. See [LICENSE](LICENSE).
