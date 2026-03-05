// ── State ─────────────────────────────────────────────────────────────────────
let currentMonth     = null;
let currentPage      = 'overview';
let filterMode       = 'month';   // 'month' | 'custom'
let customFrom       = null;
let customTo         = null;
let sortField        = 'date';
let sortDir          = 'desc';
let categoryFilter   = null;      // null = all categories
let barChartInst     = null;
let pieChartInst     = null;
let monthlyChartInst = null;
let compChartInst    = null;
let knownMonths      = [];
let allTransactions  = [];        // full list for Transactions page
let colorMap         = {};
let budgets          = {};

// ── API helpers ───────────────────────────────────────────────────────────────

function buildQuery() {
  if (filterMode === 'custom' && customFrom && customTo) {
    return `?from=${customFrom}&to=${customTo}`;
  }
  return currentMonth ? `?month=${currentMonth}` : '';
}

function getPrevMonth(m) {
  if (!m) return null;
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
}

async function fetchMonths() {
  return fetch('/api/months').then(r => r.json());
}

async function fetchAll(q) {
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
  return fetch(`/api/transactions/${id}`, { method: 'DELETE' }).then(r => r.json());
}

async function apiUpdateTx(id, data) {
  return fetch(`/api/transactions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(r => r.json());
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── Dark mode ─────────────────────────────────────────────────────────────────

function initDarkMode() {
  if (localStorage.getItem('theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  document.getElementById('dark-toggle').addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (dark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    }
    loadCurrentPage();
  });
}

function isDark() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

function chartColors() {
  return {
    grid:   isDark() ? '#243045' : '#f1f5f9',
    tick:   '#94a3b8',
    border: isDark() ? '#1e293b' : '#ffffff',
    legend: isDark() ? '#94a3b8' : '#374151',
  };
}

// ── Page navigation ───────────────────────────────────────────────────────────

const PAGE_TITLES = { overview: 'Overview', transactions: 'Transactions', reports: 'Reports' };

function switchPage(page) {
  if (page === currentPage) return;
  currentPage = page;
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  ['overview', 'transactions', 'reports'].forEach(p => {
    document.getElementById(`page-${p}`).hidden = p !== page;
  });
  document.getElementById('topbar-title').textContent = PAGE_TITLES[page];
  loadCurrentPage();
}

function loadCurrentPage() {
  const q = buildQuery();
  if (currentPage === 'overview')     return loadOverview(q);
  if (currentPage === 'transactions') return loadTransactions(q);
  if (currentPage === 'reports')      return loadReports(q);
}

// ── Month / date-range picker ─────────────────────────────────────────────────

function populateMonthPicker(months) {
  const sel = document.getElementById('month-picker');
  sel.innerHTML =
    months.map(m => `<option value="${m.value}">${m.label}</option>`).join('') +
    `<option value="custom">Custom range…</option>`;
}

function updateTopbarSub() {
  let label;
  if (filterMode === 'custom' && customFrom && customTo) {
    label = `${formatDate(customFrom)} — ${formatDate(customTo)}`;
  } else {
    const match = knownMonths.find(m => m.value === currentMonth);
    label = match ? match.label : 'All months';
  }
  document.getElementById('topbar-sub').textContent = label;
}

function initDateRangeFilter() {
  const picker = document.getElementById('month-picker');
  const wrap   = document.getElementById('range-inputs');
  const fromIn = document.getElementById('range-from');
  const toIn   = document.getElementById('range-to');

  picker.addEventListener('change', async e => {
    if (e.target.value === 'custom') {
      filterMode = 'custom';
      wrap.hidden = false;
    } else {
      filterMode   = 'month';
      currentMonth = e.target.value || null;
      wrap.hidden  = true;
      updateTopbarSub();
      await loadCurrentPage();
    }
  });

  const tryApplyRange = async () => {
    if (fromIn.value && toIn.value && fromIn.value <= toIn.value) {
      customFrom = fromIn.value;
      customTo   = toIn.value;
      updateTopbarSub();
      await loadCurrentPage();
    }
  };
  fromIn.addEventListener('change', tryApplyRange);
  toIn.addEventListener('change',   tryApplyRange);
}

// ── Over-budget sidebar badge ─────────────────────────────────────────────────

function updateSidebarBadge(categories, bud) {
  const over = categories.some(c => {
    const lim = bud[c.category];
    return lim != null && lim > 0 && c.amount > lim;
  });
  const badge = document.getElementById('reports-badge');
  if (badge) badge.hidden = !over;
}

// ── Overview page ─────────────────────────────────────────────────────────────

async function loadOverview(q) {
  const { summary, daily, categories, transactions } = await fetchAll(q);
  colorMap = Object.fromEntries(categories.map(c => [c.category, c.color]));
  budgets  = await fetchBudgets();

  updateSidebarBadge(categories, budgets);
  renderSummaryCards(summary);
  renderRecentTable(transactions);
  renderTop5(transactions);
  renderBarChart(daily);
  renderPieChart(categories);
  populateCategoryList(categories.map(c => c.category));
}

function renderSummaryCards(summary) {
  document.getElementById('card-total').textContent  = `₪${summary.totalExpenses.toFixed(2)}`;
  document.getElementById('card-income').textContent = `₪${summary.totalIncome.toFixed(2)}`;
  document.getElementById('card-count').textContent  = summary.transactionCount;
  document.getElementById('card-avg').textContent    = `₪${summary.avgDailyExpense.toFixed(2)}`;

  const net = summary.netBalance;
  const netEl = document.getElementById('card-net');
  netEl.textContent = (net >= 0 ? '+' : '') + `₪${net.toFixed(2)}`;
  netEl.className = 'card-value ' + (net >= 0 ? 'positive' : 'negative');

  // Trend badges (only when monthly filter is active)
  renderTrendBadge('trend-expenses', summary.trend?.expenses, true);
  renderTrendBadge('trend-income',   summary.trend?.income,   false);
  renderTrendBadge('trend-count',    summary.trend?.count,    true);
}

function renderTrendBadge(elId, pct, lowerIsBetter) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (pct == null) { el.innerHTML = ''; return; }
  const sign = pct >= 0 ? '+' : '';
  const bad  = lowerIsBetter ? pct > 0 : pct < 0;
  el.innerHTML = `<span class="trend-badge ${bad ? 'trend-bad' : 'trend-good'}">${sign}${pct}% vs last month</span>`;
}

function renderTop5(transactions) {
  const list = document.getElementById('top5-list');
  const expenses = transactions
    .filter(t => t.type !== 'income')
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  if (!expenses.length) {
    list.innerHTML = `<li style="color:var(--muted);font-size:13px;padding:12px 0">No expenses this period</li>`;
    return;
  }

  const rankClass = i => i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
  list.innerHTML = expenses.map((t, i) => `
    <li class="top5-item">
      <div class="top5-rank ${rankClass(i)}">${i + 1}</div>
      <div class="top5-info">
        <div class="top5-desc">${escHtml(t.description)}</div>
        <div class="top5-cat">${escHtml(t.category)}</div>
      </div>
      <div class="top5-amount">₪${t.amount.toFixed(2)}</div>
    </li>`).join('');
}

function renderRecentTable(transactions) {
  const tbody = document.getElementById('transactions-body');
  const recent = [...transactions]
    .filter(t => t.type !== 'income')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);

  if (!recent.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-row">No transactions this period.</td></tr>`;
    return;
  }
  tbody.innerHTML = recent.map(t => {
    const color = colorMap[t.category] || '#94a3b8';
    return `<tr>
      <td class="col-date">${formatDate(t.date)}</td>
      <td class="col-desc">${escHtml(t.description)}${t.recurring ? recurringIcon() : ''}</td>
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
      labels: daily.map(d => { const [, m, day] = d.date.split('-'); return `${parseInt(day)}/${parseInt(m)}`; }),
      datasets: [{ label: 'Daily Expenses', data: daily.map(d => d.amount), backgroundColor: '#6366f1cc', borderColor: '#6366f1', borderWidth: 0, borderRadius: 6, borderSkipped: false }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: cc.grid }, border: { display: false }, ticks: { callback: v => `₪${v}`, color: cc.tick, font: { size: 11 } } },
        x: { grid: { display: false }, border: { display: false }, ticks: { color: cc.tick, font: { size: 11 } } },
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
      datasets: [{ data: categories.map(c => c.amount), backgroundColor: categories.map(c => c.color), borderWidth: 3, borderColor: cc.border, hoverOffset: 6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: {
        legend: { position: 'bottom', labels: { padding: 14, usePointStyle: true, pointStyleWidth: 8, font: { size: 12 }, color: cc.legend } },
        tooltip: { callbacks: { label: ctx => ` ₪${ctx.parsed.toFixed(2)}` } },
      },
    },
  });
}

// ── Transactions page ─────────────────────────────────────────────────────────

async function loadTransactions(q) {
  const [transactions, categories] = await Promise.all([
    fetch(`/api/transactions${q}`).then(r => r.json()),
    fetch(`/api/categories${q}`).then(r => r.json()),
  ]);
  colorMap = Object.fromEntries(categories.map(c => [c.category, c.color]));
  allTransactions = transactions;
  populateCategoryList(categories.map(c => c.category));
  applyFilter();
}

function applyFilter() {
  const q    = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
  const cat  = categoryFilter;
  let rows   = allTransactions;

  if (cat)  rows = rows.filter(t => t.category === cat);
  if (q)    rows = rows.filter(t => t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));

  rows = sortRows(rows);
  renderAllTransactionsTable(rows);
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    let va = a[sortField], vb = b[sortField];
    if (sortField === 'amount') { va = +va; vb = +vb; }
    else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });
}

function renderAllTransactionsTable(transactions) {
  const tbody   = document.getElementById('all-transactions-body');
  const counter = document.getElementById('tx-all-count');
  counter.textContent = transactions.length ? `${transactions.length} rows` : '';

  // Update sort arrows
  ['date', 'description', 'category', 'amount'].forEach(f => {
    const el = document.getElementById(`sort-${f}`);
    if (!el) return;
    if (f === sortField) { el.textContent = sortDir === 'asc' ? '↑' : '↓'; el.className = `sort-arrow ${sortDir}`; }
    else { el.textContent = '↕'; el.className = 'sort-arrow'; }
  });

  if (!transactions.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No transactions found.</td></tr>`;
    return;
  }

  tbody.innerHTML = transactions.map(t => {
    const color  = colorMap[t.category] || '#94a3b8';
    const amtHtml = t.type === 'income'
      ? `<span class="income-amount">+₪${t.amount.toFixed(2)}</span>`
      : `₪${t.amount.toFixed(2)}`;
    return `<tr data-id="${t.id}">
      <td class="col-date">${formatDate(t.date)}</td>
      <td class="col-desc">${escHtml(t.description)}${t.recurring ? recurringIcon() : ''}</td>
      <td><span class="badge" style="--badge-color:${color}" data-cat="${escHtml(t.category)}">${escHtml(t.category)}</span></td>
      <td class="col-amount">${amtHtml}</td>
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
  // Row actions (edit / delete)
  document.getElementById('all-transactions-body').addEventListener('click', async e => {
    const btn    = e.target.closest('[data-action]');
    const badge  = e.target.closest('.badge[data-cat]');

    // Category filter via badge click
    if (badge && !btn) {
      setCategoryFilter(badge.dataset.cat);
      return;
    }

    if (!btn) return;
    const id     = parseInt(btn.dataset.id, 10);
    const action = btn.dataset.action;

    if (action === 'delete') {
      const row = btn.closest('tr');
      row.style.opacity = '0.4';
      row.style.pointerEvents = 'none';
      const result = await apiDeleteTx(id);
      if (result.success) {
        allTransactions = allTransactions.filter(t => t.id !== id);
        applyFilter();
        showToast('Transaction deleted', 'success');
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

  // Sort column headers
  document.querySelectorAll('.sortable[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const f = th.dataset.sort;
      if (sortField === f) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortField = f; sortDir = f === 'date' || f === 'amount' ? 'desc' : 'asc'; }
      applyFilter();
    });
  });

  // Search
  document.getElementById('search-input').addEventListener('input', applyFilter);

  // Export
  document.getElementById('export-btn').addEventListener('click', exportCSV);

  // Category filter chip clear
  document.getElementById('category-chip-clear').addEventListener('click', () => setCategoryFilter(null));
}

function setCategoryFilter(cat) {
  categoryFilter = cat;
  const wrap  = document.getElementById('category-chip-wrap');
  const label = document.getElementById('category-chip-label');
  if (cat) {
    label.textContent = cat;
    wrap.hidden = false;
  } else {
    wrap.hidden = true;
  }
  applyFilter();
}

// ── Export CSV ────────────────────────────────────────────────────────────────

function exportCSV() {
  function esc(val) {
    const s = String(val);
    return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  const q   = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
  const cat = categoryFilter;
  let rows  = allTransactions;
  if (cat) rows = rows.filter(t => t.category === cat);
  if (q)   rows = rows.filter(t => t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
  rows = sortRows(rows);

  const lines = rows.map(t =>
    [esc(t.date), esc(t.description), esc(t.amount), esc(t.category), esc(t.type || 'expense'), esc(t.recurring ? '1' : '0')].join(',')
  );
  const csv  = ['date,description,amount,category,type,recurring', ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `transactions-${currentMonth || 'all'}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

// ── Reports page ──────────────────────────────────────────────────────────────

async function loadReports(q) {
  const prev = getPrevMonth(filterMode === 'month' ? currentMonth : null);
  const prevQ = prev ? `?month=${prev}` : '';

  const [categories, bud, allDaily, prevCats] = await Promise.all([
    fetch(`/api/categories${q}`).then(r => r.json()),
    fetchBudgets(),
    fetch('/api/daily').then(r => r.json()),
    prevQ ? fetch(`/api/categories${prevQ}`).then(r => r.json()) : Promise.resolve([]),
  ]);

  budgets  = bud;
  colorMap = Object.fromEntries(categories.map(c => [c.category, c.color]));

  updateSidebarBadge(categories, budgets);

  const match = knownMonths.find(m => m.value === currentMonth);
  document.getElementById('budget-month-label').textContent = match ? match.label : 'all months';

  renderBudgetGoals(categories);
  renderMonthlyChart(allDaily);
  renderCategoryComparisonChart(categories, prevCats);
}

function renderBudgetGoals(categories) {
  const list = document.getElementById('budget-goals-list');

  if (!categories.length) {
    list.innerHTML = `<p class="empty-row">No transactions for this period.</p>`;
    return;
  }

  list.innerHTML = [...categories]
    .sort((a, b) => b.amount - a.amount)
    .map(cat => {
      const limit    = budgets[cat.category];
      const hasLimit = limit != null && limit > 0;
      const pct      = hasLimit ? Math.min((cat.amount / limit) * 100, 100) : 0;
      const over     = hasLimit && cat.amount > limit;
      return `
        <div class="budget-goal-row">
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
                <input class="budget-input" type="number" min="0" step="10"
                  placeholder="∞" value="${hasLimit ? limit : ''}"
                  data-category="${escHtml(cat.category)}" />
              </span>
            </div>
          </div>
          <div class="progress-bar-track">
            <div class="progress-bar-fill ${over ? 'progress-over' : ''}"
                 style="width:${hasLimit ? pct : 0}%;background:${over ? '' : cat.color}"></div>
          </div>
        </div>`;
    }).join('');

  list.querySelectorAll('.budget-input').forEach(input => {
    input.addEventListener('change', async () => {
      const cat = input.dataset.category;
      const val = parseFloat(input.value);
      if (isNaN(val) || val <= 0) { delete budgets[cat]; input.value = ''; }
      else budgets[cat] = val;
      await saveBudgets();
      const q    = buildQuery();
      const cats = await fetch(`/api/categories${q}`).then(r => r.json());
      renderBudgetGoals(cats);
      updateSidebarBadge(cats, budgets);
      showToast('Budget saved', 'success');
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  });
}

function renderMonthlyChart(allDaily) {
  if (monthlyChartInst) { monthlyChartInst.destroy(); monthlyChartInst = null; }

  const map = {};
  allDaily.forEach(d => { const m = d.date.slice(0, 7); map[m] = (map[m] || 0) + d.amount; });
  const sorted = Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-12);
  const labels = sorted.map(([m]) => {
    const [y, mo] = m.split('-');
    return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  });
  const data = sorted.map(([, v]) => +v.toFixed(2));
  const cc   = chartColors();

  monthlyChartInst = new Chart(document.getElementById('monthly-chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Total Expenses', data, backgroundColor: '#6366f1cc', borderColor: '#6366f1', borderWidth: 0, borderRadius: 6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: cc.grid }, border: { display: false }, ticks: { callback: v => `₪${v}`, color: cc.tick, font: { size: 11 } } },
        x: { grid: { display: false }, border: { display: false }, ticks: { color: cc.tick, font: { size: 11 } } },
      },
    },
  });
}

function renderCategoryComparisonChart(currCats, prevCats) {
  if (compChartInst) { compChartInst.destroy(); compChartInst = null; }

  const allCats = [...new Set([...currCats.map(c => c.category), ...prevCats.map(c => c.category)])];
  if (!allCats.length) return;

  const prevMap = Object.fromEntries(prevCats.map(c => [c.category, c.amount]));
  const currMap = Object.fromEntries(currCats.map(c => [c.category, c.amount]));
  const cc      = chartColors();

  // Update label to show what months are being compared
  const currLabel = knownMonths.find(m => m.value === currentMonth)?.label || 'Current';
  const prevMonth = getPrevMonth(currentMonth);
  const prevLabel = (prevMonth && knownMonths.find(m => m.value === prevMonth)?.label) || 'Previous';
  document.getElementById('comparison-sub').textContent = `${prevLabel} vs ${currLabel}`;

  compChartInst = new Chart(document.getElementById('comparison-chart'), {
    type: 'bar',
    data: {
      labels: allCats,
      datasets: [
        { label: prevLabel, data: allCats.map(c => prevMap[c] || 0), backgroundColor: '#94a3b855', borderColor: '#94a3b8', borderWidth: 1, borderRadius: 4 },
        { label: currLabel, data: allCats.map(c => currMap[c] || 0), backgroundColor: allCats.map(c => (colorMap[c] || '#6366f1') + 'cc'), borderColor: allCats.map(c => colorMap[c] || '#6366f1'), borderWidth: 0, borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { padding: 14, usePointStyle: true, font: { size: 12 }, color: cc.legend } } },
      scales: {
        y: { beginAtZero: true, grid: { color: cc.grid }, border: { display: false }, ticks: { callback: v => `₪${v}`, color: cc.tick, font: { size: 11 } } },
        x: { grid: { display: false }, border: { display: false }, ticks: { color: cc.tick, font: { size: 11 }, maxRotation: 30 } },
      },
    },
  });
}

// ── Print report ──────────────────────────────────────────────────────────────

async function printReport() {
  const q      = buildQuery();
  const match  = knownMonths.find(m => m.value === currentMonth);
  const label  = filterMode === 'custom' && customFrom && customTo
    ? `${formatDate(customFrom)} — ${formatDate(customTo)}`
    : (match ? match.label : 'All Months');

  const [summary, categories, transactions] = await Promise.all([
    fetch(`/api/summary${q}`).then(r => r.json()),
    fetch(`/api/categories${q}`).then(r => r.json()),
    fetch(`/api/transactions${q}`).then(r => r.json()),
  ]);
  const bud = await fetchBudgets();

  const top5 = [...transactions].filter(t => t.type !== 'income').sort((a, b) => b.amount - a.amount).slice(0, 5);

  const budRows = categories.map(c => {
    const lim  = bud[c.category];
    const pct  = lim ? Math.round((c.amount / lim) * 100) : null;
    const bar  = lim ? `<div style="height:6px;background:#e2e8f0;border-radius:4px;overflow:hidden"><div style="height:100%;width:${Math.min(pct,100)}%;background:${c.amount > lim ? '#f43f5e' : c.color};border-radius:4px"></div></div>` : '';
    const limStr = lim ? `₪${lim.toFixed(2)}` : 'No limit';
    return `<tr>
      <td style="padding:8px 6px;border-bottom:1px solid #f1f5f9">${escHtml(c.category)}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600">₪${c.amount.toFixed(2)}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #f1f5f9;text-align:right;color:#64748b">${limStr}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #f1f5f9;width:120px">${bar}${pct != null ? `<span style="font-size:11px;color:#64748b">${pct}%</span>` : ''}</td>
    </tr>`;
  }).join('');

  const txRows = transactions.slice(0, 50).map(t =>
    `<tr>
      <td style="padding:7px 6px;border-bottom:1px solid #f1f5f9;color:#64748b">${formatDate(t.date)}</td>
      <td style="padding:7px 6px;border-bottom:1px solid #f1f5f9">${escHtml(t.description)}${t.recurring ? ' ↺' : ''}</td>
      <td style="padding:7px 6px;border-bottom:1px solid #f1f5f9">${escHtml(t.category)}</td>
      <td style="padding:7px 6px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;color:${t.type === 'income' ? '#10b981' : '#0f172a'}">${t.type === 'income' ? '+' : ''}₪${t.amount.toFixed(2)}</td>
    </tr>`
  ).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>BudgetLite Report – ${label}</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;margin:0;padding:40px;font-size:14px}
    h1{font-size:26px;font-weight:700;margin-bottom:4px}
    .sub{color:#64748b;margin-bottom:32px;font-size:13px}
    .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px}
    .card{border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px}
    .card-lbl{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:4px;font-weight:600}
    .card-val{font-size:22px;font-weight:700}
    h2{font-size:16px;font-weight:700;margin:24px 0 12px;border-bottom:2px solid #f1f5f9;padding-bottom:8px}
    table{width:100%;border-collapse:collapse}
    th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;padding:0 6px 10px;border-bottom:1px solid #e2e8f0;font-weight:600}
    th:last-child,td:last-child{text-align:right}
    .positive{color:#10b981}.negative{color:#f43f5e}
    @media print{@page{margin:20mm}}
  </style></head><body>
  <h1>BudgetLite Monthly Report</h1>
  <p class="sub">${label} &bull; Generated ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</p>

  <div class="cards">
    <div class="card"><div class="card-lbl">Total Expenses</div><div class="card-val">₪${summary.totalExpenses.toFixed(2)}</div></div>
    <div class="card"><div class="card-lbl">Total Income</div><div class="card-val positive">₪${summary.totalIncome.toFixed(2)}</div></div>
    <div class="card"><div class="card-lbl">Net Balance</div><div class="card-val ${summary.netBalance >= 0 ? 'positive' : 'negative'}">${summary.netBalance >= 0 ? '+' : ''}₪${summary.netBalance.toFixed(2)}</div></div>
    <div class="card"><div class="card-lbl">Transactions</div><div class="card-val">${summary.transactionCount}</div></div>
  </div>

  <h2>Budget Goals</h2>
  <table><thead><tr><th>Category</th><th style="text-align:right">Spent</th><th style="text-align:right">Limit</th><th style="text-align:right">Progress</th></tr></thead>
  <tbody>${budRows}</tbody></table>

  <h2>Top 5 Expenses</h2>
  <table><thead><tr><th>#</th><th>Description</th><th>Category</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>${top5.map((t, i) => `<tr><td style="padding:7px 6px;border-bottom:1px solid #f1f5f9;color:#64748b;font-weight:700">${i + 1}</td><td style="padding:7px 6px;border-bottom:1px solid #f1f5f9">${escHtml(t.description)}</td><td style="padding:7px 6px;border-bottom:1px solid #f1f5f9;color:#64748b">${escHtml(t.category)}</td><td style="padding:7px 6px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700">₪${t.amount.toFixed(2)}</td></tr>`).join('')}</tbody></table>

  <h2>Transactions (${transactions.length > 50 ? 'first 50 of ' + transactions.length : transactions.length})</h2>
  <table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>${txRows}</tbody></table>

  <script>window.onload = () => { window.print(); }<\/script>
  </body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

// ── Category datalist ─────────────────────────────────────────────────────────

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
  document.getElementById('tx-recurring').checked        = !!tx.recurring;

  // Set type toggle
  const type = tx.type || 'expense';
  document.getElementById('tx-type').value = type;
  document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));

  setAddFeedback('', '');
  document.getElementById('add-modal').hidden = false;
}

