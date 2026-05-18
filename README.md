# FinTrack

FinTrack V2 is a self-hosted Beancount ingestion and preparation hub with a Chinese-first UI. It keeps raw financial imports private, stages records for review, and produces Beancount drafts or handoff packages after explicit validation.

FinTrack is not a bank, broker, tax tool, accounting authority, portfolio dashboard, or Fava replacement. Beancount remains the final source of truth. FinTrack prepares data before it enters the ledger.

## Current V2 Scope

FinTrack currently focuses on:

- Importing from SimpleFIN and CSV files into a local SQLite database.
- Preserving raw imports for audit and replay.
- Staging cash transactions before they are promoted into Ledger preparation.
- Archiving Fidelity Brokerage CSV investment rows for investment review instead of promoting them through the cash transaction flow.
- Reviewing investment activities, positions, security mappings, and source account mappings before Beancount export.
- Mapping source financial accounts to FinTrack accounts and Beancount accounts.
- Assigning Ledger accounts manually, by deterministic rules, or with optional AI suggestions.
- Reviewing inferred transfers before export.
- Running Beancount preflight before draft download, handoff write, and required promotion gates.
- Writing Beancount handoff packages to a separate directory without writing directly to the Beancount repository.

Older reporting, net worth, category, and chart surfaces are retained only as compatibility or diagnostics. They are not the primary V2 workflow.

## User Guide

Read the full manual in your preferred language:

| Language | Manual |
| --- | --- |
| English | [User manual](docs/USER_MANUAL.md) |
| 简体中文 | [中文用户手册](docs/USER_MANUAL.zh-CN.md) |

Typical V2 workflow:

1. Configure Basic Auth, storage paths, optional SimpleFIN, optional AI keys, and optional Beancount mounts.
2. Import from SimpleFIN or upload a CSV on `导入`.
3. Open the import run and finish `来源账户映射`.
4. For ordinary cash CSV or SimpleFIN rows, review staged records and promote only valid cash transactions into Ledger preparation.
5. For Fidelity Brokerage CSV rows, use `证券映射`, `投资持仓`, and `投资活动`; these records are archived for investment review and Beancount export preflight, not cash promotion.
6. Use `Ledger 准备`, `转账审核`, `账户映射`, and `Ledger 账户规则` to resolve blockers.
7. Run Beancount preflight in `导出中心`.
8. Download a checked draft or write a handoff package only after blockers are resolved.
9. Let the separate Beancount worker validate, wait for approval, and promote the handoff into the ledger.
10. Back up the SQLite database and keep all exports private.

## Architecture

