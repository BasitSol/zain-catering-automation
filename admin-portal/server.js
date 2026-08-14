const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── PostgreSQL Connection Pool ─────────────────────────────────────────────
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('render.com') || process.env.PGSSL === 'true'
        ? { rejectUnauthorized: false }
        : false,
      max: 10,
      idleTimeoutMillis: 30000,
    }
  : {
      host: process.env.PGHOST || 'postgres',
      port: parseInt(process.env.PGPORT || '5432'),
      user: process.env.PGUSER || 'zain_admin',
      password: process.env.PGPASSWORD || 'zaindbpass',
      database: process.env.PGDATABASE || 'zain_catering',
      max: 10,
      idleTimeoutMillis: 30000,
    };

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error:', err);
});

// ─── Helper: run query with error handling ──────────────────────────────────
async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  console.log(`Query (${duration}ms): ${text.substring(0, 80)}...`);
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// ─── Dashboard KPIs ─────────────────────────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
  try {
    const [orders, revenue, balance, clients, recentOrders, systemErrors, promisesDue, overdueBalances, upcomingUnpaid] = await Promise.all([
      query('SELECT count(*) AS total FROM orders'),
      query('SELECT COALESCE(SUM(total), 0) AS total_revenue FROM invoices'),
      query('SELECT COALESCE(SUM(balance), 0) AS pending_balance FROM invoices WHERE balance > 0'),
      query('SELECT count(*) AS total FROM clients'),
      query(`
        SELECT o.id, o.order_ref, o.event_date, o.guest_count, o.status, o.created_at,
               c.name AS client_name, c.phone AS client_phone,
               i.invoice_number, i.total AS invoice_total, i.balance AS invoice_balance
        FROM orders o
        JOIN clients c ON c.id = o.client_id
        LEFT JOIN invoices i ON i.order_id = o.id
        ORDER BY o.created_at DESC
        LIMIT 10
      `),
      query('SELECT id, node_name, error_msg, execution_id, created_at FROM system_errors ORDER BY created_at DESC LIMIT 5'),
      query(`
        SELECT p.id AS payment_id, p.promised_amount, p.promised_date, c.name AS client_name, c.phone AS client_phone, i.invoice_number
        FROM payments p
        JOIN invoices i ON i.id = p.invoice_id
        JOIN orders o ON o.id = i.order_id
        JOIN clients c ON c.id = o.client_id
        WHERE p.is_promise = true AND p.promise_status = 'pending' AND p.promised_date = CURRENT_DATE
      `),
      query(`
        SELECT i.invoice_number, i.balance, o.event_date, o.order_ref, c.name AS client_name, c.phone AS client_phone
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN clients c ON c.id = o.client_id
        WHERE i.balance > 0 AND o.event_date < CURRENT_DATE AND o.status IN ('confirmed','completed')
      `),
      query(`
        SELECT i.invoice_number, i.balance, o.event_date, o.order_ref, c.name AS client_name, c.phone AS client_phone
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN clients c ON c.id = o.client_id
        WHERE i.balance > 0 AND o.event_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '2 days') AND o.status = 'confirmed'
      `),
    ]);

    res.json({
      kpis: {
        totalOrders: parseInt(orders.rows[0].total, 10),
        totalRevenue: parseFloat(revenue.rows[0].total_revenue),
        pendingBalance: parseFloat(balance.rows[0].pending_balance),
        totalClients: parseInt(clients.rows[0].total, 10),
      },
      recentOrders: recentOrders.rows,
      systemErrors: systemErrors.rows,
      notifications: {
        promisesDue: promisesDue.rows,
        overdueBalances: overdueBalances.rows,
        upcomingUnpaid: upcomingUnpaid.rows,
      }
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Orders ─────────────────────────────────────────────────────────────────
app.get('/api/orders', async (req, res) => {
  try {
    const { status, search } = req.query;
    let sql = `
      SELECT o.id, o.order_ref, o.event_date, o.guest_count, o.venue_address,
             o.notes, o.status, o.source, o.created_at, o.confirmed_at,
             c.name AS client_name, c.phone AS client_phone, c.email AS client_email,
             i.invoice_number, i.total AS invoice_total, i.paid_amount, i.balance AS invoice_balance, i.status AS invoice_status
      FROM orders o
      JOIN clients c ON c.id = o.client_id
      LEFT JOIN invoices i ON i.order_id = o.id
    `;
    const conditions = [];
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`o.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      conditions.push(`(c.name ILIKE $${idx} OR o.order_ref ILIKE $${idx} OR c.phone ILIKE $${idx})`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY o.created_at DESC';

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Orders error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Clients ────────────────────────────────────────────────────────────────
app.get('/api/clients', async (req, res) => {
  try {
    const { search } = req.query;
    let sql = `
      SELECT c.*,
             COUNT(o.id) AS order_count,
             MAX(o.event_date) AS last_event_date
      FROM clients c
      LEFT JOIN orders o ON o.client_id = c.id
    `;
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      sql += ` WHERE c.name ILIKE $1 OR c.phone ILIKE $1 OR c.email ILIKE $1`;
    }

    sql += ' GROUP BY c.id ORDER BY c.created_at DESC';

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Clients error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Invoices ───────────────────────────────────────────────────────────────
app.get('/api/invoices', async (req, res) => {
  try {
    const { status, search } = req.query;
    let sql = `
      SELECT i.id, i.invoice_number, i.subtotal, i.total, i.paid_amount, i.balance,
             i.status, i.pdf_url, i.issued_at,
             o.order_ref, o.event_date, o.guest_count,
             c.name AS client_name, c.phone AS client_phone
      FROM invoices i
      JOIN orders o ON o.id = i.order_id
      JOIN clients c ON c.id = o.client_id
    `;
    const conditions = [];
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`i.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      conditions.push(`(c.name ILIKE $${idx} OR i.invoice_number ILIKE $${idx} OR o.order_ref ILIKE $${idx})`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY i.issued_at DESC';

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Invoices error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Payments ───────────────────────────────────────────────────────────────
app.get('/api/payments', async (req, res) => {
  try {
    const { search } = req.query;
    let sql = `
      SELECT p.id, p.amount, p.method, p.paid_at, p.is_promise,
             p.promised_amount, p.promised_date, p.promise_status, p.created_at,
             i.invoice_number,
             o.order_ref,
             c.name AS client_name, c.phone AS client_phone
      FROM payments p
      JOIN invoices i ON i.id = p.invoice_id
      JOIN orders o ON o.id = i.order_id
      JOIN clients c ON c.id = o.client_id
    `;
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      sql += ` WHERE c.name ILIKE $1 OR i.invoice_number ILIKE $1 OR o.order_ref ILIKE $1`;
    }

    sql += ' ORDER BY p.created_at DESC';

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Payments error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Dropdown helpers for custom forms ──────────────────────────────────────
app.get('/api/config/forms', (req, res) => {
  res.json({
    client_order: process.env.TYPEFORM_CLIENT_ORDER_URL || 'https://typeform.com',
    internal_order: process.env.TYPEFORM_INTERNAL_ORDER_URL || 'https://typeform.com',
    confirm_order: process.env.TYPEFORM_CONFIRM_ORDER_URL || 'https://typeform.com',
    log_payment: process.env.TYPEFORM_LOG_PAYMENT_URL || 'https://typeform.com'
  });
});

app.get('/api/orders/pending', async (req, res) => {
  try {
    const result = await query(
      "SELECT o.id, o.order_ref, c.name AS client_name, o.event_date FROM orders o JOIN clients c ON c.id = o.client_id LEFT JOIN invoices i ON i.order_id = o.id WHERE o.status IN ('new', 'pending_pricing') OR (o.status = 'confirmed' AND i.id IS NULL) ORDER BY o.created_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/invoices/pending', async (req, res) => {
  try {
    const result = await query(
      "SELECT i.id, i.invoice_number, c.name AS client_name, i.balance FROM invoices i JOIN orders o ON o.id = i.order_id JOIN clients c ON c.id = o.client_id WHERE i.status IN ('unpaid', 'partial') ORDER BY i.issued_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const N8N_URL = (process.env.N8N_BASE_URL || 'http://n8n:5678').replace(/\/+$/, '');

async function proxyToN8n(path, payload, res) {
  try {
    const prodUrl = `${N8N_URL}/webhook/${path}`;
    const testUrl = `${N8N_URL}/webhook-test/${path}`;
    console.log(`Forwarding form payload to n8n: ${prodUrl}`);
    
    let response = await fetch(prodUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    // Fallback to test webhook URL if production webhook returns 404 (workflow inactive or testing in canvas)
    if (response.status === 404) {
      console.log(`Production webhook returned 404, retrying with test URL: ${testUrl}`);
      response = await fetch(testUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`n8n responded with ${response.status}: ${text}`);
    }
    
    res.json({ success: true, message: 'Form submitted successfully!' });
  } catch (err) {
    console.error(`Proxy error for ${path}:`, err);
    res.status(500).json({ error: `Failed to submit form to automation engine: ${err.message}` });
  }
}

app.post('/api/forms/client-order', (req, res) => {
  proxyToN8n('client-order', req.body, res);
});

app.post('/api/forms/internal-order', (req, res) => {
  proxyToN8n('internal-order', req.body, res);
});

app.post('/api/forms/confirm-order', (req, res) => {
  proxyToN8n('confirm-order', req.body, res);
});

app.post('/api/forms/log-payment', (req, res) => {
  proxyToN8n('log-payment', req.body, res);
});

// ─── Public Client Order Form ───────────────────────────────────────────────
app.get('/order', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'public-order.html'));
});

// ─── SPA fallback ───────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const fs = require('fs');

// ─── Auto DB Schema Initialization ──────────────────────────────────────────
async function initDbSchema() {
  try {
    const schemaPath = path.join(__dirname, '..', 'postgres-init', '01_schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(sql);
      console.log('✅ Database schema verified/initialized successfully');
    }
  } catch (err) {
    console.error('⚠️ DB auto-init notice:', err.message);
  }
}

// ─── Start Server ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Zain Catering Admin Portal running on http://0.0.0.0:${PORT}`);
  await initDbSchema();
});
