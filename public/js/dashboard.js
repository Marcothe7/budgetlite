// ── State ─────────────────────────────────────────────────────────────────────
let currentMonth     = null;
let currentPage      = 'overview';
let barChartInst     = null;
let pieChartInst     = null;
let monthlyChartInst = null;
let knownMonths      = [];
let allTransactions  = [];   // full list for current page (Transactions page)
let colorMap         = {};   // category → color
let budgets          = {};   // category → monthly limit

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchMonths() {
  return fetch('/api/months').then(r => r.json());
}

async function fetchAll(month) {
  const q = month ? `?month=${month}` : '';
  const [summary, daily, categories, transactions] = await Promise.all([
    fetch(`/api/summary${q}`).then(r => r.json()),
    fetch(`/api/daily${q}`).then(r => r.json()),
    fetch(`/api/categories${q}`).then(r => r.json()),
    fetch(`/api/transactions${q}`).then(r => r.json()),
  ]);
  return { summary, daily, categories, transactions };
}

async function fetchBudgets() {
  return fetch('/api/budgets').then(r => r.json());
}

async function saveBudgets() {
  await fetch('/api/budgets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(budgets),
  });
}

async function apiDeleteTx(id) {
  const res = await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
  return res.json();
}

async function apiUpdateTx(id, data) {
  const res = await fetch(`/api/transactions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

// ── Toast notifications ───────────────────────────────────────────────────────

function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── Dark mode ─────────────────────────────────────────────────────────────────

function initDarkMode() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');

  document.getElementById('dark-toggle').addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    }
    // Redraw charts to apply new grid/tick colors
    refreshCurrentPage();
  });
}

// ── Page navigation ───────────────────────────────────────────────────────────

const PAGE_TITLES = {
  overview:     'Overview',
  transactions: 'Transactions',
  reports:      'Reports',
};

function switchPage(page) {
  if (page === currentPage) return;
  currentPage = page;

  // Update nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // Show/hide pages
  ['overview', 'transactions', 'reports'].forEach(p => {
    const el = document.getElementById(`page-${p}`);
    if (el) el.hidden = (p !== page);
  });

  // Update topbar title
  document.getElementById('topbar-title').textContent = PAGE_TITLES[page];

  // Load page data
  loadCurrentPage();
}

function refreshCurrentPage() {
  loadCurrentPage();
}

function loadCurrentPage() {
  if (currentPage === 'overview')     return loadOverview(currentMonth);
  if (currentPage === 'transactions') return loadTransactions(currentMonth);
  if (currentPage === 'reports')      return loadReports(currentMonth);
}

// ── Month picker ──────────────────────────────────────────────────────────────

function populateMonthPicker(months) {
  const sel = document.getElementById('month-picker');
  sel.innerHTML = months.map(m =>
    `<option value="${m.value}">${m.label}</option>`
  ).join('');
}

function updateTopbarSub(month, months) {
  const match = months.find(m => m.value === month);
  document.getElementById('topbar-sub').textContent =
    match ? match.label : 'All months';
}

// ── Utility ───────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isDark() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

function chartColors() {
  return {
    grid: isDark() ? '#243045' : '#f1f5f9',
    tick: '#94a3b8',
    border: isDark() ? '#1e293b' : '#ffffff',
  };
}

// ── Overview page ─────────────────────────────────────────────────────────────

async function loadOverview(month) {
  const { summary, daily, categories, transactions } = await fetchAll(month);
  colorMap = Object.fromEntries(categories.map(c => [c.category, c.color]));
  renderSummaryCards(summary);
  renderRecentTable(transactions, colorMap);
  renderBarChart(daily);
  renderPieChart(categories);
  populateCategoryList(categories.map(c => c.category));
}

function renderSummaryCards(summary) {
  document.getElementById('card-total').textContent   = `₪${summary.totalExpenses.toFixed(2)}`;
  document.getElementById('card-count').textContent   = summary.transactionCount;
  document.getElementById('card-highest').textContent = `₪${summary.highestExpense.toFixed(2)}`;
  document.getElementById('card-avg').textContent     = `₪${summary.avgDailyExpense.toFixed(2)}`;
}

function renderRecentTable(transactions, cMap) {
  const tbody = document.getElementById('transactions-body');
  const recent = [...transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);

  if (recent.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-row">No transactions for this period.</td></tr>`;
    return;
  }
  tbody.innerHTML = recent.map(t => {
    const color = cMap[t.category] || '#94a3b8';
    return `<tr>
      <td class="col-date">${formatDate(t.date)}</td>
      <td class="col-desc">${escHtml(t.description)}</td>
      <td><span class="badge" style="--badge-color:${color}">${escHtml(t.category)}</span></td>
      <td class="col-amount">₪${t.amount.toFixed(2)}</td>
    </tr>`;
  }).join('');
}

