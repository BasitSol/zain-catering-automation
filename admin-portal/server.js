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

// ─── System Errors ──────────────────────────────────────────────────────────
app.get('/api/system-errors', async (req, res) => {
  try {
    const result = await query(
      'SELECT id, node_name, error_msg, execution_id, created_at FROM system_errors ORDER BY created_at DESC LIMIT 50'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('System errors error:', err);
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
      let text = await response.text();
      // Strip HTML tags if n8n or Render returns an HTML error page (e.g. 502 Bad Gateway)
      if (text.includes('<!DOCTYPE') || text.includes('<html')) {
        text = `Service returned HTTP ${response.status} (n8n container restarting or warming up)`;
      }
      throw new Error(text);
    }
    
    res.json({ success: true, message: 'Form submitted successfully!' });
  } catch (err) {
    console.error(`Proxy error for ${path}:`, err);
    res.status(500).json({ error: err.message });
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

// ─── PDF Invoice Generation (replaces Gotenberg) ───────────────────────────
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

app.post('/api/generate-invoice-pdf', async (req, res) => {
  try {
    const d = req.body;
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4 size
    const { height } = page.getSize();

    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const brandColor = rgb(0.71, 0.22, 0.10); // #b5391a
    const darkText = rgb(0.17, 0.17, 0.17);   // #2b2b2b
    const grayText = rgb(0.33, 0.33, 0.33);   // #555555
    const lightGray = rgb(0.6, 0.6, 0.6);     // #999999
    const bgHeader = rgb(0.98, 0.94, 0.93);   // #faf1ee

    // ── Header ──
    page.drawText('Zain Catering Services', { x: 50, y: height - 60, size: 20, font: fontBold, color: brandColor });
    page.drawText('Catering & Event Arrangements', { x: 50, y: height - 76, size: 9, font: fontRegular, color: lightGray });
    page.drawText('Lahore, Punjab, Pakistan · +92 300 0000000', { x: 50, y: height - 88, size: 9, font: fontRegular, color: lightGray });

    // Invoice meta
    page.drawText(`Invoice #: ${d.invoice_number || ''}`, { x: 370, y: height - 60, size: 9, font: fontRegular, color: grayText });
    page.drawText(`Order Ref: ${d.order_ref || ''}`, { x: 370, y: height - 72, size: 9, font: fontRegular, color: grayText });
    page.drawText(`Issued: ${d.issued_date || ''}`, { x: 370, y: height - 84, size: 9, font: fontRegular, color: grayText });
    page.drawText(`Event Date: ${d.event_date || ''}`, { x: 370, y: height - 96, size: 9, font: fontRegular, color: grayText });

    // Header divider line
    page.drawLine({
      start: { x: 50, y: height - 110 },
      end: { x: 545, y: height - 110 },
      thickness: 2,
      color: brandColor,
    });

    // ── Billed To ──
    page.drawText('BILLED TO', { x: 50, y: height - 130, size: 9, font: fontBold, color: brandColor });
    page.drawText(d.client_name || '', { x: 50, y: height - 145, size: 11, font: fontBold, color: darkText });
    page.drawText(`Phone: ${d.client_phone || ''}`, { x: 50, y: height - 160, size: 9, font: fontRegular, color: grayText });

    // ── Event Details ──
    page.drawText('EVENT DETAILS', { x: 370, y: height - 130, size: 9, font: fontBold, color: brandColor });
    page.drawText(`Venue: ${d.venue_address || 'Not specified'}`, { x: 370, y: height - 145, size: 9, font: fontRegular, color: grayText });
    page.drawText(`Guests: ${d.guest_count || ''}`, { x: 370, y: height - 158, size: 9, font: fontRegular, color: grayText });
    page.drawText(`Status: ${(d.invoice_status || '').toUpperCase()}`, { x: 370, y: height - 171, size: 9, font: fontRegular, color: grayText });

    // ── Table Header ──
    let y = height - 210;
    page.drawRectangle({
      x: 50,
      y: y - 18,
      width: 495,
      height: 22,
      color: bgHeader,
    });
    page.drawText('ITEM', { x: 58, y: y - 12, size: 9, font: fontBold, color: brandColor });
    page.drawText('QUANTITY / OPTION', { x: 420, y: y - 12, size: 9, font: fontBold, color: brandColor });

    // Table Row
    y -= 38;
    page.drawText('Catering Services, Items', { x: 58, y: y, size: 10, font: fontRegular, color: darkText });
    page.drawText('Included', { x: 420, y: y, size: 10, font: fontRegular, color: darkText });

    y -= 10;
    page.drawLine({
      start: { x: 50, y: y },
      end: { x: 545, y: y },
      thickness: 0.5,
      color: rgb(0.9, 0.9, 0.9),
    });

    // ── Totals ──
    const fmt = (v) => `PKR ${Number(v || 0).toLocaleString()}`;
    y -= 30;
    page.drawText('Total Amount', { x: 350, y: y, size: 10, font: fontRegular, color: grayText });
    page.drawText(fmt(d.total), { x: 440, y: y, size: 10, font: fontRegular, color: darkText });

    y -= 20;
    page.drawText('Paid', { x: 350, y: y, size: 10, font: fontRegular, color: grayText });
    page.drawText(fmt(d.paid_amount), { x: 440, y: y, size: 10, font: fontRegular, color: darkText });

    y -= 10;
    page.drawLine({
      start: { x: 350, y: y },
      end: { x: 545, y: y },
      thickness: 2,
      color: brandColor,
    });

    y -= 20;
    page.drawText('Balance Due', { x: 350, y: y, size: 13, font: fontBold, color: brandColor });
    page.drawText(fmt(d.balance), { x: 440, y: y, size: 13, font: fontBold, color: brandColor });

    // ── Footer ──
    page.drawText(
      'Thank you for choosing Zain Catering Services. Payments accepted via Cash, JazzCash, EasyPaisa, or Bank Transfer.',
      { x: 50, y: 50, size: 8.5, font: fontRegular, color: lightGray }
    );

    const pdfBytes = await pdfDoc.save();
    const pdfBuffer = Buffer.from(pdfBytes);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${d.invoice_number || 'invoice'}.pdf"`,
      'Content-Length': pdfBuffer.length
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ error: 'PDF generation failed', details: err.message });
  }
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
