const { createClient } = require('@supabase/supabase-js');

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required.');
  }
  return createClient(url, key);
}

// ── Transactions ──────────────────────────────────────────────────────────────

async function readTransactions() {
  const { data, error } = await getClient()
    .from('transactions')
    .select('*')
    .order('date', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(row => ({
    id:          row.id,
    date:        row.date,
    description: row.description,
    amount:      parseFloat(row.amount),
    category:    row.category,
    type:        row.type,
    recurring:   row.recurring,
  }));
}

async function appendTransaction({ date, description, amount, category, type = 'expense', recurring = false }) {
  const { data, error } = await getClient()
    .from('transactions')
    .insert([{ date, description, amount, category, type, recurring }])
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function deleteTransaction(id) {
  const { error } = await getClient()
    .from('transactions')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
}

async function updateTransaction(id, { date, description, amount, category, type = 'expense', recurring = false }) {
  const { error } = await getClient()
    .from('transactions')
    .update({ date, description, amount, category, type, recurring })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

async function mergeTransactions(newRows) {
  const supabase = getClient();

  // Fetch all existing fingerprints
  const { data: existing, error: readErr } = await supabase
    .from('transactions')
    .select('date, description, amount, category');
  if (readErr) throw new Error(readErr.message);

  const fingerprints = new Set(
    (existing || []).map(t => `${t.date}|${t.description}|${t.amount}|${t.category}`)
  );

  const toInsert = newRows.filter(row => {
    const fp = `${row.date}|${row.description}|${row.amount}|${row.category}`;
    return !fingerprints.has(fp);
  });

  if (toInsert.length > 0) {
    const { error: insertErr } = await supabase
      .from('transactions')
      .insert(toInsert.map(r => ({
        date:        r.date,
        description: r.description,
        amount:      r.amount,
        category:    r.category,
        type:        r.type || 'expense',
        recurring:   r.recurring || false,
      })));
    if (insertErr) throw new Error(insertErr.message);
  }

  const { count } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true });

  return { added: toInsert.length, total: count || (existing.length + toInsert.length) };
}

async function clearAllTransactions() {
  // Supabase requires a filter for delete; use a condition that matches all rows
  const { error } = await getClient()
    .from('transactions')
    .delete()
    .gte('created_at', '2000-01-01');
  if (error) throw new Error(error.message);
}

async function renameCategory(from, to) {
  const { error } = await getClient()
    .from('transactions')
    .update({ category: to })
    .eq('category', from);
  if (error) throw new Error(error.message);
}

// ── Budgets ───────────────────────────────────────────────────────────────────

async function readBudgets() {
  const { data, error } = await getClient()
    .from('budgets')
    .select('category, amount');
  if (error) throw new Error(error.message);
  const result = {};
  (data || []).forEach(row => { result[row.category] = row.amount; });
  return result;
}

async function writeBudgets(obj) {
  const supabase = getClient();
  const rows = Object.entries(obj).map(([category, amount]) => ({ category, amount }));
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('budgets')
    .upsert(rows, { onConflict: 'category' });
  if (error) throw new Error(error.message);
}

module.exports = {
  readTransactions, appendTransaction, deleteTransaction,
  updateTransaction, mergeTransactions, clearAllTransactions,
  renameCategory, readBudgets, writeBudgets,
};