function renderBarChart(daily) {
  if (barChartInst) { barChartInst.destroy(); barChartInst = null; }
  const cc = chartColors();
  barChartInst = new Chart(document.getElementById('bar-chart'), {
    type: 'bar',
    data: {
      labels: daily.map(d => {
        const [, m, day] = d.date.split('-');
        return `${parseInt(day)}/${parseInt(m)}`;
      }),
      datasets: [{
        label: 'Daily Expenses',
        data: daily.map(d => d.amount),
        backgroundColor: '#6366f1cc',
        borderColor: '#6366f1',
        borderWidth: 0,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: cc.grid },
          border: { display: false },
          ticks: { callback: v => `₪${v}`, color: cc.tick, font: { size: 11 } },
        },
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: cc.tick, font: { size: 11 } },
        },
      },
    },
  });
}

function renderPieChart(categories) {
  if (pieChartInst) { pieChartInst.destroy(); pieChartInst = null; }
  const cc = chartColors();
  pieChartInst = new Chart(document.getElementById('pie-chart'), {
    type: 'doughnut',
    data: {
      labels: categories.map(c => c.category),
      datasets: [{
        data: categories.map(c => c.amount),
        backgroundColor: categories.map(c => c.color),
        borderWidth: 3,
        borderColor: cc.border,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 14, usePointStyle: true, pointStyleWidth: 8,
            font: { size: 12 }, color: isDark() ? '#94a3b8' : '#374151',
          },
        },
        tooltip: { callbacks: { label: ctx => ` ₪${ctx.parsed.toFixed(2)}` } },
      },
    },
  });
}

// ── Transactions page ─────────────────────────────────────────────────────────

async function loadTransactions(month) {
  const q = month ? `?month=${month}` : '';
  const [transactions, categories] = await Promise.all([
    fetch(`/api/transactions${q}`).then(r => r.json()),
    fetch(`/api/categories${q}`).then(r => r.json()),
  ]);
  colorMap = Object.fromEntries(categories.map(c => [c.category, c.color]));
  allTransactions = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  populateCategoryList(categories.map(c => c.category));
  applySearch();
}

function applySearch() {
  const q = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
  const filtered = q
    ? allTransactions.filter(t =>
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      )
    : allTransactions;
  renderAllTransactionsTable(filtered);
}

