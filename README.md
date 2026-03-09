# BudgetLite

A lightweight, personal budget dashboard built with **Node.js + Express** and **vanilla JavaScript**. Track expenses and income, set budget goals, and visualise spending trends — all from a single CSV file.

![BudgetLite screenshot](https://via.placeholder.com/900x500?text=BudgetLite+Dashboard)

---

## Features

- 📊 Overview with summary cards, daily expense chart, and category pie chart
- 📋 Transactions table — sortable, filterable, editable
- 🏷️ One-click category switching directly on the transaction row
- 🎯 Budget goals with progress bars per category
- 📈 Monthly trend comparison and category comparison charts
- 💰 Income tracking (month-only entry, no category needed)
- 📤 CSV upload with automatic deduplication and merge
- 🌙 Dark mode
- 🖨️ Print / Export PDF report

---

## Quick Start (Local)

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/mini-budget-dashboard.git
cd mini-budget-dashboard

# 2. Install dependencies
npm install

# 3. Start the server
npm start
# → Open http://localhost:3000
```

The app loads with sample data out of the box. Replace it with your own data (see below).

---

## Plug In Your Own Data

### 1. Transactions (`data/transactions.csv`)

Replace the sample file with your own CSV. Format:

```
date,description,amount,category,type,recurring
2026-01-05,Grocery Store,84.50,Food,expense,0
2026-01-01,Monthly Salary,3500.00,-,income,1
```

| Column | Required | Description |
|--------|----------|-------------|
| `date` | ✅ | `YYYY-MM-DD` (also accepts `DD/MM/YYYY` and `DD.MM.YY`) |
| `description` | ✅ | Free text |
| `amount` | ✅ | Positive number |
| `category` | — | Leave blank to auto-infer (configure rules in `app.config.js`) |
| `type` | — | `expense` (default) or `income` |
| `recurring` | — | `1` = monthly recurring, `0` = one-time |

See `sample-data.json` in the root for a complete format reference.

> **Tip:** You can also drag-and-drop a CSV file onto the "Upload CSV" button in the app to merge new data without replacing existing records.

### 2. Budget Goals (`data/budgets.json`)

Set monthly spending limits per category:

```json
{
  "Food": 400,
  "Dining": 200,
  "Utilities": 150
}
```

The Reports page will show a progress bar and alert when you exceed a limit.

### 3. App Settings (`src/config/app.config.js`)

Edit this file to change the app name, currency symbol, or category auto-inference rules:

```js
module.exports = {
  appName:  'My Budget',   // shown in the tab title and sidebar
  currency: '€',           // prefix on all amounts
  port:     3000,

  categoryInferenceRules: [
    { keyword: 'AMAZON',  category: 'Shopping'       },
    { keyword: 'NETFLIX', category: 'Entertainment'  },
  ],
};
```

Or set environment variables instead of editing the file:

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_NAME` | App display name | `BudgetLite` |
| `CURRENCY` | Currency symbol | `$` |
| `PORT` | HTTP port | `3000` |

---

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/mini-budget-dashboard)

**Or manually:**

1. Push your repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import your repo
3. Leave all settings as-is (Vercel auto-detects Node.js)
4. Optionally add environment variables (`APP_NAME`, `CURRENCY`) in the Vercel dashboard
5. Click **Deploy**

> ⚠️ **Important:** Vercel's serverless filesystem is **ephemeral** — changes made via the UI (add/edit/delete transactions, upload CSV) will not persist between deployments. For a fully persistent deployment, replace the CSV/JSON data layer with a database such as [Supabase](https://supabase.com), [PlanetScale](https://planetscale.com), or [Vercel KV](https://vercel.com/docs/storage/vercel-kv).

---

## Project Structure

```
mini-budget-dashboard/
├── data/
│   ├── transactions.csv      ← your transaction data (replace with your own)
│   └── budgets.json          ← monthly budget limits per category
├── src/
│   ├── config/
│   │   └── app.config.js     ← currency, app name, port, inference rules
│   ├── routes/api.js         ← REST API endpoints
│   ├── services/csvService.js← CSV read/write/merge
│   └── server.js             ← Express entry point
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/dashboard.js
├── sample-data.json          ← data format reference
├── vercel.json               ← Vercel deployment config
└── README.md
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config` | App config (name, currency, palette) |
| `GET` | `/api/months` | Available months |
| `GET` | `/api/summary?month=YYYY-MM` | Summary totals + trends |
| `GET` | `/api/daily?month=YYYY-MM` | Daily expense aggregates |
| `GET` | `/api/categories?month=YYYY-MM` | Category totals with colors |
| `GET` | `/api/transactions?month=YYYY-MM` | All transaction rows |
| `POST` | `/api/transactions` | Add a transaction |
| `PUT` | `/api/transactions/:id` | Edit a transaction |
| `DELETE` | `/api/transactions/:id` | Delete a transaction |
| `POST` | `/api/upload` | Upload & merge a CSV file |
| `GET/POST` | `/api/budgets` | Read / save budget goals |
| `PUT` | `/api/categories/rename` | Rename a category across all transactions |

All `?month=` params also accept `?from=YYYY-MM-DD&to=YYYY-MM-DD` for a custom date range.

---

## License

MIT
