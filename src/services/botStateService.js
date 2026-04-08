// Conversation state manager backed by Supabase.
// Required table (run once in Supabase SQL editor):
//
//   create table bot_state (
//     chat_id    text primary key,
//     state      text not null default 'idle',
//     data       jsonb not null default '{}',
//     updated_at timestamptz not null default now()
//   );

const { createClient } = require('@supabase/supabase-js');

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required.');
  return createClient(url, key);
}

/**
 * Get the current conversation state for a chat.
 * Returns { state: 'idle', data: {} } if no active state exists.
 */
async function getState(chatId) {
  const { data, error } = await getClient()
    .from('bot_state')
    .select('state, data, updated_at')
    .eq('chat_id', String(chatId))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { state: 'idle', data: {} };

  // Auto-expire stale states older than 1 hour (user walked away mid-flow)
  const age = Date.now() - new Date(data.updated_at).getTime();
  if (age > 60 * 60 * 1000) {
    await clearState(chatId);
    return { state: 'idle', data: {} };
  }

  return { state: data.state, data: data.data || {}, updatedAt: data.updated_at };
}

/**
 * Set the conversation state for a chat.
 * @param {string|number} chatId
 * @param {string} state  — e.g. 'expense_details', 'income_date'
 * @param {object} data   — partial transaction data to carry forward
 */
async function setState(chatId, state, data = {}) {
  const { error } = await getClient()
    .from('bot_state')
    .upsert(
      { chat_id: String(chatId), state, data, updated_at: new Date().toISOString() },
      { onConflict: 'chat_id' }
    );
  if (error) throw new Error(error.message);
}

/**
 * Clear the conversation state (called after a flow completes or is cancelled).
 */
async function clearState(chatId) {
  const { error } = await getClient()
    .from('bot_state')
    .delete()
    .eq('chat_id', String(chatId));
  if (error) throw new Error(error.message);
}

module.exports = { getState, setState, clearState };