function renderAllTransactionsTable(transactions) {
  const tbody  = document.getElementById('all-transactions-body');
  const counter = document.getElementById('tx-all-count');
  counter.textContent = transactions.length ? `${transactions.length} rows` : '';

  if (transactions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No transactions found.</td></tr>`;
    return;
  }
  tbody.innerHTML = transactions.map(t => {
    const color = colorMap[t.category] || '#94a3b8';
    return `<tr data-id="${t.id}">
      <td class="col-date">${formatDate(t.date)}</td>
      <td class="col-desc">${escHtml(t.description)}</td>
      <td><span class="badge" style="--badge-color:${color}">${escHtml(t.category)}</span></td>
      <td class="col-amount">₪${t.amount.toFixed(2)}</td>
      <td class="col-actions">
        <div class="row-actions">
          <button class="btn-icon" data-action="edit" data-id="${t.id}" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="btn-icon danger" data-action="delete" data-id="${t.id}" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
            </svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function initTransactionActions() {
  document.getElementById('all-transactions-body').addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = parseInt(btn.dataset.id, 10);
    const action = btn.dataset.action;

    if (action === 'delete') {
      const row = btn.closest('tr');
      row.style.opacity = '0.4';
      row.style.pointerEvents = 'none';
      const result = await apiDeleteTx(id);
      if (result.success) {
        allTransactions = allTransactions.filter(t => t.id !== id);
        applySearch();
        showToast('Transaction deleted', 'success');
        // Refresh months in case we deleted the last row of a month
        knownMonths = await fetchMonths();
        populateMonthPicker(knownMonths);
      } else {
        row.style.opacity = '';
        row.style.pointerEvents = '';
        showToast(result.error || 'Delete failed', 'error');
      }
    }

    if (action === 'edit') {
      const tx = allTransactions.find(t => t.id === id);
      if (tx) openEditModal(tx);
    }
  });

  document.getElementById('search-input').addEventListener('input', applySearch);

  document.getElementById('export-btn').addEventListener('click', exportCSV);
}

// ── Export CSV ────────────────────────────────────────────────────────────────

