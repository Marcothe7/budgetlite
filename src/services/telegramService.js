// Thin HTTP wrapper for the Telegram Bot API.
// Uses Node 18's native fetch (available on Vercel's runtime).

function apiUrl(method) {
  return `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;
}

async function sendMessage(chatId, text, extra = {}) {
  await fetch(apiUrl('sendMessage'), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extra }),
  });
}

async function getFile(fileId) {
  const res  = await fetch(apiUrl(`getFile?file_id=${fileId}`));
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram getFile error: ${data.description}`);
  return data.result; // { file_id, file_path, file_size }
}

async function downloadFile(filePath) {
  const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function setWebhook(url) {
  const res  = await fetch(apiUrl('setWebhook'), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ url }),
  });
  return res.json();
}

module.exports = { sendMessage, getFile, downloadFile, setWebhook };
