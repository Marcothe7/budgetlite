const express = require('express');
const { parseMessage, parseDate, resolveCategory } = require('../services/telegramParser');
const { sendWithKeyboard, sendReply, getFile, downloadFile, setWebhook } = require('../services/telegramService');
const { getState, setState, clearState } = require('../services/botStateService');
const { parseCSVBuffer } = require('../services/csvService');
const { readTransactions, appendTransaction, mergeTransactions, clearAllTransactions } = require('../services/supabaseService');
const config = require('../config/app.config');

const router = express.Router();

// ── Security gate ─────────────────────────────────────────────────────────────

function isAllowed(chatId) {
  const allowed = process.env.TELEGRAM_CHAT_ID;
  if (!allowed) return false;
  return String(chatId) === String(allowed);
}

// ── Webhook setup (call once after deploy) ────────────────────────────────────

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
  const update  = req.body || {};
  const message = update.message || update.edited_message;

  if (!message) return res.sendStatus(200);

  const chatId = message.chat.id;
  if (!isAllowed(chatId)) return res.sendStatus(200);

  try {
    if (message.document) {
      await handleDocument(message, chatId);
    } else if (message.text) {
      await handleText(message.text, chatId);
    }
  } catch (err) {
    console.error('שגיאת בוט:', err.message);
    await sendWithKeyboard(chatId, `שגיאה: ${err.message}`).catch(() => {});
  }

  // Send 200 AFTER processing — Vercel kills the function on response,
  // so we must finish all async work before acknowledging Telegram.
  res.sendStatus(200);
});

// ── Main text dispatcher ──────────────────────────────────────────────────────

const DATE_TIMEOUT_MS = 20 * 1000; // 20 seconds

async function handleText(text, chatId) {
  const session = await getState(chatId);

  // Auto-save with today if user ignored the date prompt for >20 seconds
  if ((session.state === 'expense_date' || session.state === 'income_date') && session.updatedAt) {
    const age = Date.now() - new Date(session.updatedAt).getTime();
    if (age > DATE_TIMEOUT_MS) {
      await autoSaveWithToday(session.state, session.data, chatId);
      // Fall through to process the new message in idle mode
      return handleIdleText(text, chatId);
    }
  }

  // Active conversation flows take priority
  switch (session.state) {
    case 'expense_details': return handleExpenseDetails(text, chatId);
    case 'expense_date':    return handleExpenseDate(text, chatId, session.data);
    case 'income_details':  return handleIncomeDetails(text, chatId);
    case 'income_date':     return handleIncomeDate(text, chatId, session.data);
  }

  return handleIdleText(text, chatId);
}

async function handleIdleText(text, chatId) {
  // Menu buttons
  switch (text.trim()) {
    case 'הוצאה 💸':             return startExpenseFlow(chatId);
    case 'הכנסה 💰':             return startIncomeFlow(chatId);
    case 'יתרה 📊':              return handleBalance(chatId);
    case 'עסקאות אחרונות 📋':   return handleList(chatId);
  }

  // Slash commands
  const parsed = parseMessage(text);
  if (parsed.type === 'command') {
    switch (parsed.command) {
      case '/start':
      case '/help':    return handleHelp(chatId);
      case '/balance': return handleBalance(chatId);
      case '/list':    return handleList(chatId);
      case '/clear':   return handleClear(parsed.args, chatId);
      default:
        return sendWithKeyboard(chatId, 'פקודה לא מוכרת. השתמש בכפתורים למטה 👇');
    }
  }

  // Unknown input while idle
  await sendWithKeyboard(chatId, 'לא הבנתי. השתמש בכפתורים למטה 👇');
}

// Auto-save when user didn't answer the date prompt in time
async function autoSaveWithToday(state, data, chatId) {
  const date    = new Date().toISOString().slice(0, 10);
  const type    = state === 'expense_date' ? 'expense' : 'income';
  const typeHe  = type === 'expense' ? 'הוצאה' : 'הכנסה';
  await clearState(chatId);
  await appendTransaction({ date, description: data.description, amount: data.amount,
    category: data.category, type, recurring: false });
  const cur = config.currency;
  await sendReply(chatId,
    `⏱️ לא קיבלתי תאריך — שמרתי עם תאריך היום\n` +
    `✅ ${typeHe}: ${cur}${Number(data.amount).toFixed(2)} — ${data.description} [${data.category}]\n` +
    `תאריך: ${formatDate(date)}`
  );
}

