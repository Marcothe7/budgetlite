const fs       = require('fs');
const path     = require('path');
const csv      = require('csv-parser');
const iconv    = require('iconv-lite');
const chardet  = require('chardet');
const { Readable } = require('stream');

const CSV_PATH = path.join(__dirname, '..', '..', 'data', 'transactions.csv');
const HEADER   = 'date,description,amount,category';

// ── Encoding detection ────────────────────────────────────────────────────────

function decodeBuffer(buffer) {
  const detected = chardet.detect(buffer);
  const encoding = (detected && iconv.encodingExists(detected)) ? detected : 'utf-8';
  return iconv.decode(buffer, encoding);
}

// ── Date normalisation ────────────────────────────────────────────────────────

function normalizeDate(raw) {
  const s = raw.trim();
  const ddmmyyyy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`;
  }
  return s;
}

// ── CSV serialisation ─────────────────────────────────────────────────────────

function escCsv(val) {
  const s = String(val);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowToCsv({ date, description, amount, category }) {
  return [escCsv(date), escCsv(description), escCsv(amount), escCsv(category)].join(',');
}

// ── Shared row parser ─────────────────────────────────────────────────────────

function parseStream(source, assignIds = false) {
  return new Promise((resolve, reject) => {
    const results = [];
    let idx = 0;
    source
      .pipe(csv({ mapHeaders: ({ header }) => header.trim() }))
      .on('data', row => {
        const amount = parseFloat(row.amount);
        if (!row.date || !row.description || isNaN(amount) || !row.category) return;
        const t = {
          date:        normalizeDate(row.date),
          description: row.description.trim(),
          amount,
          category:    row.category.trim(),
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

function appendTransaction({ date, description, amount, category }) {
  const row = rowToCsv({ date, description, amount, category });
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
