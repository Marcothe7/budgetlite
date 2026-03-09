const fs       = require('fs');
const path     = require('path');
const csv      = require('csv-parser');
const iconv    = require('iconv-lite');
const chardet  = require('chardet');
const { Readable } = require('stream');
const config   = require('../config/app.config');

const CSV_PATH = path.join(__dirname, '..', '..', 'data', 'transactions.csv');
const HEADER   = 'date,description,amount,category,type,recurring';

// ── Encoding detection ────────────────────────────────────────────────────────

function decodeBuffer(buffer) {
  const detected = chardet.detect(buffer);
  const encoding = (detected && iconv.encodingExists(detected)) ? detected : 'utf-8';
  return iconv.decode(buffer, encoding);
}

// ── Date normalisation ────────────────────────────────────────────────────────

function normalizeDate(raw) {
  const s = raw.trim();
  // DD/MM/YYYY (slashes, 4-digit year)
  const a = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (a) return `${a[3]}-${a[2].padStart(2,'0')}-${a[1].padStart(2,'0')}`;
  // DD.MM.YYYY (dots, 4-digit year)
  const b = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (b) return `${b[3]}-${b[2].padStart(2,'0')}-${b[1].padStart(2,'0')}`;
  // DD.MM.YY (dots, 2-digit year → 20YY)
  const c = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/);
  if (c) return `20${c[3]}-${c[2].padStart(2,'0')}-${c[1].padStart(2,'0')}`;
  return s; // YYYY-MM-DD passes through unchanged
}

// ── Category inference for rows with no category ──────────────────────────────
// Rules are defined in src/config/app.config.js → categoryInferenceRules

function inferCategory(desc) {
  const d = (desc || '').toUpperCase();
  for (const rule of config.categoryInferenceRules) {
    if (d.includes(rule.keyword.toUpperCase())) return rule.category;
  }
  return 'Uncategorized';
}

// ── CSV serialisation ─────────────────────────────────────────────────────────

function escCsv(val) {
  const s = String(val);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowToCsv({ date, description, amount, category, type = 'expense', recurring = false }) {
  return [
    escCsv(date), escCsv(description), escCsv(amount),
    escCsv(category), escCsv(type), escCsv(recurring ? '1' : '0'),
  ].join(',');
}

// ── Shared row parser ─────────────────────────────────────────────────────────
// Handles both the old 4-column format (date,description,amount,category)
// and the new 6-column format (+ type, recurring) — old rows default gracefully.

function parseStream(source, assignIds = false) {
  return new Promise((resolve, reject) => {
    const results = [];
    let idx = 0;
    source
      .pipe(csv({ mapHeaders: ({ header }) => header.trim() }))
      .on('data', row => {
        const amount = parseFloat(row.amount);
        if (!row.date || !row.description || isNaN(amount)) return;
        const rawCat = row.category?.trim() || '';
        const t = {
          date:        normalizeDate(row.date),
          description: row.description.trim(),
          amount,
          category:    rawCat || inferCategory(row.description),
          type:        ['income', 'expense'].includes(row.type?.trim()) ? row.type.trim() : 'expense',
          recurring:   row.recurring === '1' || row.recurring === 'true',
        };
        if (assignIds) t.id = idx++;
        results.push(t);
      })
      .on('end',   () => resolve(results))
      .on('error', reject);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

function readTransactions() {
  if (!fs.existsSync(CSV_PATH)) {
    return Promise.reject(new Error(`CSV file not found: ${CSV_PATH}`));
  }
  const buffer = fs.readFileSync(CSV_PATH);
  return parseStream(Readable.from(decodeBuffer(buffer)), true);
}

function parseCSVBuffer(buffer) {
  return parseStream(Readable.from(decodeBuffer(buffer)));
}

function writeCsv(transactions) {
  const lines = [HEADER, ...transactions.map(rowToCsv)];
  fs.writeFileSync(CSV_PATH, lines.join('\n'), 'utf-8');
}

function appendTransaction({ date, description, amount, category, type = 'expense', recurring = false }) {
  const row = rowToCsv({ date, description, amount, category, type, recurring });
  fs.appendFileSync(CSV_PATH, '\n' + row, 'utf-8');
}

async function deleteTransaction(id) {
  const all = await readTransactions();
  writeCsv(all.filter(t => t.id !== id));
}

async function updateTransaction(id, data) {
  const all = await readTransactions();
  const updated = all.map(t => t.id === id ? { ...t, ...data } : t);
  writeCsv(updated);
}

async function mergeTransactions(newRows) {
  const existing = await readTransactions();
  const fingerprints = new Set(
    existing.map(t => `${t.date}|${t.description}|${t.amount}|${t.category}`)
  );
  let added = 0;
  for (const row of newRows) {
    const fp = `${row.date}|${row.description}|${row.amount}|${row.category}`;
    if (!fingerprints.has(fp)) {
      fingerprints.add(fp);
      existing.push(row);
      added++;
    }
  }
  existing.sort((a, b) => a.date.localeCompare(b.date));
  writeCsv(existing);
  return { total: existing.length, added };
}

module.exports = {
  readTransactions, parseCSVBuffer, appendTransaction,
  deleteTransaction, updateTransaction, mergeTransactions,
  writeCsv, CSV_PATH,
};
