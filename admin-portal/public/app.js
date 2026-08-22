/* ═══════════════════════════════════════════════════════════════════════════
   Zain Catering Admin Portal — Client-Side Application
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── State ──────────────────────────────────────────────────────────────────
let currentPage = 'dashboard';

// ─── DOM References ─────────────────────────────────────────────────────────
const contentArea = document.getElementById('content-area');
const pageTitle = document.getElementById('page-title');
const refreshBtn = document.getElementById('refresh-btn');
const menuToggle = document.getElementById('menu-toggle');
const sidebar = document.getElementById('sidebar');

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatCurrency(amount) {
  if (amount == null) return 'PKR 0';
  return 'PKR ' + Number(amount).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function badge(status) {
  if (!status) return '';
  const display = status.replace(/_/g, ' ');
  return `<span class="badge badge-${status}">${display}</span>`;
}

function showLoading() {
  contentArea.innerHTML = `
    <div class="loading-spinner">
      <div class="spinner"></div>
      <p>Loading data...</p>
    </div>
  `;
}

function showEmpty(message = 'No records found') {
  return `
    <div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <p>${message}</p>
      <small>Try adjusting your filters or adding new records</small>
    </div>
  `;
}

async function fetchApi(endpoint) {
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

function exportTableToCSV(tableId, filename) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const rows = table.querySelectorAll('tr');
  let csv = [];
  rows.forEach(row => {
    const cols = row.querySelectorAll('th, td');
    const rowData = [];
    cols.forEach(col => rowData.push('"' + col.textContent.replace(/"/g, '""').trim() + '"'));
    csv.push(rowData.join(','));
  });
  const blob = new Blob([csv.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════════════
//  PAGE RENDERERS
// ═══════════════════════════════════════════════════════════════════════════

// ─── Dashboard ──────────────────────────────────────────────────────────────
async function renderDashboard() {
  showLoading();
  try {
    const data = await fetchApi('/api/dashboard');
    const k = data.kpis;

    let recentRows = '';
    const recentList = data.recentOrders || data.recent_orders || [];
    if (recentList.length === 0) {
      recentRows = `<tr><td colspan="7">${showEmpty('No orders yet')}</td></tr>`;
    } else {
      recentRows = recentList.map(o => `
        <tr>
          <td>${o.order_ref}</td>
          <td>${o.client_name}</td>
          <td>${o.client_phone}</td>
          <td>${formatDate(o.event_date)}</td>
          <td>${o.guest_count}</td>
          <td>${badge(o.status)}</td>
          <td class="currency">${o.invoice_total ? formatCurrency(o.invoice_total) : '—'}</td>
        </tr>
      `).join('');
    }

    const totalOrders = k.totalOrders !== undefined ? k.totalOrders : k.total_orders;
    const totalRevenue = k.totalRevenue !== undefined ? k.totalRevenue : k.total_revenue;
    const pendingBalance = k.pendingBalance !== undefined ? k.pendingBalance : k.pending_balance;
    const totalClients = k.totalClients !== undefined ? k.totalClients : k.total_clients;

    const notifs = data.notifications || { promisesDue: [], overdueBalances: [], upcomingUnpaid: [] };
    const promises = notifs.promisesDue || [];
    const overdues = notifs.overdueBalances || [];
    const upcoming = notifs.upcomingUnpaid || [];
    const totalNotifs = promises.length + overdues.length + upcoming.length;

    let notifCardHtml = '';
    if (totalNotifs === 0) {
      notifCardHtml = `
        <div class="notice-card fade-in">
          <div class="notice-head">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <strong>All Payments Up to Date</strong>
          </div>
          <p class="notice-body">Zero pending promises due today, no overdue balances, and all upcoming events in next 48h are settled.</p>
        </div>
      `;
    } else {
      let promiseItems = promises.map(p => `<li>💳 <strong>${p.client_name}</strong> (${p.client_phone || p.phone}) &mdash; Promised <strong>${formatCurrency(p.promised_amount)}</strong> today for Invoice <code>${p.invoice_number}</code></li>`).join('');
      let overdueItems = overdues.map(o => `<li>⚠️ <strong>${o.client_name}</strong> (${o.client_phone || o.phone}) &mdash; Owes <span class="amount-danger">${formatCurrency(o.balance)}</span> on Invoice <code>${o.invoice_number}</code> (Event was ${formatDate(o.event_date)})</li>`).join('');
      let upcomingItems = upcoming.map(u => `<li>📅 <strong>${u.order_ref}</strong> (${u.client_name}, ${u.client_phone || u.phone}) &mdash; Event on <strong>${formatDate(u.event_date)}</strong>, <span class="amount-warn">${formatCurrency(u.balance)}</span> unpaid</li>`).join('');

      notifCardHtml = `
        <div class="table-card alert-card fade-in">
          <div class="table-header">
            <div class="alert-head-group">
              <span class="table-title">Operational Notifications</span>
              <span class="status-badge status-pending">${totalNotifs} Action Alert(s)</span>
            </div>
            <small class="alert-head-meta">Real-time PostgreSQL tracking</small>
          </div>
          <div class="alert-groups">
            ${promises.length > 0 ? `<div><strong class="alert-group-title is-info">Payment Promises Due Today (${promises.length})</strong><ul class="alert-list">${promiseItems}</ul></div>` : ''}
            ${overdues.length > 0 ? `<div><strong class="alert-group-title is-danger">Overdue Balances Needing Follow-up (${overdues.length})</strong><ul class="alert-list">${overdueItems}</ul></div>` : ''}
            ${upcoming.length > 0 ? `<div><strong class="alert-group-title is-warn">Events in Next 48h With Balance Due (${upcoming.length})</strong><ul class="alert-list">${upcomingItems}</ul></div>` : ''}
          </div>
        </div>
      `;
    }

    contentArea.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card fade-in fade-in-delay-1">
          <div class="kpi-label">Total Orders</div>
          <div class="kpi-value">${totalOrders}</div>
          <div class="kpi-sub">All time orders placed</div>
        </div>
        <div class="kpi-card fade-in fade-in-delay-2">
          <div class="kpi-label">Total Revenue</div>
          <div class="kpi-value">${formatCurrency(totalRevenue)}</div>
          <div class="kpi-sub">From confirmed invoices</div>
        </div>
        <div class="kpi-card fade-in fade-in-delay-3">
          <div class="kpi-label">Pending Balance</div>
          <div class="kpi-value currency-negative">${formatCurrency(pendingBalance)}</div>
          <div class="kpi-sub">Outstanding receivables</div>
        </div>
        <div class="kpi-card fade-in fade-in-delay-4">
          <div class="kpi-label">Active Clients</div>
          <div class="kpi-value">${totalClients}</div>
          <div class="kpi-sub">Registered customers</div>
        </div>
      </div>

      ${notifCardHtml}

      <div class="table-card fade-in" style="animation-delay: 0.25s; opacity: 0;">
        <div class="table-header">
          <span class="table-title">Recent Orders</span>
        </div>
        <div class="data-table-wrapper">
          <table class="data-table" id="dashboard-table">
            <thead>
              <tr>
                <th>Order Ref</th>
                <th>Client</th>
                <th>Phone</th>
                <th>Event Date</th>
                <th>Guests</th>
                <th>Status</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>${recentRows}</tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    contentArea.innerHTML = `<div class="empty-state"><p>Error loading dashboard: ${err.message}</p></div>`;
  }
}

// ─── Orders ─────────────────────────────────────────────────────────────────
async function renderOrders(statusFilter = 'all', searchTerm = '') {
  showLoading();
  try {
    let url = '/api/orders?status=' + statusFilter;
    if (searchTerm) url += '&search=' + encodeURIComponent(searchTerm);
    const orders = await fetchApi(url);

    let rows = '';
    if (orders.length === 0) {
      rows = `<tr><td colspan="8">${showEmpty('No orders match your filters')}</td></tr>`;
    } else {
      rows = orders.map(o => `
        <tr>
          <td>${o.order_ref}</td>
          <td>${o.client_name}</td>
          <td>${o.client_phone}</td>
          <td>${formatDate(o.event_date)}</td>
          <td>${o.guest_count}</td>
          <td>${badge(o.status)}</td>
          <td class="currency">${o.invoice_total ? formatCurrency(o.invoice_total) : '—'}</td>
          <td class="currency ${o.invoice_balance > 0 ? 'currency-negative' : ''}">${o.invoice_balance != null ? formatCurrency(o.invoice_balance) : '—'}</td>
        </tr>
      `).join('');
    }

    contentArea.innerHTML = `
      <div class="table-card fade-in">
        <div class="table-header">
          <span class="table-title">All Orders (${orders.length})</span>
          <div class="table-controls">
            <input type="text" class="search-input" id="orders-search" placeholder="Search orders..." value="${searchTerm}">
            <select class="filter-select" id="orders-filter">
              <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>All Statuses</option>
              <option value="new" ${statusFilter === 'new' ? 'selected' : ''}>New</option>
              <option value="confirmed" ${statusFilter === 'confirmed' ? 'selected' : ''}>Confirmed</option>
              <option value="completed" ${statusFilter === 'completed' ? 'selected' : ''}>Completed</option>
              <option value="cancelled" ${statusFilter === 'cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>
            <button class="export-btn" onclick="exportTableToCSV('orders-table', 'orders.csv')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export CSV
            </button>
          </div>
        </div>
        <div class="data-table-wrapper">
          <table class="data-table" id="orders-table">
            <thead>
              <tr>
                <th>Order Ref</th>
                <th>Client</th>
                <th>Phone</th>
                <th>Event Date</th>
                <th>Guests</th>
                <th>Status</th>
                <th>Invoice Total</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;

    // Wire up filter and search
    let searchTimeout;
    document.getElementById('orders-search').addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        renderOrders(document.getElementById('orders-filter').value, e.target.value);
      }, 400);
    });
    document.getElementById('orders-filter').addEventListener('change', (e) => {
      renderOrders(e.target.value, document.getElementById('orders-search').value);
    });
  } catch (err) {
    contentArea.innerHTML = `<div class="empty-state"><p>Error loading orders: ${err.message}</p></div>`;
  }
}

// ─── Clients ────────────────────────────────────────────────────────────────
async function renderClients(searchTerm = '') {
  showLoading();
  try {
    let url = '/api/clients';
    if (searchTerm) url += '?search=' + encodeURIComponent(searchTerm);
    const clients = await fetchApi(url);

    let rows = '';
    if (clients.length === 0) {
      rows = `<tr><td colspan="6">${showEmpty('No clients found')}</td></tr>`;
    } else {
      rows = clients.map(c => `
        <tr>
          <td>${c.name}</td>
          <td>${c.phone}</td>
          <td>${c.email || '—'}</td>
          <td>${c.address || '—'}</td>
          <td>${c.order_count}</td>
          <td>${formatDate(c.last_event_date)}</td>
        </tr>
      `).join('');
    }

    contentArea.innerHTML = `
      <div class="table-card fade-in">
        <div class="table-header">
          <span class="table-title">All Clients (${clients.length})</span>
          <div class="table-controls">
            <input type="text" class="search-input" id="clients-search" placeholder="Search clients..." value="${searchTerm}">
            <button class="export-btn" onclick="exportTableToCSV('clients-table', 'clients.csv')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export CSV
            </button>
          </div>
        </div>
        <div class="data-table-wrapper">
          <table class="data-table" id="clients-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Address</th>
                <th>Orders</th>
                <th>Last Event</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;

    let searchTimeout;
    document.getElementById('clients-search').addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => renderClients(e.target.value), 400);
    });
  } catch (err) {
    contentArea.innerHTML = `<div class="empty-state"><p>Error loading clients: ${err.message}</p></div>`;
  }
}

// ─── Invoices ───────────────────────────────────────────────────────────────
async function renderInvoices(statusFilter = 'all', searchTerm = '') {
  showLoading();
  try {
    let url = '/api/invoices?status=' + statusFilter;
    if (searchTerm) url += '&search=' + encodeURIComponent(searchTerm);
    const invoices = await fetchApi(url);

    let rows = '';
    if (invoices.length === 0) {
      rows = `<tr><td colspan="8">${showEmpty('No invoices match your filters')}</td></tr>`;
    } else {
      rows = invoices.map(inv => `
        <tr>
          <td>${inv.invoice_number}</td>
          <td>${inv.order_ref}</td>
          <td>${inv.client_name}</td>
          <td>${formatDate(inv.event_date)}</td>
          <td class="currency">${formatCurrency(inv.total)}</td>
          <td class="currency currency-positive">${formatCurrency(inv.paid_amount)}</td>
          <td class="currency ${inv.balance > 0 ? 'currency-negative' : ''}">${formatCurrency(inv.balance)}</td>
          <td>${badge(inv.status)}</td>
        </tr>
      `).join('');
    }

    contentArea.innerHTML = `
      <div class="table-card fade-in">
        <div class="table-header">
          <span class="table-title">All Invoices (${invoices.length})</span>
          <div class="table-controls">
            <input type="text" class="search-input" id="invoices-search" placeholder="Search invoices..." value="${searchTerm}">
            <select class="filter-select" id="invoices-filter">
              <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>All Statuses</option>
              <option value="unpaid" ${statusFilter === 'unpaid' ? 'selected' : ''}>Unpaid</option>
              <option value="partial" ${statusFilter === 'partial' ? 'selected' : ''}>Partial</option>
              <option value="paid" ${statusFilter === 'paid' ? 'selected' : ''}>Paid</option>
            </select>
            <button class="export-btn" onclick="exportTableToCSV('invoices-table', 'invoices.csv')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export CSV
            </button>
          </div>
        </div>
        <div class="data-table-wrapper">
          <table class="data-table" id="invoices-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Order Ref</th>
                <th>Client</th>
                <th>Event Date</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;

    let searchTimeout;
    document.getElementById('invoices-search').addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        renderInvoices(document.getElementById('invoices-filter').value, e.target.value);
      }, 400);
    });
    document.getElementById('invoices-filter').addEventListener('change', (e) => {
      renderInvoices(e.target.value, document.getElementById('invoices-search').value);
    });
  } catch (err) {
    contentArea.innerHTML = `<div class="empty-state"><p>Error loading invoices: ${err.message}</p></div>`;
  }
}

// ─── Payments ───────────────────────────────────────────────────────────────
async function renderPayments(searchTerm = '') {
  showLoading();
  try {
    let url = '/api/payments';
    if (searchTerm) url += '?search=' + encodeURIComponent(searchTerm);
    const payments = await fetchApi(url);

    let rows = '';
    if (payments.length === 0) {
      rows = `<tr><td colspan="7">${showEmpty('No payments recorded yet')}</td></tr>`;
    } else {
      rows = payments.map(p => `
        <tr>
          <td>${p.invoice_number}</td>
          <td>${p.client_name}</td>
          <td>${p.is_promise ? badge('pending') + ' Promise' : formatCurrency(p.amount)}</td>
          <td>${p.method || '—'}</td>
          <td>${p.is_promise ? formatCurrency(p.promised_amount) : '—'}</td>
          <td>${p.is_promise ? formatDate(p.promised_date) : '—'}</td>
          <td>${p.is_promise ? badge(p.promise_status) : badge('paid')}</td>
        </tr>
      `).join('');
    }

    contentArea.innerHTML = `
      <div class="table-card fade-in">
        <div class="table-header">
          <span class="table-title">All Payments (${payments.length})</span>
          <div class="table-controls">
            <input type="text" class="search-input" id="payments-search" placeholder="Search payments..." value="${searchTerm}">
            <button class="export-btn" onclick="exportTableToCSV('payments-table', 'payments.csv')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export CSV
            </button>
          </div>
        </div>
        <div class="data-table-wrapper">
          <table class="data-table" id="payments-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Client</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Promised Amount</th>
                <th>Promise Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;

    let searchTimeout;
    document.getElementById('payments-search').addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => renderPayments(e.target.value), 400);
    });
  } catch (err) {
    contentArea.innerHTML = `<div class="empty-state"><p>Error loading payments: ${err.message}</p></div>`;
  }
}

// ─── Logs ───────────────────────────────────────────────────────────────────
async function renderLogs() {
  showLoading();
  try {
    const logs = await fetchApi('/api/system-errors');
    
    let rows = '';
    if (logs.length === 0) {
      rows = `<tr><td colspan="4">${showEmpty('No system errors recorded')}</td></tr>`;
    } else {
      rows = logs.map(e => `
        <tr>
          <td class="log-time">${formatDateTime(e.created_at)}</td>
          <td><strong class="log-node">${e.node_name}</strong></td>
          <td><code>${e.execution_id || '—'}</code></td>
          <td><div class="log-msg">${e.error_msg}</div></td>
        </tr>
      `).join('');
    }

    contentArea.innerHTML = `
      <div class="table-card fade-in">
        <div class="table-header">
          <div>
            <span class="table-title">System Workflow Logs (${logs.length})</span>
            <p class="card-subtitle">Recorded errors from the n8n automation pipeline</p>
          </div>
        </div>
        <div class="data-table-wrapper">
          <table class="data-table" id="logs-table">
            <thead>
              <tr>
                <th style="width: 180px;">Timestamp</th>
                <th style="width: 160px;">Failed Node</th>
                <th style="width: 150px;">Execution ID</th>
                <th>Error Message</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    contentArea.innerHTML = `<div class="empty-state"><p>Error loading logs: ${err.message}</p></div>`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════
const pageRenderers = {
  dashboard: renderDashboard,
  orders: renderOrders,
  clients: renderClients,
  invoices: renderInvoices,
  payments: renderPayments,
  logs: renderLogs,
};

const pageTitles = {
  dashboard: 'Dashboard',
  orders: 'Orders Management',
  clients: 'Client Directory',
  invoices: 'Invoices & Billing',
  payments: 'Payment Records',
  logs: 'System Logs',
};

function navigateTo(page) {
  currentPage = page;
  pageTitle.textContent = pageTitles[page] || page;

  // Update active nav item
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  // Close sidebar on mobile
  sidebar.classList.remove('open');

  // Render page
  const renderer = pageRenderers[page];
  if (renderer) renderer();
}

// Wire up nav items
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(item.dataset.page);
  });
});

// Refresh button
refreshBtn.addEventListener('click', () => {
  refreshBtn.classList.add('spinning');
  const renderer = pageRenderers[currentPage];
  if (renderer) {
    renderer().finally(() => {
      setTimeout(() => refreshBtn.classList.remove('spinning'), 500);
    });
  }
});

// Mobile menu toggle
menuToggle.addEventListener('click', () => {
  sidebar.classList.toggle('open');
});

// Close sidebar when clicking outside on mobile
document.addEventListener('click', (e) => {
  if (window.innerWidth <= 768 && sidebar.classList.contains('open')) {
    if (!sidebar.contains(e.target) && e.target !== menuToggle) {
      sidebar.classList.remove('open');
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  TYPEFORM-STYLE WIZARD CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════

// ─── DOM Elements for Wizard ────────────────────────────────────────────────
const overlay = document.getElementById('wizard-overlay');
const stepArea = document.getElementById('wizard-step-area');
const progressFill = document.getElementById('wizard-progress-fill');
const wizardTitle = document.getElementById('wizard-title');
const wizardDesc = document.getElementById('wizard-desc');
const stepCountText = document.getElementById('wizard-step-count');
const prevBtn = document.getElementById('wizard-prev-btn');
const nextBtn = document.getElementById('wizard-next-btn');
const nextBtnText = document.getElementById('wizard-next-btn-text');
const closeBtn = document.getElementById('wizard-close');

// ─── Wizard State ───────────────────────────────────────────────────────────
let wizardState = {
  formId: '',
  steps: [],
  currentIndex: 0,
  answers: {},
  isSubmitting: false
};

// ─── Form Configurations ─────────────────────────────────────────────────────
const WIZARD_FORMS = {
  'client-order': {
    title: 'Client Order Request',
    desc: 'Client-facing order submission form',
    endpoint: '/api/forms/client-order',
    steps: [
      { label: 'What is the customer\'s Full Name?', name: 'Full Name', type: 'text', required: true, placeholder: 'Enter name...' },
      { label: 'What is their Phone Number?', name: 'Phone Number', type: 'text', required: true, placeholder: 'e.g. 03001234567...' },
      { label: 'WhatsApp Number (if different)?', name: 'WhatsApp Number (if different)', type: 'text', required: false, placeholder: 'Leave blank if same...' },
      { label: 'What is their Email Address?', desc: 'Used for automated invoice delivery', name: 'Email Address (for invoice delivery)', type: 'email', required: false, placeholder: 'e.g. client@example.com...' },
      { label: 'Choose the Event Date:', name: 'Event Date', type: 'date', required: true },
      { label: 'Where will the event be held?', desc: 'Please specify the full venue address', name: 'Venue Address', type: 'textarea', required: true, placeholder: 'e.g. Block H3, Johar Town, Lahore...' },
      { label: 'How many guests are expected?', name: 'Number of Guests', type: 'number', required: true, placeholder: 'e.g. 150...' },
      { label: 'Does this order require a Sound System?', name: 'Sound System', type: 'dropdown', options: ['None', 'Basic', 'Premium'], required: true },
      { label: 'Any special notes or requirements?', name: 'Special Notes', type: 'textarea', required: false, placeholder: 'e.g. Specific color themes, extra tables...' }
    ]
  },
  'internal-order': {
    title: 'Internal Order Entry',
    desc: 'Take order manually over the phone',
    endpoint: '/api/forms/internal-order',
    steps: [
      { label: 'What is the customer\'s Full Name?', name: 'Full Name', type: 'text', required: true, placeholder: 'Enter name...' },
      { label: 'What is their Phone Number?', name: 'Phone Number', type: 'text', required: true, placeholder: 'e.g. 03001234567...' },
      { label: 'WhatsApp Number (if different)?', name: 'WhatsApp Number (if different)', type: 'text', required: false, placeholder: 'Leave blank if same...' },
      { label: 'What is their Email Address?', desc: 'Used for automated invoice delivery', name: 'Email Address (for invoice delivery)', type: 'email', required: false, placeholder: 'e.g. client@example.com...' },
      { label: 'Choose the Event Date:', name: 'Event Date', type: 'date', required: true },
      { label: 'Where will the event be held?', desc: 'Please specify the full venue address', name: 'Venue Address', type: 'textarea', required: true, placeholder: 'e.g. Block H3, Johar Town, Lahore...' },
      { label: 'How many guests are expected?', name: 'Number of Guests', type: 'number', required: true, placeholder: 'e.g. 150...' },
      { label: 'Does this order require a Sound System?', name: 'Sound System', type: 'dropdown', options: ['None', 'Basic', 'Premium'], required: true },
      { label: 'Any special notes or requirements?', name: 'Special Notes', type: 'textarea', required: false, placeholder: 'e.g. Specific color themes, extra tables...' }
    ]
  },
  'confirm-order': {
    title: 'Confirm Order & Issue Invoice',
    desc: 'Sets pricing and issues an invoice',
    endpoint: '/api/forms/confirm-order',
    steps: [
      {
        label: 'Select a pending order to confirm:',
        name: 'Order Reference',
        type: 'async-select',
        required: true,
        loadOptions: async () => {
          const list = await fetchApi('/api/orders/pending');
          return list.map(o => ({ value: o.order_ref, label: `${o.order_ref} - ${o.client_name} (${formatDate(o.event_date)})` }));
        }
      },
      { label: 'What is the Agreed Total Price (PKR)?', desc: 'The final price you negotiated with the client', name: 'Agreed Total Price (PKR)', type: 'number', required: true, placeholder: 'e.g. 250000...' },
      { label: 'Has an advance payment been paid?', name: 'Advance Paid', type: 'dropdown', options: ['Yes', 'No'], required: true },
      {
        label: 'What is the Advance Amount (PKR)?',
        name: 'Advance Amount (PKR)',
        type: 'number',
        required: true,
        placeholder: 'e.g. 15000...',
        skip: (answers) => answers['Advance Paid'] !== 'Yes'
      },
      {
        label: 'What was the Payment Method?',
        name: 'Payment Method',
        type: 'dropdown',
        options: ['cash', 'jazzcash', 'easypaisa', 'bank', 'other'],
        required: true,
        skip: (answers) => answers['Advance Paid'] !== 'Yes'
      },
      { label: 'Confirm the Client\'s Email Address:', desc: 'Invoice PDF will be sent here', name: 'Client Email Address', type: 'email', required: false, placeholder: 'e.g. client@example.com...' }
    ]
  },
  'log-payment': {
    title: 'Log Payment or Promise',
    desc: 'Record a cash receipt or log a promise due',
    endpoint: '/api/forms/log-payment',
    steps: [
      {
        label: 'Select the invoice number:',
        name: 'Invoice Number',
        type: 'async-select',
        required: true,
        loadOptions: async () => {
          const list = await fetchApi('/api/invoices/pending');
          return list.map(inv => ({ value: inv.invoice_number, label: `${inv.invoice_number} - ${inv.client_name} (Bal: ${formatCurrency(inv.balance)})` }));
        }
      },
      {
        label: 'Is this a Promise to Pay Later?',
        name: 'Is this a Promise to Pay Later?',
        type: 'dropdown',
        options: ['No, I am logging an actual payment now', 'Yes, Client promised to pay on a future date'],
        required: true
      },
      {
        label: 'What is the Payment Amount (PKR)?',
        name: 'Payment Amount (PKR)',
        type: 'number',
        required: true,
        placeholder: 'e.g. 10000...',
        skip: (answers) => answers['Is this a Promise to Pay Later?'] !== 'No, I am logging an actual payment now'
      },
      {
        label: 'What was the Payment Method?',
        name: 'Payment Method',
        type: 'dropdown',
        options: ['cash', 'jazzcash', 'easypaisa', 'bank', 'other'],
        required: true,
        skip: (answers) => answers['Is this a Promise to Pay Later?'] !== 'No, I am logging an actual payment now'
      },
      {
        label: 'What is the Promised Date?',
        name: 'Promised Date',
        type: 'date',
        required: true,
        skip: (answers) => answers['Is this a Promise to Pay Later?'] === 'No, I am logging an actual payment now'
      },
      {
        label: 'What is the Promised Amount (PKR)?',
        name: 'Promised Amount (PKR)',
        type: 'number',
        required: true,
        placeholder: 'e.g. 20000...',
        skip: (answers) => answers['Is this a Promise to Pay Later?'] === 'No, I am logging an actual payment now'
      }
    ]
  }
};

// ─── Wizard Core Actions ─────────────────────────────────────────────────────
function openWizard(formId) {
  const formConf = WIZARD_FORMS[formId];
  if (!formConf) return;

  wizardState = {
    formId: formId,
    steps: formConf.steps,
    currentIndex: 0,
    answers: {},
    isSubmitting: false
  };

  wizardTitle.textContent = formConf.title;
  wizardDesc.textContent = formConf.desc;
  overlay.style.display = 'flex';
  nextBtn.disabled = false;
  prevBtn.disabled = true;

  // Restore nav bar visibility (hidden during success screen)
  document.querySelector('.wizard-nav-bar').style.display = '';

  renderActiveStep();
}

function closeWizard() {
  overlay.style.display = 'none';
  // Refresh page data behind the modal
  const renderer = pageRenderers[currentPage];
  if (renderer) renderer();
}

async function renderActiveStep() {
  const index = wizardState.currentIndex;
  const step = wizardState.steps[index];

  // Progress Bar
  const pct = ((index) / wizardState.steps.length) * 100;
  progressFill.style.width = `${pct}%`;

  // Step indicator
  stepCountText.textContent = `Question ${index + 1} of ${wizardState.steps.length}`;

  // Next Button Label
  if (index === wizardState.steps.length - 1) {
    nextBtnText.textContent = 'Submit';
  } else {
    nextBtnText.textContent = 'Next';
  }

  // Back Button disabled check
  prevBtn.disabled = index === 0;

  // Clear area
  stepArea.innerHTML = '';

  // Render question text
  const qDiv = document.createElement('div');
  qDiv.className = 'wizard-input-wrapper';
  qDiv.innerHTML = `
    <h4 class="wizard-question-label"><span>${index + 1} &rarr;</span> ${step.label}</h4>
    ${step.desc ? `<p class="wizard-question-desc">${step.desc}</p>` : ''}
    <div id="wizard-input-container"></div>
  `;
  stepArea.appendChild(qDiv);

  const container = document.getElementById('wizard-input-container');
  const prevVal = wizardState.answers[step.name] !== undefined ? wizardState.answers[step.name] : (step.defaultValue !== undefined ? step.defaultValue : '');

  // Render Form Input fields based on type
  if (step.type === 'textarea') {
    container.innerHTML = `<textarea class="wizard-textarea" id="w-input" placeholder="${step.placeholder || ''}">${prevVal}</textarea>`;
    const area = document.getElementById('w-input');
    area.focus();
  } 
  else if (step.type === 'dropdown') {
    const grid = document.createElement('div');
    grid.className = 'wizard-options-grid';
    step.options.forEach((opt, oIdx) => {
      const card = document.createElement('div');
      card.className = `wizard-option-card ${prevVal === opt ? 'selected' : ''}`;
      card.dataset.option = opt;
      card.innerHTML = `
        <div class="wizard-option-badge">${String.fromCharCode(65 + oIdx)}</div>
        <span>${opt}</span>
      `;
      card.addEventListener('click', () => {
        grid.querySelectorAll('.wizard-option-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        saveAnswer();
        setTimeout(nextStep, 250); // Auto advance on option click
      });
      grid.appendChild(card);
    });
    container.appendChild(grid);
  } 
  else if (step.type === 'async-select') {
    container.innerHTML = `
      <select class="wizard-select" id="w-input">
        <option value="">-- Choose Option --</option>
      </select>
    `;
    const sel = document.getElementById('w-input');
    try {
      const opts = await step.loadOptions();
      if (opts.length === 0) {
        sel.innerHTML = `<option value="">No pending items found.</option>`;
        nextBtn.disabled = true;
      } else {
        opts.forEach(opt => {
          sel.innerHTML += `<option value="${opt.value}" ${prevVal === opt.value ? 'selected' : ''}>${opt.label}</option>`;
        });
        nextBtn.disabled = false;
        sel.focus();
      }
    } catch (err) {
      sel.innerHTML = `<option value="">Error loading items: ${err.message}</option>`;
      nextBtn.disabled = true;
    }
  } 
  else {
    // text, number, email, date
    container.innerHTML = `
      <input type="${step.type}" class="wizard-text-input" id="w-input" 
             value="${prevVal}" placeholder="${step.placeholder || ''}" autocomplete="off">
      <div class="wizard-keytip"><kbd>Enter</kbd> to proceed</div>
    `;
    const inp = document.getElementById('w-input');
    inp.focus();

    // Support enter key navigation
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        nextStep();
      }
    });
  }
}

function saveAnswer() {
  const index = wizardState.currentIndex;
  const step = wizardState.steps[index];
  const inputEl = document.getElementById('w-input');

  if (step.type === 'dropdown') {
    const selected = stepArea.querySelector('.wizard-option-card.selected');
    wizardState.answers[step.name] = selected ? selected.dataset.option : '';
  } else if (inputEl) {
    let val = inputEl.value;
    if (step.type === 'number') {
      val = val === '' ? '' : Number(val);
    }
    wizardState.answers[step.name] = val;
  }
}

function nextStep() {
  saveAnswer();

  // Validate requirement
  const index = wizardState.currentIndex;
  const step = wizardState.steps[index];
  const currentVal = wizardState.answers[step.name];

  if (step.required && (currentVal === undefined || currentVal === '')) {
    alert(`Please answer the question before proceeding.`);
    return;
  }

  // Go to next step
  let nextIdx = index + 1;
  while (nextIdx < wizardState.steps.length) {
    const nextStep = wizardState.steps[nextIdx];
    if (nextStep.skip && nextStep.skip(wizardState.answers)) {
      // Clear answers of skipped step to prevent dirty data submissions
      delete wizardState.answers[nextStep.name];
      nextIdx++;
    } else {
      break;
    }
  }

  if (nextIdx >= wizardState.steps.length) {
    submitWizard();
  } else {
    wizardState.currentIndex = nextIdx;
    renderActiveStep();
  }
}

function prevStep() {
  saveAnswer();
  
  let prevIdx = wizardState.currentIndex - 1;
  while (prevIdx >= 0) {
    const prevStep = wizardState.steps[prevIdx];
    if (prevStep.skip && prevStep.skip(wizardState.answers)) {
      prevIdx--;
    } else {
      break;
    }
  }

  if (prevIdx >= 0) {
    wizardState.currentIndex = prevIdx;
    renderActiveStep();
  }
}

async function submitWizard() {
  if (wizardState.isSubmitting) return;
  wizardState.isSubmitting = true;

  // Show loading state
  nextBtn.disabled = true;
  prevBtn.disabled = true;
  nextBtnText.innerHTML = `<div class="spinner"></div> Submitting...`;

  const formConf = WIZARD_FORMS[wizardState.formId];
  try {
    const response = await fetch(formConf.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wizardState.answers)
    });

    let result = {};
    const text = await response.text();
    try {
      result = JSON.parse(text);
    } catch (e) {
      result = { error: text.includes('<!DOCTYPE') ? 'Service warming up. Please try submitting again in a moment.' : text };
    }

    if (!response.ok) throw new Error(result.error || 'Server error');

    // Progress Bar Full
    progressFill.style.width = `100%`;

    // Success Screen
    stepArea.innerHTML = `
      <div class="empty-state wizard-success animate-fade-in">
        <svg class="wizard-success-icon" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <h4>Submission Received</h4>
        <p>The automation engine has received this form and is processing it in the background.</p>
        <button class="action-btn" id="btn-close-success" type="button">Back to Dashboard</button>
      </div>
    `;
    document.getElementById('btn-close-success').addEventListener('click', closeWizard);

    // Hide navigation bar during success screen
    document.querySelector('.wizard-nav-bar').style.display = 'none';

  } catch (err) {
    alert(`Submission Failed: ${err.message}`);
    // Reset buttons
    nextBtn.disabled = false;
    prevBtn.disabled = wizardState.currentIndex === 0;
    nextBtnText.textContent = 'Submit';
    wizardState.isSubmitting = false;
  }
}

// ─── Wire up Event Listeners ─────────────────────────────────────────────────
closeBtn.addEventListener('click', closeWizard);
prevBtn.addEventListener('click', prevStep);
nextBtn.addEventListener('click', nextStep);

// Connect sidebar triggers to built-in wizard forms
document.getElementById('btn-client-order').addEventListener('click', () => {
  const orderUrl = window.location.origin + '/order';
  navigator.clipboard.writeText(orderUrl).then(() => {
    const btn = document.getElementById('btn-client-order');
    const originalText = btn.innerHTML;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      Link Copied
    `;
    btn.classList.add('is-copied');
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.classList.remove('is-copied');
    }, 2000);
  }).catch(() => {
    prompt('Copy this link and share with your client:', window.location.origin + '/order');
  });
});
document.getElementById('btn-internal-order').addEventListener('click', () => {
  openWizard('internal-order');
});
document.getElementById('btn-confirm-order').addEventListener('click', () => {
  openWizard('confirm-order');
});
document.getElementById('btn-log-payment').addEventListener('click', () => {
  openWizard('log-payment');
});

// Connect key listener for dropdown A, B, C buttons inside modal
document.addEventListener('keydown', (e) => {
  if (overlay.style.display !== 'flex' || wizardState.isSubmitting) return;

  // Escape key to close
  if (e.key === 'Escape') {
    closeWizard();
    return;
  }

  const step = wizardState.steps[wizardState.currentIndex];
  if (step && step.type === 'dropdown') {
    const key = e.key.toUpperCase();
    if (key >= 'A' && key <= 'Z') {
      const code = key.charCodeAt(0) - 65; // 'A' = 0
      const cards = stepArea.querySelectorAll('.wizard-option-card');
      if (cards[code]) {
        cards[code].click();
      }
    }
  }
});

// ─── Boot ───────────────────────────────────────────────────────────────────
navigateTo('dashboard');