```text
SimpleFIN / CSV / future source adapters
  -> raw import archive
  -> normalized staging
  -> cash review / investment review / mapping
  -> Ledger preparation
  -> Beancount preflight and external validation
  -> draft download or handoff package

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

FinTrack should not write directly to a Beancount repository. If you use the Beancount integration, mount the Beancount checkout read-only in FinTrack and mount a separate handoff directory read-write.

## Import Behavior

SimpleFIN sync and generic cash CSV imports create staged cash transactions. Staged rows must have required fields and account mapping before promotion. Promotion is guarded by validation so bad staged records do not enter the canonical transaction workflow.

Fidelity Brokerage CSV imports are intentionally different:

- The CSV is parsed and archived as raw import data.
- Source accounts must be mapped.
- Securities can be mapped to Beancount commodities.
- Investment positions and investment activities can be reviewed.
- Investment activities participate in Beancount export preflight.
- Brokerage investment rows do not enter the ordinary cash promotion flow.

This prevents buys, sells, dividends, reinvestments, positions, and brokerage cash movement from being misrepresented as generic bank transactions.

## Beancount Validation

FinTrack has three Beancount validation points:

- Export preflight in `导出中心`, before drafts and handoff writes.
- Draft and balance assertion external validation before file download when a validator is available.
- Promotion-time Beancount validation for staged import promotion, including the required validation gate.

`FINTRACK_BEANCOUNT_VALIDATOR` controls the external checker command and defaults to `bean-check`.

`FINTRACK_BEANCOUNT_VALIDATION` controls validation strictness:

| Value | Behavior |
| --- | --- |
| `optional` | Default. Run validation when available; unavailable validator is reported but does not block. |
| `required` | Validation must run and pass. Missing validator or failed validation blocks promotion/export. |
| `disabled` | Skip external validation. Preflight blockers still apply. |

The required validation gate prevents promotion when Beancount validation fails or cannot run in required mode.

## Security And Privacy Model

FinTrack handles sensitive financial data. Treat every deployment as private.

Required production practices:

- Set `FINTRACK_PASSWORD`.
- Run behind a private network, VPN, HTTPS reverse proxy, or trusted tunnel.
- Do not expose the app directly to the public internet without authentication and TLS.
- Back up the SQLite database using an encrypted or otherwise private backup process.
- Do not commit `.env`, SQLite files, backups, exported CSV/JSON files, raw imports, generated `.bean` files, handoff files, ledgers, or real financial data.
- Keep the Beancount repository read-only inside the FinTrack container.
- Do not paste real account numbers, real transactions, SimpleFIN access URLs, or Basic Auth URLs into issues, commits, handoff notes, or documentation.

Basic Auth is enabled only when `FINTRACK_PASSWORD` is non-empty. An empty password means the app is open to anyone who can reach it.

Exports do not intentionally include SimpleFIN URLs or API keys, but exported transactions, backups, drafts, and handoff files still contain private financial data.

## Deployment With Docker Compose

The default `docker-compose.yml` is intended for NAS UI deployment where you paste a single YAML file and pull a prebuilt image.

Before using it, publish your image to GHCR or replace the image name with your own registry image.
For reproducible deployments, prefer a release tag or `sha-<commit>` image tag. The `latest` tag is mutable and should be treated as a convenience tag, not an audit trail.

```yaml
services:
  fintrack:
    image: ${FINTRACK_IMAGE:-ghcr.io/ericyan23/fintrack:latest}
    container_name: fintrack
    restart: unless-stopped
    environment:
      - SIMPLEFIN_ACCESS_URL=${SIMPLEFIN_ACCESS_URL:-}
      - FINTRACK_USERNAME=${FINTRACK_USERNAME:-fintrack}
      - FINTRACK_PASSWORD=${FINTRACK_PASSWORD:?set FINTRACK_PASSWORD before starting FinTrack}
      - DB_PATH=/app/data/fintrack.db
      - BEANCOUNT_ROOT=/beancount
      - FINTRACK_HANDOFF_ROOT=/handoff
      - FINTRACK_BEANCOUNT_VALIDATOR=${FINTRACK_BEANCOUNT_VALIDATOR:-bean-check}
      - FINTRACK_BEANCOUNT_VALIDATION=${FINTRACK_BEANCOUNT_VALIDATION:-optional}
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
FINTRACK_IMAGE=ghcr.io/ericyan23/fintrack:sha-<commit>
FINTRACK_PORT=3000
FINTRACK_DATA_HOST=/volume1/docker/fintrack/data
BEANCOUNT_ROOT_HOST=/volume1/docker/beancount
FINTRACK_HANDOFF_ROOT_HOST=/volume1/docker/fintrack/handoff
FINTRACK_USERNAME=fintrack
FINTRACK_PASSWORD=change-this-password
FINTRACK_BEANCOUNT_VALIDATOR=bean-check
FINTRACK_BEANCOUNT_VALIDATION=required
SYNC_HOUR=3
TZ=America/New_York
SIMPLEFIN_ACCESS_URL=
GEMINI_API_KEY=
CLAUDE_API_KEY=
```

Use placeholders while testing. Do not store or commit real SimpleFIN URLs, Basic Auth URLs, account identifiers, CSV files, SQLite databases, ledgers, or handoff artifacts in the repository.

If you do not use Beancount, you may leave the Beancount mount as an empty readable directory. Handoff writes require `FINTRACK_HANDOFF_ROOT` and the handoff mount.

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
| `GEMINI_API_KEY` | No | Optional Gemini API key for Ledger account suggestions. |
| `CLAUDE_API_KEY` | No | Optional Claude API key used as classification fallback. |
| `BEANCOUNT_ROOT` | No | Beancount checkout path inside the app container. Mount read-only. |
| `FINTRACK_HANDOFF_ROOT` | No | Writable handoff directory inside the app container. Leave unset to disable handoff writes. |
| `FINTRACK_BEANCOUNT_VALIDATOR` | No | External Beancount validator command. Defaults to `bean-check`. |
| `FINTRACK_BEANCOUNT_VALIDATION` | No | Validator mode: `optional`, `required`, or `disabled`. Defaults to `optional`. |
| `FINTRACK_DATA_HOST` | Docker only | Host path mounted at `/app/data`. |
| `BEANCOUNT_ROOT_HOST` | Docker only | Host path mounted read-only at `/beancount`. |
| `FINTRACK_HANDOFF_ROOT_HOST` | Docker only | Host path mounted read-write at `/handoff`. |
| `FINTRACK_IMAGE` | Docker only | Container image used by compose. Prefer a release tag or `sha-<commit>` over mutable `latest` for production. |
| `FINTRACK_PORT` | Docker only | Host port mapped to container port 3000. |

## Data Directory

FinTrack stores local state in SQLite. The database contains sensitive data:

- Source connections and settings.
- Source accounts and account mappings.
- Raw import metadata and staged records.
- Cash transactions and review state.
- Investment securities, positions, and activities.
- Ledger account rules and AI suggestions.
- Transfer matches.
- Balance assertions.
- Handoff and export status.

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

- Read the Beancount checkout for account status and preflight checks.
- Generate checked draft handoff files.
- Run external Beancount validation before draft download or handoff write according to the configured validation mode.
- Run promotion-time Beancount validation when staged cash rows are promoted and validation is requested or required.
- Read worker status.
- Record approve/reject decisions.

Beancount worker responsibilities:

- Consume the handoff.
- Validate review state and duplicate checks.
- Wait for approval.
- Promote reviewed output into the ledger.
- Run Beancount validation after promotion.

Fava responsibilities:

- Read a checked Beancount artifact.
- Stay read-only.
- Avoid access to FinTrack data, raw imports, staging, and handoff directories.

## Backup And Repository Hygiene

Minimum backup target:

```text
data/fintrack.db
```

If SQLite write-ahead logging files exist while the app is running, stop the container before copying the database or use a SQLite-aware backup method.

The repository intentionally ignores private and generated files, including:

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