// ── Expense flow ──────────────────────────────────────────────────────────────

async function startExpenseFlow(chatId) {
  await setState(chatId, 'expense_details');
  await sendReply(chatId,
    'כמה הוצאת? שלח: <code>סכום קטגוריה תיאור</code>\n' +
    'דוגמה: <code>150 אוכל קפה</code>'
  );
}

async function handleExpenseDetails(text, chatId) {
  const tokens = text.trim().replace(/^[₪$€£]/, '').replace(/,/g, '').split(/\s+/);
  const amount = parseFloat(tokens[0]);

  if (isNaN(amount) || amount <= 0) {
    return sendReply(chatId,
      'לא הצלחתי להבין את הסכום 😕\nנסה שוב: <code>150 אוכל קפה</code>'
    );
  }

  const category    = resolveCategory(tokens[1] || '');
  const description = tokens.slice(2).join(' ') || tokens[1] || category;

  await setState(chatId, 'expense_date', { amount, category, description });
  await sendReply(chatId,
    'מה התאריך?\n' +
    '• Enter / "היום" לתאריך היום\n' +
    '• פורמט: <code>21.2</code> לתאריך ספציפי'
  );
}

async function handleExpenseDate(text, chatId, data) {
  const date = parseDate(text);
  await clearState(chatId);
  await appendTransaction({
    date,
    description: data.description,
    amount:      data.amount,
    category:    data.category,
    type:        'expense',
    recurring:   false,
  });
  const cur = config.currency;
  await sendWithKeyboard(chatId,
    `✅ נשמר!\n` +
    `הוצאה: ${cur}${Number(data.amount).toFixed(2)} — ${data.description} [${data.category}]\n` +
    `תאריך: ${formatDate(date)}`
  );
}

// ── Income flow ───────────────────────────────────────────────────────────────

async function startIncomeFlow(chatId) {
  await setState(chatId, 'income_details');
  await sendReply(chatId,
    'כמה הכנסת? שלח: <code>סכום תיאור</code>\n' +
    'דוגמה: <code>3500 משכורת</code>'
  );
}

async function handleIncomeDetails(text, chatId) {
  const tokens = text.trim().replace(/^[₪$€£]/, '').replace(/,/g, '').split(/\s+/);
  const amount = parseFloat(tokens[0]);

  if (isNaN(amount) || amount <= 0) {
    return sendReply(chatId,
      'לא הצלחתי להבין את הסכום 😕\nנסה שוב: <code>3500 משכורת</code>'
    );
  }

  const description = tokens.slice(1).join(' ') || 'הכנסה';
  const category    = resolveCategory(tokens[1] || 'משכורת');

  await setState(chatId, 'income_date', { amount, category, description });
  await sendReply(chatId,
    'מה התאריך?\n' +
    '• Enter / "היום" לתאריך היום\n' +
    '• פורמט: <code>1.4</code> לתאריך ספציפי'
  );
}

async function handleIncomeDate(text, chatId, data) {
  const date = parseDate(text);
  await clearState(chatId);
  await appendTransaction({
    date,
    description: data.description,
    amount:      data.amount,
    category:    data.category,
    type:        'income',
    recurring:   false,
  });
  const cur = config.currency;
  await sendWithKeyboard(chatId,
    `✅ נשמר!\n` +
    `הכנסה: ${cur}${Number(data.amount).toFixed(2)} — ${data.description}\n` +
    `תאריך: ${formatDate(date)}`
  );
}

// ── Balance ───────────────────────────────────────────────────────────────────

