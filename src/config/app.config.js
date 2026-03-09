/**
 * app.config.js — Central configuration for BudgetLite
 *
 * To customise the app, edit the values below OR set environment variables:
 *   APP_NAME   — display name shown in the browser tab and sidebar
 *   CURRENCY   — currency symbol prefixed to every amount (e.g. '$', '€', '£', '₪')
 *   PORT       — HTTP port (default: 3000)
 */
module.exports = {
  appName:  process.env.APP_NAME  || 'BudgetLite',
  currency: process.env.CURRENCY  || '$',
  port:     parseInt(process.env.PORT, 10) || 3000,

  // ── Category color palette ────────────────────────────────────────────────
  // 20 colors used for category badges; each category gets a consistent color
  // derived from its name via a hash function. You can reorder or replace these.
  colorPalette: [
    '#6366f1', '#22d3ee', '#f59e0b', '#10b981', '#f43f5e', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#84cc16', '#06b6d4', '#a855f7',
    '#ef4444', '#3b82f6', '#eab308', '#22c55e', '#d946ef', '#0ea5e9',
    '#fb923c', '#4ade80',
  ],

  // ── Auto-categorization rules ─────────────────────────────────────────────
  // When a transaction has no category, the app checks the description against
  // these rules (case-insensitive). First match wins; falls back to 'Uncategorized'.
  //
  // Uncomment and add your own rules:
  categoryInferenceRules: [
    // { keyword: 'AMAZON',   category: 'Shopping'       },
    // { keyword: 'NETFLIX',  category: 'Entertainment'  },
    // { keyword: 'UBER',     category: 'Transport'      },
    // { keyword: 'SPOTIFY',  category: 'Entertainment'  },
    // { keyword: 'STARBUCKS',category: 'Dining'         },
  ],
};
