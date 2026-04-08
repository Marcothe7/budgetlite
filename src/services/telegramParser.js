// Smart text parser for Telegram bot messages.
// Handles slash-commands and free-form expense entries.

const CATEGORY_ALIASES = {
  // English — Food
  food: 'Food', grocery: 'Food', groceries: 'Food', supermarket: 'Food',
  market: 'Food', bread: 'Food', meat: 'Food',
  // English — Transport
  transport: 'Transport', transportation: 'Transport', uber: 'Transport',
  taxi: 'Transport', bus: 'Transport', train: 'Transport', fuel: 'Transport',
  gas: 'Transport', petrol: 'Transport', parking: 'Transport',
  // English — Dining
  dining: 'Dining', restaurant: 'Dining', cafe: 'Dining', coffee: 'Dining',
  lunch: 'Dining', dinner: 'Dining', breakfast: 'Dining', pizza: 'Dining',
  // English — Entertainment
  entertainment: 'Entertainment', netflix: 'Entertainment', spotify: 'Entertainment',
  movie: 'Entertainment', cinema: 'Entertainment', game: 'Entertainment',
  games: 'Entertainment', concert: 'Entertainment',
  // English — Health
  health: 'Health', doctor: 'Health', pharmacy: 'Health', medicine: 'Health',
  medical: 'Health', gym: 'Health', dentist: 'Health',
  // English — Shopping
  shopping: 'Shopping', amazon: 'Shopping', clothes: 'Shopping', clothing: 'Shopping',
  shoes: 'Shopping', electronics: 'Shopping',
  // English — Utilities
  utilities: 'Utilities', electric: 'Utilities', electricity: 'Utilities',
  water: 'Utilities', internet: 'Utilities', phone: 'Utilities',
  bill: 'Utilities', bills: 'Utilities',
  // English — Housing
  rent: 'Housing', housing: 'Housing', mortgage: 'Housing',
  // English — Salary/Income
  salary: 'Salary', income: 'Salary', wage: 'Salary', freelance: 'Salary',

  // Hebrew — Food
  'אוכל': 'Food', 'סופר': 'Food', 'מכולת': 'Food', 'ירקות': 'Food',
  'פירות': 'Food', 'בשר': 'Food', 'לחם': 'Food',
  // Hebrew — Transport
  'תחבורה': 'Transport', 'אוטובוס': 'Transport', 'רכבת': 'Transport',
  'דלק': 'Transport', 'חניה': 'Transport', 'מונית': 'Transport', 'נסיעה': 'Transport',
  // Hebrew — Dining
  'מסעדה': 'Dining', 'קפה': 'Dining', 'ארוחה': 'Dining', 'צהריים': 'Dining',
  'ערב': 'Dining', 'בוקר': 'Dining', 'פיצה': 'Dining', 'אוכל בחוץ': 'Dining',
  // Hebrew — Entertainment
  'בידור': 'Entertainment', 'סרט': 'Entertainment', 'קולנוע': 'Entertainment',
  'משחק': 'Entertainment', 'מנוי': 'Entertainment',
  // Hebrew — Health
  'בריאות': 'Health', 'רופא': 'Health', 'תרופות': 'Health', 'ספורט': 'Health',
  'חדר כושר': 'Health', 'כושר': 'Health', 'דנטיסט': 'Health',
  // Hebrew — Shopping
  'קניות': 'Shopping', 'בגדים': 'Shopping', 'ביגוד': 'Shopping', 'נעליים': 'Shopping',
  // Hebrew — Utilities
  'חשמל': 'Utilities', 'מים': 'Utilities', 'אינטרנט': 'Utilities',
  'טלפון': 'Utilities', 'חשבון': 'Utilities',
  // Hebrew — Housing
  'שכירות': 'Housing', 'משכנתא': 'Housing', 'דירה': 'Housing',
  // Hebrew — Salary/Income
  'משכורת': 'Salary', 'הכנסה': 'Salary', 'שכר': 'Salary', 'פרילנס': 'Salary',
  'בונוס': 'Salary',
};

function resolveCategory(token) {
  if (!token) return 'Uncategorized';
  // Hebrew has no case, English lowercased
  const key = token.toLowerCase();
  return CATEGORY_ALIASES[key] || CATEGORY_ALIASES[token] ||
    (token.charAt(0).toUpperCase() + token.slice(1));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Parse a date string into YYYY-MM-DD.
 * Accepts:
 *   ""        → today
 *   "היום"    → today
 *   "today"   → today
 *   "21.2"    → current-year-02-21
 *   "21.2.25" → 2025-02-21
 *   "21.2.2025" → 2025-02-21
 *   "2026-02-21" → 2026-02-21 (pass-through)
 *   Anything else (e.g. keyboard button text) → today (acts as "skip")
 */
function parseDate(str) {
  const s = (str || '').trim();

  if (!s || s === 'היום' || s.toLowerCase() === 'today') return today();

  // ISO pass-through
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD.MM.YYYY
  const full = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (full) return `${full[3]}-${full[2].padStart(2,'0')}-${full[1].padStart(2,'0')}`;

  // DD.MM.YY
  const short = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/);
  if (short) return `20${short[3]}-${short[2].padStart(2,'0')}-${short[1].padStart(2,'0')}`;

  // DD.MM → current year
  const dayMonth = s.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (dayMonth) {
    const year = new Date().getFullYear();
    return `${year}-${dayMonth[2].padStart(2,'0')}-${dayMonth[1].padStart(2,'0')}`;
  }

  // Fallback — keyboard button tapped, unrecognized text, etc.
  return today();
}

/**
 * Parse a Telegram message text (used for smart free-form entry and commands).
 */
function parseMessage(text) {
  const trimmed = (text || '').trim();

  if (trimmed.startsWith('/')) {
    const [rawCmd, ...rest] = trimmed.split(/\s+/);
    const command = rawCmd.toLowerCase().split('@')[0];
    return { type: 'command', command, args: rest };
  }

  const stripped = trimmed.replace(/^[₪$€£]/, '').trim();
  const tokens   = stripped.replace(/,/g, '').split(/\s+/);
  const amount   = parseFloat(tokens[0]);

  if (!isNaN(amount) && amount > 0) {
    const categoryToken = tokens[1] || '';
    const category      = resolveCategory(categoryToken);
    const description   = tokens.length > 2
      ? tokens.slice(2).join(' ')
      : (categoryToken || category);

    const isIncome = (CATEGORY_ALIASES[categoryToken.toLowerCase()] === 'Salary') ||
                     (CATEGORY_ALIASES[categoryToken] === 'Salary');

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

module.exports = { parseMessage, parseDate, resolveCategory };