async function handleBalance(chatId) {
  const now   = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const all   = await readTransactions();
  const tx    = all.filter(t => t.date.startsWith(month));
  const cur   = config.currency;

  const income   = tx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expenses = tx.filter(t => t.type !== 'income').reduce((s, t) => s + t.amount, 0);
  const net      = income - expenses;
  const netSign  = net >= 0 ? '+' : '';

  await sendWithKeyboard(chatId,
    `<b>📊 סיכום — ${hebrewMonth(now.getMonth())} ${now.getFullYear()}</b>\n\n` +
    `💰 הכנסות:  ${cur}${income.toFixed(2)}\n` +
    `💸 הוצאות:  ${cur}${expenses.toFixed(2)}\n` +
    `📈 יתרה:    ${netSign}${cur}${Math.abs(net).toFixed(2)}\n\n` +
    `עסקאות החודש: ${tx.length}`
  );
}

// ── Last transactions ─────────────────────────────────────────────────────────

async function handleList(chatId) {
  const all  = await readTransactions();
  const last = all.slice(-10).reverse();
  const cur  = config.currency;

  if (last.length === 0) {
    return sendWithKeyboard(chatId, 'אין עסקאות עדיין 📭');
  }

  const lines = last.map(t => {
    const sign = t.type === 'income' ? '+' : '-';
    return `${formatDate(t.date)}  ${sign}${cur}${Number(t.amount).toFixed(2)}  ${t.description}`;
  });

  await sendWithKeyboard(chatId,
    `<b>📋 10 עסקאות אחרונות:</b>\n<pre>${lines.join('\n')}</pre>`
  );
}

// ── Help ──────────────────────────────────────────────────────────────────────

async function handleHelp(chatId) {
  await sendWithKeyboard(chatId,
    `<b>ברוך הבא לבוט התקציב 💼</b>\n\n` +
    `השתמש בכפתורים למטה:\n\n` +
    `<b>הוצאה 💸</b> — הוספת הוצאה\n` +
    `<b>הכנסה 💰</b> — הוספת הכנסה\n` +
    `<b>יתרה 📊</b> — סיכום חודש נוכחי\n` +
    `<b>עסקאות אחרונות 📋</b> — 10 העסקאות האחרונות\n\n` +
    `<b>ייבוא CSV:</b>\n` +
    `שלח קובץ <code>.csv</code> לייבוא עסקאות בכמות גדולה`
  );
}

// ── Clear all ─────────────────────────────────────────────────────────────────

async function handleClear(args, chatId) {
  if (args[0] !== 'CONFIRM') {
    return sendWithKeyboard(chatId,
      '⚠️ פעולה זו תמחק את <b>כל</b> העסקאות!\n\n' +
      'לאישור שלח:\n<code>/clear CONFIRM</code>'
    );
  }
  await clearAllTransactions();
  await sendWithKeyboard(chatId, '🗑️ כל העסקאות נמחקו.');
}

// ── CSV document handler ──────────────────────────────────────────────────────

async function handleDocument(message, chatId) {
  const doc = message.document;

  if (!doc.file_name.toLowerCase().endsWith('.csv')) {
    return sendWithKeyboard(chatId, 'אנא שלח קובץ <code>.csv</code> בלבד.');
  }

  await sendReply(chatId, '⏳ מייבא CSV...');

  const fileInfo = await getFile(doc.file_id);
  const buffer   = await downloadFile(fileInfo.file_path);
  const rows     = await parseCSVBuffer(buffer);

  if (rows.length === 0) {
    return sendWithKeyboard(chatId,
      'לא נמצאו שורות תקינות בקובץ ה-CSV.\n' +
      'עמודות נדרשות: <code>date, description, amount, category</code>'
    );
  }

  const result = await mergeTransactions(rows);
  await sendWithKeyboard(chatId,
    `✅ CSV יובא בהצלחה!\n` +
    `שורות חדשות: ${result.added}\n` +
    `סה"כ עסקאות: ${result.total}`
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hebrewMonth(m) {
  const months = [
    'ינואר','פברואר','מרץ','אפריל','מאי','יוני',
    'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר',
  ];
  return months[m];
}

/** Format YYYY-MM-DD → DD.MM.YYYY for Hebrew display */
function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

module.exports = router;