function initAddModal() {
  const trigger  = document.getElementById('add-transaction-trigger');
  const modal    = document.getElementById('add-modal');
  const closeBtn = document.getElementById('add-modal-close');
  const cancelBtn = document.getElementById('add-cancel');
  const form     = document.getElementById('add-form');
  const dateInput = document.getElementById('tx-date');

  // Type segmented control
  document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tx-type').value = btn.dataset.type;
    });
  });

  const resetForm = () => {
    form.reset();
    document.getElementById('tx-editing-id').value = '';
    document.getElementById('tx-type').value = 'expense';
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.type === 'expense'));
    dateInput.value = new Date().toISOString().slice(0, 10);
    setAddFeedback('', '');
  };

  const openModal = () => {
    document.getElementById('add-modal-title').textContent = 'Add Transaction';
    document.getElementById('add-submit').textContent      = 'Save Transaction';
    resetForm();
    modal.hidden = false;
  };

  const closeModal = () => { modal.hidden = true; resetForm(); };

  trigger.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const editingId   = document.getElementById('tx-editing-id').value;
    const date        = document.getElementById('tx-date').value;
    const description = document.getElementById('tx-description').value.trim();
    const amount      = document.getElementById('tx-amount').value;
    const category    = document.getElementById('tx-category').value.trim();
    const type        = document.getElementById('tx-type').value;
    const recurring   = document.getElementById('tx-recurring').checked;

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
        body: JSON.stringify({ date, description, amount: parseFloat(amount), category, type, recurring }),
      });
      const data = await res.json();
      if (!res.ok) { setAddFeedback(data.error, 'error'); return; }

      setAddFeedback(isEdit ? '✓ Changes saved!' : '✓ Transaction saved!', 'success');
      showToast(isEdit ? 'Transaction updated' : 'Transaction added', 'success');

      knownMonths = await fetchMonths();
      populateMonthPicker(knownMonths);
      if (filterMode === 'month') {
        const txMonth = date.slice(0, 7);
        if (!currentMonth || currentMonth === txMonth) await loadCurrentPage();
      } else {
        await loadCurrentPage();
      }
      setTimeout(closeModal, 1000);
    } catch { setAddFeedback('Failed to save. Please try again.', 'error'); }
  });
}