function exportCSV() {
  function esc(val) {
    const s = String(val);
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? `"${s.replace(/"/g, '""')}"` : s;
  }
  const q = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
  const rows = q
    ? allTransactions.filter(t =>
        t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q))
    : allTransactions;

  const header = 'date,description,amount,category';
  const lines  = rows.map(t =>
    [esc(t.date), esc(t.description), esc(t.amount), esc(t.category)].join(',')
  );
  const csv  = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `transactions-${currentMonth || 'all'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Reports page ──────────────────────────────────────────────────────────────

async function loadReports(month) {
  const [categories, bud, allDaily] = await Promise.all([
    fetch(`/api/categories${month ? `?month=${month}` : ''}`).then(r => r.json()),
    fetchBudgets(),
    fetch('/api/daily').then(r => r.json()),
  ]);
  budgets = bud;
  colorMap = Object.fromEntries(categories.map(c => [c.category, c.color]));

  // Update label
  const match = knownMonths.find(m => m.value === month);
  document.getElementById('budget-month-label').textContent =
    match ? match.label : 'all months';

  renderBudgetGoals(categories);
  renderMonthlyChart(allDaily);
}

function renderBudgetGoals(categories) {
  const list = document.getElementById('budget-goals-list');

  if (categories.length === 0) {
    list.innerHTML = `<p class="empty-row">No transactions for this period.</p>`;
    return;
  }

  list.innerHTML = categories
    .sort((a, b) => b.amount - a.amount)
    .map(cat => {
      const limit   = budgets[cat.category];
      const hasLimit = limit != null && limit > 0;
      const pct     = hasLimit ? Math.min((cat.amount / limit) * 100, 100) : 0;
      const over    = hasLimit && cat.amount > limit;

      return `
        <div class="budget-goal-row" data-category="${escHtml(cat.category)}">
          <div class="budget-goal-header">
            <div class="budget-goal-label">
              <span class="budget-dot" style="background:${cat.color}"></span>
              ${escHtml(cat.category)}
            </div>
            <div class="budget-goal-amounts">
              <span class="budget-spent">₪${cat.amount.toFixed(2)}</span>
              <span>/</span>
              <span class="budget-limit-wrap">
                <span class="budget-currency">₪</span>
                <input
                  class="budget-input"
                  type="number"
                  min="0"
                  step="10"
                  placeholder="no limit"
                  value="${hasLimit ? limit : ''}"
                  data-category="${escHtml(cat.category)}"
                />
              </span>
            </div>
          </div>
          <div class="progress-bar-track">
            <div class="progress-bar-fill ${over ? 'progress-over' : ''}"
                 style="width:${hasLimit ? pct : 0}%;background:${over ? '' : cat.color}">
            </div>
          </div>
        </div>`;
    }).join('');

  // Budget input listeners
  list.querySelectorAll('.budget-input').forEach(input => {
    input.addEventListener('change', async () => {
      const category = input.dataset.category;
      const val = parseFloat(input.value);
      if (isNaN(val) || val <= 0) {
        delete budgets[category];
        input.value = '';
      } else {
        budgets[category] = val;
      }
      await saveBudgets();
      // Re-render with fresh data
      const month = currentMonth;
      const cats = await fetch(`/api/categories${month ? `?month=${month}` : ''}`).then(r => r.json());
      renderBudgetGoals(cats);
      showToast('Budget saved', 'success');
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  });
}

function renderMonthlyChart(allDaily) {
  if (monthlyChartInst) { monthlyChartInst.destroy(); monthlyChartInst = null; }

  // Aggregate by month
  const monthMap = {};
  allDaily.forEach(d => {
    const m = d.date.slice(0, 7);
    monthMap[m] = (monthMap[m] || 0) + d.amount;
  });

  const sorted = Object.entries(monthMap).sort(([a], [b]) => a.localeCompare(b)).slice(-12);
  const labels = sorted.map(([m]) => {
    const [y, mo] = m.split('-');
    return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  });
  const data = sorted.map(([, v]) => +v.toFixed(2));

  const cc = chartColors();
  monthlyChartInst = new Chart(document.getElementById('monthly-chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Monthly Expenses',
        data,
        backgroundColor: '#6366f1cc',
        borderColor: '#6366f1',
        borderWidth: 0,
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: cc.grid },
          border: { display: false },
          ticks: { callback: v => `₪${v}`, color: cc.tick, font: { size: 11 } },
        },
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: cc.tick, font: { size: 11 } },
        },
      },
    },
  });
}

// ── Category datalist (autocomplete) ─────────────────────────────────────────

function populateCategoryList(categories) {
  const dl = document.getElementById('category-list');
  dl.innerHTML = categories.map(c => `<option value="${escHtml(c)}"></option>`).join('');
}

// ── Add / Edit modal ──────────────────────────────────────────────────────────

function openEditModal(tx) {
  document.getElementById('add-modal-title').textContent = 'Edit Transaction';
  document.getElementById('add-submit').textContent      = 'Save Changes';
  document.getElementById('tx-editing-id').value         = tx.id;
  document.getElementById('tx-date').value               = tx.date;
  document.getElementById('tx-amount').value             = tx.amount;
  document.getElementById('tx-description').value        = tx.description;
  document.getElementById('tx-category').value           = tx.category;
  setAddFeedback('', '');
  document.getElementById('add-modal').hidden = false;
}

function initAddModal() {
  const trigger   = document.getElementById('add-transaction-trigger');
  const modal     = document.getElementById('add-modal');
  const closeBtn  = document.getElementById('add-modal-close');
  const cancelBtn = document.getElementById('add-cancel');
  const form      = document.getElementById('add-form');
  const dateInput = document.getElementById('tx-date');

  dateInput.value = new Date().toISOString().slice(0, 10);

  const openModal = () => {
    document.getElementById('add-modal-title').textContent = 'Add Transaction';
    document.getElementById('add-submit').textContent      = 'Save Transaction';
    document.getElementById('tx-editing-id').value         = '';
    form.reset();
    dateInput.value = new Date().toISOString().slice(0, 10);
    setAddFeedback('', '');
    modal.hidden = false;
  };

  const closeModal = () => {
    modal.hidden = true;
    form.reset();
    document.getElementById('tx-editing-id').value = '';
    dateInput.value = new Date().toISOString().slice(0, 10);
  };

  trigger.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const editingId  = document.getElementById('tx-editing-id').value;
    const date       = document.getElementById('tx-date').value;
    const description = document.getElementById('tx-description').value.trim();
    const amount     = document.getElementById('tx-amount').value;
    const category   = document.getElementById('tx-category').value.trim();

    if (!date || !description || !amount || !category) {
      setAddFeedback('Please fill in all fields.', 'error');
      return;
    }

    setAddFeedback('Saving…', 'info');

    const isEdit = editingId !== '';
    const url    = isEdit ? `/api/transactions/${editingId}` : '/api/transactions';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res  = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, description, amount: parseFloat(amount), category }),
      });
      const data = await res.json();

      if (!res.ok) { setAddFeedback(data.error, 'error'); return; }

      setAddFeedback(isEdit ? '✓ Changes saved!' : '✓ Transaction saved!', 'success');
      showToast(isEdit ? 'Transaction updated' : 'Transaction added', 'success');

      knownMonths = await fetchMonths();
      populateMonthPicker(knownMonths);

      const txMonth = date.slice(0, 7);
      if (!currentMonth || currentMonth === txMonth) {
        await loadCurrentPage();
      }

      setTimeout(closeModal, 1000);
    } catch {
      setAddFeedback('Failed to save. Please try again.', 'error');
    }
  });

  function setAddFeedback(msg, type) {
    const el = document.getElementById('add-feedback');
    el.textContent = msg;
    el.className   = `add-feedback ${type}`;
  }
}

function setAddFeedback(msg, type) {
  const el = document.getElementById('add-feedback');
  if (!el) return;
  el.textContent = msg;
  el.className   = `add-feedback ${type}`;
}

// ── Upload modal ──────────────────────────────────────────────────────────────

function initUploadModal() {
  const trigger   = document.getElementById('upload-trigger');
  const modal     = document.getElementById('upload-modal');
  const closeBtn  = document.getElementById('modal-close');
  const dropZone  = document.getElementById('drop-zone');
  const fileInput = document.getElementById('csv-file-input');
  const feedback  = document.getElementById('upload-feedback');

  const openModal  = () => { modal.hidden = false; setFeedback('', ''); };
  const closeModal = () => { modal.hidden = true; fileInput.value = ''; };

  trigger.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleUpload(fileInput.files[0]);
  });

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]);
  });

  async function handleUpload(file) {
    setFeedback('Uploading…', 'info');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res  = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) { setFeedback(data.error, 'error'); return; }

      setFeedback(
        `✓ Merged: ${data.added} new row${data.added !== 1 ? 's' : ''} added (${data.rows} total)`,
        'success'
      );

      knownMonths = await fetchMonths();
      populateMonthPicker(knownMonths);
      currentMonth = knownMonths[0]?.value || null;
      if (currentMonth) document.getElementById('month-picker').value = currentMonth;
      updateTopbarSub(currentMonth, knownMonths);
      await loadCurrentPage();

      setTimeout(closeModal, 2000);
    } catch {
      setFeedback('Upload failed. Please try again.', 'error');
    }
  }

  function setFeedback(msg, type) {
    feedback.textContent = msg;
    feedback.className   = `upload-feedback ${type}`;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  initDarkMode();

  // Sidebar nav
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      switchPage(el.dataset.page);
    });
  });

  // "View all" link on overview
  document.getElementById('view-all-btn').addEventListener('click', () => {
    switchPage('transactions');
  });

  // Month picker
  knownMonths = await fetchMonths();
  populateMonthPicker(knownMonths);
  currentMonth = knownMonths[0]?.value || null;
  updateTopbarSub(currentMonth, knownMonths);

  document.getElementById('month-picker').addEventListener('change', async e => {
    currentMonth = e.target.value || null;
    updateTopbarSub(currentMonth, knownMonths);
    await loadCurrentPage();
  });

  initAddModal();
  initUploadModal();
  initTransactionActions();

  // Initial load
  await loadOverview(currentMonth);
});
