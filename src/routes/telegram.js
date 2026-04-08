const express = require('express');
const { parseMessage } = require('../services/telegramParser');
const { sendMessage, getFile, downloadFile, setWebhook } = require('../services/telegramService');
const { parseCSVBuffer } = require('../services/csvService');
const {
  readTransactions, appendTransaction, mergeTransactions, clearAllTransactions,
} = require('../services/supabaseService');
const config = require('../config/app.config');

const router = express.Router();

// ── Security gate helper ──────────────────────────────────────────────────────

function isAllowed(chatId) {
  const allowed = process.env.TELEGRAM_CHAT_ID;
  if (!allowed) return false; // deny all if env var not set
  return String(chatId) === String(allowed);
}

// ── One-time webhook registration ─────────────────────────────────────────────
// Visit GET /api/telegram/setup once after deploying to register the webhook URL.

router.get('/setup', async (req, res) => {
  try {
    const webhookUrl = `https://${req.headers.host}/api/telegram`;
    const result     = await setWebhook(webhookUrl);
    res.json({ webhookUrl, telegram: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Webhook receiver ──────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  // Always respond 200 immediately so Telegram doesn't retry
  res.sendStatus(200);

  const update  = req.body || {};
  const message = update.message || update.edited_message;
  if (!message) return;

  const chatId = message.chat.id;
  if (!isAllowed(chatId)) return;

  try {
    if (message.document) {
      await handleDocument(message, chatId);
    } else if (message.text) {
      await handleText(message.text, chatId);
    }
  } catch (err) {
    console.error('Telegram handler error:', err.message);
    await sendMessage(chatId, `Error: ${err.message}`).catch(() => {});
  }
});

// ── Text dispatcher ───────────────────────────────────────────────────────────

async function handleText(text, chatId) {
  const parsed = parseMessage(text);

  if (parsed.type === 'command') {
    switch (parsed.command) {
      case '/balance': return handleBalance(chatId);
      case '/list':    return handleList(chatId);
      case '/clear':   return handleClear(parsed.args, chatId);
      case '/add':     return handleAdd(parsed.args, 'expense', chatId);
      case '/income':  return handleAdd(parsed.args, 'income', chatId);
      case '/start':
      case '/help':    return handleHelp(chatId);
      default:
        return sendMessage(chatId, `Unknown command. Type /help for usage.`);
    }
  }

  if (parsed.type === 'expense' || parsed.type === 'income') {
    return handleSmartEntry(parsed, chatId);
  }

  return sendMessage(chatId,
    `I didn't understand that.\n\nTry: <code>150 food lunch</code>\nOr type /help`
  );
}

// ── Command handlers ──────────────────────────────────────────────────────────

async function handleBalance(chatId) {
  const now   = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const all   = await readTransactions();
  const tx    = all.filter(t => t.date.startsWith(month));
  const cur   = config.currency;

  const income   = tx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expenses = tx.filter(t => t.type !== 'income').reduce((s, t) => s + t.amount, 0);
  const net      = income - expenses;
  const sign     = net >= 0 ? '+' : '';

  await sendMessage(chatId,
    `<b>Balance — ${month}</b>\n\n` +
    `Income:   ${cur}${income.toFixed(2)}\n` +
    `Expenses: ${cur}${expenses.toFixed(2)}\n` +
    `Net:      ${sign}${cur}${Math.abs(net).toFixed(2)}\n` +
    `Transactions: ${tx.length}`
  );
}

async function handleList(chatId) {
  const all  = await readTransactions();
  const last = all.slice(-10).reverse();
  const cur  = config.currency;

  if (last.length === 0) {
    return sendMessage(chatId, 'No transactions yet.');
  }

  const lines = last.map(t => {
    const sign = t.type === 'income' ? '+' : '-';
    return `${t.date}  ${sign}${cur}${Number(t.amount).toFixed(2)}  ${t.category}  ${t.description}`;
  });

  await sendMessage(chatId,
    `<b>Last ${last.length} transactions:</b>\n<pre>${lines.join('\n')}</pre>`
  );
}

async function handleClear(args, chatId) {
  if (args[0] !== 'CONFIRM') {
    return sendMessage(chatId,
      '⚠️ This will delete <b>ALL</b> transactions.\n\nTo confirm, send:\n<code>/clear CONFIRM</code>'
    );
  }
  await clearAllTransactions();
  await sendMessage(chatId, 'All transactions deleted.');
}

async function handleAdd(args, type, chatId) {
  // /add 150 Food Grocery shopping  →  args = ['150', 'Food', 'Grocery', 'shopping']
  if (args.length === 0) {
    const example = type === 'income'
      ? '/income 3500 Salary'
      : '/add 150 Food Grocery shopping';
    return sendMessage(chatId, `Usage: <code>${example}</code>`);
  }

  const amount = parseFloat(args[0].replace(/,/g, ''));
  if (isNaN(amount) || amount <= 0) {
    return sendMessage(chatId, 'First argument must be a positive number.');
  }

  const category    = args[1] || (type === 'income' ? 'Salary' : 'Uncategorized');
  const description = args.slice(2).join(' ') || category;
  const date        = new Date().toISOString().slice(0, 10);

  await appendTransaction({ date, description, amount, category, type, recurring: false });

  const cur = config.currency;
  await sendMessage(chatId,
    `Saved ${type === 'income' ? 'income' : 'expense'}: ` +
    `${cur}${amount.toFixed(2)} — ${description} [${category}]`
  );
}

async function handleSmartEntry(parsed, chatId) {
  if (!parsed.amount) {
    return sendMessage(chatId, 'Could not parse amount. Try: <code>150 food lunch</code>');
  }

  await appendTransaction({
    date:        parsed.date,
    description: parsed.description,
    amount:      parsed.amount,
    category:    parsed.category,
    type:        parsed.type,
    recurring:   false,
  });

  const cur  = config.currency;
  const sign = parsed.type === 'income' ? '+' : '-';
  await sendMessage(chatId,
    `Saved: ${sign}${cur}${parsed.amount.toFixed(2)} — ${parsed.description} [${parsed.category}]`
  );
}

async function handleHelp(chatId) {
  const cur = config.currency;
  await sendMessage(chatId,
    `<b>BudgetLite Bot</b>\n\n` +
    `<b>Quick add (just type):</b>\n` +
    `<code>150 food lunch at cafe</code>\n` +
    `<code>85.5 transport uber</code>\n` +
    `<code>3500 salary</code>\n\n` +
    `<b>Commands:</b>\n` +
    `/balance — this month's summary\n` +
    `/list — last 10 transactions\n` +
    `/add ${cur}150 Food Grocery — add expense\n` +
    `/income ${cur}3500 Salary — add income\n` +
    `/clear CONFIRM — delete ALL transactions\n` +
    `/help — show this message\n\n` +
    `<b>Bulk import:</b>\n` +
    `Send a <code>.csv</code> file to import many transactions at once.\n` +
    `CSV columns: <code>date,description,amount,category</code>`
  );
}

// ── CSV document handler ──────────────────────────────────────────────────────

async function handleDocument(message, chatId) {
  const doc = message.document;

  if (!doc.file_name.toLowerCase().endsWith('.csv')) {
    return sendMessage(chatId, 'Please send a .csv file.');
  }

  await sendMessage(chatId, 'Importing CSV...');

  const fileInfo = await getFile(doc.file_id);
  const buffer   = await downloadFile(fileInfo.file_path);
  const rows     = await parseCSVBuffer(buffer);

  if (rows.length === 0) {
    return sendMessage(chatId,
      'No valid rows found in the CSV.\n' +
      'Required columns: <code>date, description, amount, category</code>'
    );
  }

  const result = await mergeTransactions(rows);
  await sendMessage(chatId,
    `CSV imported.\nNew rows added: ${result.added}\nTotal transactions: ${result.total}`
  );
}

module.exports = router;