// ── Upload modal ──────────────────────────────────────────────────────────────

function initUploadModal() {
  const trigger  = document.getElementById('upload-trigger');
  const modal    = document.getElementById('upload-modal');
  const closeBtn = document.getElementById('modal-close');
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('csv-file-input');
  const feedback  = document.getElementById('upload-feedback');

  const setFb   = (msg, type) => { feedback.textContent = msg; feedback.className = `upload-feedback ${type}`; };
  const openModal  = () => { modal.hidden = false; setFb('', ''); };
  const closeModal = () => { modal.hidden = true; fileInput.value = ''; };

  trigger.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleUpload(fileInput.files[0]); });
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]);
  });

  async function handleUpload(file) {
    setFb('Uploading…', 'info');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res  = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { setFb(data.error, 'error'); return; }
      setFb(`✓ Merged: ${data.added} new row${data.added !== 1 ? 's' : ''} added (${data.rows} total)`, 'success');
      knownMonths = await fetchMonths();
      populateMonthPicker(knownMonths);
      if (filterMode === 'month') {
        currentMonth = knownMonths[0]?.value || null;
        document.getElementById('month-picker').value = currentMonth || '';
      }
      updateTopbarSub();
      await loadCurrentPage();
      setTimeout(closeModal, 2000);
    } catch { setFb('Upload failed. Please try again.', 'error'); }
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function recurringIcon() {
  return `<svg class="recurring-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" title="Recurring"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>`;
}

function setAddFeedback(msg, type) {
  const el = document.getElementById('add-feedback');
  if (!el) return;
  el.textContent = msg;
  el.className   = `add-feedback ${type}`;
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  initDarkMode();

  // Sidebar nav
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); switchPage(el.dataset.page); });
  });

  // View all → Transactions
  document.getElementById('view-all-btn').addEventListener('click', () => switchPage('transactions'));

  // Print report
  document.getElementById('print-report-btn').addEventListener('click', printReport);

  // Load months
  knownMonths = await fetchMonths();
  populateMonthPicker(knownMonths);
  currentMonth = knownMonths[0]?.value || null;
  updateTopbarSub();

  // Date range filter init
  initDateRangeFilter();

  // Modals
  initAddModal();
  initUploadModal();
  initTransactionActions();

  // Initial load
  await loadOverview(buildQuery());
});
