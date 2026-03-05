const express = require('express');
const fs      = require('fs');
const path    = require('path');
const multer  = require('multer');
const {
  readTransactions, parseCSVBuffer, appendTransaction,
  deleteTransaction, updateTransaction, mergeTransactions, CSV_PATH,
} = require('../services/csvService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const BUDGETS_PATH = path.join(__dirname, '..', '..', 'data', 'budgets.json');

const COLOR_PALETTE = [
  '#6366f1', '#22d3ee', '#f59e0b', '#10b981', '#f43f5e', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#84cc16', '#06b6d4', '#a855f7',
  '#ef4444', '#3b82f6', '#eab308', '#22c55e', '#d946ef', '#0ea5e9',
  '#fb923c', '#4ade80',
];

function categoryColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return COLOR_PALETTE[hash % COLOR_PALETTE.length];
}

function filterByMonth(transactions, month) {
  if (!month) return transactions;
  return transactions.filter(t => t.date.startsWith(month));
}

function handleError(res, err) {
  console.error(err.message);
  res.status(500).json({ error: err.message });
}

function readBudgets() {
  if (!fs.existsSync(BUDGETS_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(BUDGETS_PATH, 'utf-8')); }
  catch { return {}; }
}

function writeBudgets(data) {
  fs.writeFileSync(BUDGETS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ── GET /api/months ───────────────────────────────────────────────────────────
router.get('/months', async (req, res) => {
  try {
    const transactions = await readTransactions();
    const seen = new Set();
    transactions.forEach(t => seen.add(t.date.slice(0, 7)));

    const months = [...seen]
      .sort((a, b) => b.localeCompare(a))
      .map(value => ({
        value,
        label: new Date(`${value}-01`).toLocaleDateString('en-US', {
          month: 'long', year: 'numeric',
        }),
      }));

    res.json(months);
  } catch (err) { handleError(res, err); }
});

// ── GET /api/summary?month=YYYY-MM ────────────────────────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const all  = await readTransactions();
    const transactions = filterByMonth(all, req.query.month);

    if (transactions.length === 0) {
      return res.json({ totalExpenses: 0, transactionCount: 0, highestExpense: 0, avgDailyExpense: 0 });
    }

    const total   = transactions.reduce((s, t) => s + t.amount, 0);
    const highest = Math.max(...transactions.map(t => t.amount));
    const days    = new Set(transactions.map(t => t.date)).size;

    res.json({
      totalExpenses:    +total.toFixed(2),
      transactionCount: transactions.length,
      highestExpense:   +highest.toFixed(2),
      avgDailyExpense:  +(total / days).toFixed(2),
    });
  } catch (err) { handleError(res, err); }
});

// ── GET /api/daily?month=YYYY-MM ──────────────────────────────────────────────
router.get('/daily', async (req, res) => {
  try {
    const all  = await readTransactions();
    const transactions = filterByMonth(all, req.query.month);
    const map  = {};
    transactions.forEach(t => { map[t.date] = (map[t.date] || 0) + t.amount; });

    const daily = Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ date, amount: +amount.toFixed(2) }));

    res.json(daily);
  } catch (err) { handleError(res, err); }
});

// ── GET /api/categories?month=YYYY-MM ─────────────────────────────────────────
router.get('/categories', async (req, res) => {
  try {
    const all  = await readTransactions();
    const transactions = filterByMonth(all, req.query.month);
    const map  = {};
    transactions.forEach(t => { map[t.category] = (map[t.category] || 0) + t.amount; });

    const categories = Object.entries(map).map(([category, amount]) => ({
      category,
      amount: +amount.toFixed(2),
      color:  categoryColor(category),
    }));

    res.json(categories);
  } catch (err) { handleError(res, err); }
});

// ── GET /api/transactions?month=YYYY-MM ───────────────────────────────────────
router.get('/transactions', async (req, res) => {
  try {
    const all  = await readTransactions();
    res.json(filterByMonth(all, req.query.month));
  } catch (err) { handleError(res, err); }
});

// ── POST /api/transactions ────────────────────────────────────────────────────
router.post('/transactions', async (req, res) => {
  const { date, description, amount, category } = req.body || {};
  if (!date || !description || !category) {
    return res.status(400).json({ error: 'date, description, and category are required.' });
  }
  const amt = parseFloat(amount);
  if (isNaN(amt)) return res.status(400).json({ error: 'amount must be a number.' });
  try {
    appendTransaction({ date, description, amount: amt, category });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// ── DELETE /api/transactions/:id ──────────────────────────────────────────────
router.delete('/transactions/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    await deleteTransaction(id);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// ── PUT /api/transactions/:id ─────────────────────────────────────────────────
router.put('/transactions/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id.' });
  const { date, description, amount, category } = req.body || {};
  if (!date || !description || !category) {
    return res.status(400).json({ error: 'date, description, and category are required.' });
  }
  const amt = parseFloat(amount);
  if (isNaN(amt)) return res.status(400).json({ error: 'amount must be a number.' });
  try {
    await updateTransaction(id, { date, description, amount: amt, category });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// ── GET /api/budgets ──────────────────────────────────────────────────────────
router.get('/budgets', (req, res) => {
  res.json(readBudgets());
});

// ── POST /api/budgets ─────────────────────────────────────────────────────────
router.post('/budgets', (req, res) => {
  const data = req.body;
  if (typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ error: 'Expected an object { category: amount }' });
  }
  try {
    writeBudgets(data);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// ── POST /api/upload ──────────────────────────────────────────────────────────
// Merges uploaded CSV with existing data — duplicates are skipped.
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided.' });
  if (!req.file.originalname.toLowerCase().endsWith('.csv')) {
    return res.status(400).json({ error: 'File must have a .csv extension.' });
  }
  try {
    const newRows = await parseCSVBuffer(req.file.buffer);
    if (newRows.length === 0) {
      return res.status(400).json({
        error: 'No valid rows found. Required columns: date, description, amount, category',
      });
    }
    const result = await mergeTransactions(newRows);
    res.json({ success: true, rows: result.total, added: result.added });
  } catch (err) {
    res.status(400).json({ error: `Invalid CSV: ${err.message}` });
  }
});

module.exports = router;
