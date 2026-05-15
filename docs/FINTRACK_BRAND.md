# FinTrack 2.0 Brand Assets

This folder contains minimal SVG logo assets for FinTrack 2.0. They are intentionally restrained and product-neutral: the visual language is a deterministic data pipeline, not a wallet, investment chart, or personal budgeting dashboard.

## Assets

- `public/brand/fintrack-mark.svg`
  - Compact mark for favicons, small headers, repo cards, and places where the wordmark would be too wide.
  - The three left inputs represent raw import rows. The routed line represents staging and normalization. The three right blocks represent validated handoff targets.

- `public/brand/fintrack-lockup.svg`
  - Horizontal lockup for README headers, documentation pages, and product chrome where a clear name is useful.
  - Uses the compact mark plus a system-font wordmark and a small `IMPORT / STAGE / LEDGER` descriptor. It has no external font or image dependency.

- `public/brand/fintrack-alt.svg`
  - Alternate mark for larger placements where more process detail is useful.
  - The file-like container and ordered rows emphasize auditability, repeatability, and backend preparation work before Beancount ledger handoff.

## Palette

- Ink: `#18312B`
- Process green: `#2C6B5B`
- Muted green: `#53786E`
- Review amber: `#D5A23F`
- Neutral line: `#8A9A96`
- Surface: `#F7F9F8`
- Border: `#D9E0DD`
- Row fill: `#E8EEEB`

The palette avoids bright fintech gradients and dashboard-style chart colors. Green is used as an operational signal, amber as a review/staging signal, and dark ink as the deterministic ledger endpoint.

## Positioning Fit

FinTrack 2.0 is a self-hosted Beancount ingestion, preparation, and data-cleaning hub. These marks focus on raw import to staging/normalization to ledger handoff. The geometry is ordered and auditable, with visible inputs, routing, and outputs. Nothing suggests spending categories, portfolio growth, bank cards, or a Fava replacement UI.
