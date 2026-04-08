// Smart text parser for Telegram bot messages.
// Handles both slash-commands and free-form expense entries.

const CATEGORY_ALIASES = {
  // Food
  food: 'Food', grocery: 'Food', groceries: 'Food', supermarket: 'Food',
  market: 'Food', bread: 'Food', meat: 'Food',
  // Transport
  transport: 'Transport', transportation: 'Transport', uber: 'Transport',
  taxi: 'Transport', bus: 'Transport', train: 'Transport', fuel: 'Transport',
  gas: 'Transport', petrol: 'Transport', parking: 'Transport',
  // Dining
  dining: 'Dining', restaurant: 'Dining', cafe: 'Dining', coffee: 'Dining',
  lunch: 'Dining', dinner: 'Dining', breakfast: 'Dining', pizza: 'Dining',
  // Entertainment
  entertainment: 'Entertainment', netflix: 'Entertainment', spotify: 'Entertainment',
  movie: 'Entertainment', cinema: 'Entertainment', game: 'Entertainment',
  games: 'Entertainment', concert: 'Entertainment',
  // Health
  health: 'Health', doctor: 'Health', pharmacy: 'Health', medicine: 'Health',
  medical: 'Health', gym: 'Health', dentist: 'Health',
  // Shopping
  shopping: 'Shopping', amazon: 'Shopping', clothes: 'Shopping', clothing: 'Shopping',
  shoes: 'Shopping', electronics: 'Shopping',
  // Utilities
  utilities: 'Utilities', electric: 'Utilities', electricity: 'Utilities',
  water: 'Utilities', internet: 'Utilities', phone: 'Utilities',
  bill: 'Utilities', bills: 'Utilities',
  // Housing
  rent: 'Housing', housing: 'Housing', mortgage: 'Housing',
  // Income
  salary: 'Salary', income: 'Salary', wage: 'Salary', freelance: 'Salary',
};

function resolveCategory(token) {
  if (!token) return 'Uncategorized';
  const lower = token.toLowerCase();
  return CATEGORY_ALIASES[lower] || (token.charAt(0).toUpperCase() + token.slice(1));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Parse a Telegram message text.
 *
 * Returns one of:
 *   { type: 'command',  command: '/balance', args: [] }
 *   { type: 'expense',  amount, category, description, date }
 *   { type: 'income',   amount, category, description, date }
 *   { type: 'unknown' }
 */
function parseMessage(text) {
  const trimmed = (text || '').trim();

  // ── Slash command ─────────────────────────────────────────────────────────
  if (trimmed.startsWith('/')) {
    const [rawCmd, ...rest] = trimmed.split(/\s+/);
    const command = rawCmd.toLowerCase().split('@')[0]; // strip @BotName suffix
    return { type: 'command', command, args: rest };
  }

  // ── Smart expense: first token must be a number ───────────────────────────
  // Strip common currency prefixes (₪ $ € £)
  const stripped = trimmed.replace(/^[₪$€£]/, '').trim();
  // Also handle numbers with commas like 1,500
  const tokens   = stripped.replace(/,/g, '').split(/\s+/);
  const amount   = parseFloat(tokens[0]);

  if (!isNaN(amount) && amount > 0) {
    const categoryToken = tokens[1] || '';
    const category      = resolveCategory(categoryToken);
    const description   = tokens.length > 2
      ? tokens.slice(2).join(' ')
      : (categoryToken || category);

    // Detect if this looks like income based on the category alias
    const isIncome = (CATEGORY_ALIASES[categoryToken.toLowerCase()] === 'Salary') ||
                     categoryToken.toLowerCase() === 'income';

    return {
      type:        isIncome ? 'income' : 'expense',
      amount,
      category:    isIncome ? 'Salary' : category,
      description: description || category,
      date:        today(),
    };
  }

  return { type: 'unknown' };
}

module.exports = { parseMessage, resolveCategory };
