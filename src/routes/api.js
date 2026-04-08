const express = require('express');
const multer  = require('multer');
const config  = require('../config/app.config');
const { parseCSVBuffer } = require('../services/csvService');
const {
  readTransactions, appendTransaction, deleteTransaction,
  updateTransaction, mergeTransactions, renameCategory,
  readBudgets, writeBudgets,
} = require('../services/supabaseService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const COLOR_PALETTE = config.colorPalette;

// Mount Telegram bot router
router.use('/telegram', require('./telegram'));

function categoryColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return COLOR_PALETTE[hash % COLOR_PALETTE.length];
}

// Supports both ?month=YYYY-MM and ?from=YYYY-MM-DD&to=YYYY-MM-DD
function filterByRange(transactions, query) {
  if (query.from && query.to) {
    return transactions.filter(t => t.date >= query.from && t.date <= query.to);
  }
  if (query.month) {
    return transactions.filter(t => t.date.startsWith(query.month));
  }
  return transactions;
}

function getPrevMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

function handleError(res, err) {
  console.error(err.message);
  res.status(500).json({ error: err.message });
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

// ── GET /api/summary?month=YYYY-MM  or  ?from=&to= ───────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const all          = await readTransactions();
    const transactions = filterByRange(all, req.query);

    const expenses = transactions.filter(t => t.type !== 'income');
    const incomes  = transactions.filter(t => t.type === 'income');

    const totalExpenses = +expenses.reduce((s, t) => s + t.amount, 0).toFixed(2);
    const totalIncome   = +incomes.reduce((s, t) => s + t.amount, 0).toFixed(2);
    const netBalance    = +(totalIncome - totalExpenses).toFixed(2);
    const highest       = expenses.length ? +Math.max(...expenses.map(t => t.amount)).toFixed(2) : 0;
    const days          = expenses.length ? new Set(expenses.map(t => t.date)).size : 1;
    const avgDaily      = expenses.length ? +(totalExpenses / days).toFixed(2) : 0;

    // Trend vs previous month (only when month filter is active)
    let trend = null;
    if (req.query.month) {
      const prev     = getPrevMonth(req.query.month);
      const prevTx   = all.filter(t => t.date.startsWith(prev));
      const prevExp  = +prevTx.filter(t => t.type !== 'income').reduce((s, t) => s + t.amount, 0).toFixed(2);
      const prevInc  = +prevTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0).toFixed(2);
      const prevCnt  = prevTx.length;

      trend = {
        expenses: prevExp  > 0 ? +((totalExpenses - prevExp) / prevExp * 100).toFixed(1) : null,
        income:   prevInc  > 0 ? +((totalIncome   - prevInc) / prevInc  * 100).toFixed(1) : null,
        count:    prevCnt  > 0 ? +((transactions.length - prevCnt) / prevCnt * 100).toFixed(1) : null,
      };
    }

    res.json({ totalExpenses, totalIncome, netBalance, transactionCount: transactions.length, highestExpense: highest, avgDailyExpense: avgDaily, trend });
  } catch (err) { handleError(res, err); }
});

// ── GET /api/daily?month=YYYY-MM  or  ?from=&to= ─────────────────────────────
router.get('/daily', async (req, res) => {
  try {
    const all          = await readTransactions();
    const transactions = filterByRange(all, req.query);
    const map          = {};
    transactions.filter(t => t.type !== 'income')
      .forEach(t => { map[t.date] = (map[t.date] || 0) + t.amount; });

    const daily = Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ date, amount: +amount.toFixed(2) }));

    res.json(daily);
  } catch (err) { handleError(res, err); }
});

// ── GET /api/categories?month=YYYY-MM  or  ?from=&to= ────────────────────────
router.get('/categories', async (req, res) => {
  try {
    const all          = await readTransactions();
    const transactions = filterByRange(all, req.query);
    const map          = {};
    transactions.filter(t => t.type !== 'income')
      .forEach(t => { map[t.category] = (map[t.category] || 0) + t.amount; });

    const categories = Object.entries(map).map(([category, amount]) => ({
      category,
      amount: +amount.toFixed(2),
      color:  categoryColor(category),
    }));

    res.json(categories);
  } catch (err) { handleError(res, err); }
});

// ── GET /api/transactions?month=YYYY-MM  or  ?from=&to= ──────────────────────
router.get('/transactions', async (req, res) => {
  try {
    const all = await readTransactions();
    res.json(filterByRange(all, req.query));
  } catch (err) { handleError(res, err); }
});

// ── POST /api/transactions ────────────────────────────────────────────────────
router.post('/transactions', async (req, res) => {
  const { date, description, amount, category, type = 'expense', recurring = false } = req.body || {};
  if (!date || !description || !category) {
    return res.status(400).json({ error: 'date, description, and category are required.' });
  }
  const amt = parseFloat(amount);
  if (isNaN(amt)) return res.status(400).json({ error: 'amount must be a number.' });
  try {
    await appendTransaction({ date, description, amount: amt, category, type, recurring: !!recurring });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// ── DELETE /api/transactions/:id ──────────────────────────────────────────────
router.delete('/transactions/:id', async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'Invalid id.' });
  try {
    await deleteTransaction(id);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// ── PUT /api/transactions/:id ─────────────────────────────────────────────────
router.put('/transactions/:id', async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'Invalid id.' });
  const { date, description, amount, category, type = 'expense', recurring = false } = req.body || {};
  if (!date || !description || !category) {
    return res.status(400).json({ error: 'date, description, and category are required.' });
  }
  const amt = parseFloat(amount);
  if (isNaN(amt)) return res.status(400).json({ error: 'amount must be a number.' });
  try {
    await updateTransaction(id, { date, description, amount: amt, category, type, recurring: !!recurring });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// ── GET /api/budgets ──────────────────────────────────────────────────────────
router.get('/budgets', async (req, res) => {
  try {
    res.json(await readBudgets());
  } catch (err) { handleError(res, err); }
});

// ── POST /api/budgets ─────────────────────────────────────────────────────────
router.post('/budgets', async (req, res) => {
  const data = req.body;
  if (typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ error: 'Expected an object { category: amount }' });
  }
  try {
    await writeBudgets(data);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// ── POST /api/upload ──────────────────────────────────────────────────────────
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

// ── GET /api/config ───────────────────────────────────────────────────────────
router.get('/config', (req, res) => {
  res.json({
    appName:      config.appName,
    currency:     config.currency,
    colorPalette: config.colorPalette,
  });
});

// ── PUT /api/categories/rename ────────────────────────────────────────────────
router.put('/categories/rename', async (req, res) => {
  const { from, to } = req.body || {};
  if (!from || !to) return res.status(400).json({ error: 'from and to are required.' });
  try {
    await renameCategory(from, to);
    res.json({ ok: true });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
