# Anayo 5PS Enterprises — Sales & Inventory

Live app: https://okiejoedev.github.io/shoptrack/

An offline-first point of sale, inventory and back-office system built by **Chada Digital**.

## Features
- **Dashboard**: revenue, gross and net profit, payment mix, top products, busiest hours, branch and staff comparison, smart reorder suggestions
- **Point of sale (works offline)**: search or scan SKUs, discounts (cashiers capped at 10%), customers, cash change, transfer, POS, credit and part-payment, printable and WhatsApp receipts
- **Inventory**: multi-branch stock, categories, margins, stock history ledger, stock counts and adjustments, transfers between branches, Excel export
- **Purchasing**: suppliers, purchase orders (drafts, ordered, received), receiving into stock with weighted-average cost, supplier balances and payments, PO PDF and WhatsApp
- **Customers & debtors**: credit limits, balances, payments, statements, WhatsApp reminders
- **Expenses**: categories, per branch, feeds the P&L
- **Reports**: profit & loss, sales by item, stock valuation, staff performance (Excel + PDF)
- **Staff & roles**: owner, manager, cashier (branch-locked), activity log
- **Offline mode**: an installable PWA. Sales, restocks, new customers and debtor payments queue on the device and sync automatically; the server de-duplicates retries.

## Stack
- Front end: vanilla JS + Vite + vite-plugin-pwa (`src-app/`)
- Back end: Supabase (Postgres, row-level security, RPC functions, `manage-staff` edge function)

## Develop
```bash
npm install
npx vite --config vite.config.js        # dev server
npx vite build                           # builds to dist/
```
The published site is the contents of `dist/` at the repo root (GitHub Pages, main branch, root).
