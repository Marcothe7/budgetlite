# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # install dependencies
npm start         # start server on port 3000
npm run dev       # start with nodemon (auto-reload)
```

Server runs at `http://localhost:3000`.

## Architecture

```
mini-budget-dashboard/
├── data/
│   └── transactions.csv        # Active data source (replaced via Upload CSV UI)
├── src/
│   ├── server.js               # Express app: mounts /api router + serves public/
│   ├── routes/
│   │   └── api.js              # All REST endpoints + file upload handler
│   └── services/
│       └── csvService.js       # CSV parsing (file & buffer), exports CSV_PATH
└── public/
    ├── index.html              # Layout: topbar with month picker + upload button, modal
    ├── css/style.css           # All styles including modal, drop zone, month picker
    └── js/
        └── dashboard.js        # State (currentMonth), fetch, render, upload handler
```

## API Endpoints

| Method | Path | Query | Description |
|---|---|---|---|
| GET | `/api/months` | — | Available months in CSV, newest first |
| GET | `/api/summary` | `?month=YYYY-MM` | Totals for the period |
| GET | `/api/daily` | `?month=YYYY-MM` | Daily aggregates, sorted by date |
| GET | `/api/categories` | `?month=YYYY-MM` | Category totals + colors |
| GET | `/api/transactions` | `?month=YYYY-MM` | Raw transaction rows |
| POST | `/api/upload` | — | Replace `transactions.csv` with uploaded file |

All `?month=` params are optional — omitting them returns data for all months.

## Data flow

```
transactions.csv
  → csvService.readTransactions()     parse CSV into Transaction[]
  → api.js filterByMonth()            optional YYYY-MM filter
  → JSON response
  → dashboard.js fetchAll(month)      parallel fetch of all 4 endpoints
  → renderSummaryCards / renderTable / renderBarChart / renderPieChart
```

## Key implementation details

**Month picker:** On load, `/api/months` populates the `<select>`. Changing it re-fetches all 4 endpoints with `?month=` and re-renders (charts are `.destroy()`-ed before recreation to prevent Chart.js leaks).

**Upload flow:** `POST /api/upload` (multipart, field name `file`) — validates the CSV via `parseCSVBuffer()` before writing to disk. Returns `{ rows: N }` on success or `{ error }` on failure. After success the frontend refreshes months and reloads the dashboard.

**CSV format:** `date, description, amount, category` — date must be `YYYY-MM-DD`, amount must be numeric. Rows failing validation are silently skipped.

**Category colors:** Defined in `CATEGORY_COLORS` in `api.js`. Unknown categories fall back to `#94a3b8`. Colors are injected into `/api/categories` — frontend never hardcodes them.

## CSV format

```
date,description,amount,category
2026-03-01,Grocery Store,84.50,Food
```
