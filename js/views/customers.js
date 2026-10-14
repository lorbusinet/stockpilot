import { esc, money, num, date, ago, table, segBadge, badge, modal, SEGMENTS } from '../ui.js';
import { customerDialog } from '../actions.js';

const state = { q: '', segment: '', sort: 'spent' };
const SORTS = { spent: 'spent_cents DESC', orders: 'orders DESC', recent: 'last_order DESC', name: 'name ASC' };

export default function customers(el, ctx) {
  const { db } = ctx;

  el.innerHTML = `
    <header class="page-head">
      <div><h1>Clients</h1><p class="sub">Segmentation calculée par la vue <code>v_customer_stats</code> (récence, fréquence, montant)</p></div>
      <button class="btn primary" data-act="new">+ Nouveau client</button>
    </header>
    <div class="segments" id="segs"></div>
    <div class="toolbar">
      <input type="search" name="q" placeholder="Nom, e-mail ou ville…" value="${esc(state.q)}">
      <select name="sort">${[['spent', 'Plus gros acheteurs'], ['orders', 'Plus de commandes'], ['recent', 'Achat le plus récent'], ['name', 'Nom (A→Z)']]
        .map(([v, l]) => `<option value="${v}" ${v === state.sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="card table-wrap" id="tbl"></div>`;

  const draw = () => {
    const segs = db.all(`SELECT segment, COUNT(*) AS n, SUM(spent_cents) AS spent FROM v_customer_stats GROUP BY segment`);
    const total = segs.reduce((s, x) => s + x.n, 0);
    el.querySelector('#segs').innerHTML = [{ segment: '', n: total }, ...Object.keys(SEGMENTS).map((s) => segs.find((x) => x.segment === s) ?? { segment: s, n: 0, spent: 0 })]
      .map((s) => `<button class="seg-card ${state.segment === s.segment ? 'active' : ''}" data-seg="${esc(s.segment)}">
        <span class="seg-name">${s.segment ? segBadge(s.segment) : 'Tous'}</span>
        <strong>${num(s.n)}</strong>${s.segment ? `<span class="muted small">${money(s.spent)}</span>` : '<span class="muted small">clients</span>'}</button>`).join('');

    const where = [], params = [];
    if (state.segment) { where.push('segment = ?'); params.push(state.segment); }
    if (state.q) { where.push('(name LIKE ? OR email LIKE ? OR city LIKE ?)'); params.push(...Array(3).fill(`%${state.q}%`)); }
    const rows = db.all(`SELECT * FROM v_customer_stats ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                         ORDER BY ${SORTS[state.sort]} NULLS LAST LIMIT 200`, params);
    el.querySelector('#tbl').innerHTML = table({
      rows,
      empty: 'Aucun client',
      columns: [
        { label: 'Client', render: (r) => `<button class="link" data-id="${r.id}">${esc(r.name)}</button><div class="muted small">${esc(r.email)}</div>` },
        { label: 'Ville', key: 'city' },
        { label: 'Commandes', align: 'num', render: (r) => num(r.orders) },
        { label: 'Total dépensé', align: 'num', render: (r) => `<strong>${money(r.spent_cents)}</strong>` },
        { label: 'Dernier achat', render: (r) => (r.last_order ? ago(r.last_order) : '—') },
        { label: 'Segment', render: (r) => segBadge(r.segment) },
      ],
    });
  };

  const showCustomer = (id) => {
    const c = db.get('SELECT * FROM v_customer_stats WHERE id = ?', [id]);
    const orders = db.all('SELECT id, created_at, status, total_cents, units FROM v_order_totals WHERE customer_id = ? ORDER BY created_at DESC', [id]);
    // Produits préférés du client
    const fav = db.all(`SELECT p.name, SUM(i.quantity) AS qty FROM order_items i
      JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id
      WHERE o.customer_id = ? AND o.status <> 'cancelled' GROUP BY p.id ORDER BY qty DESC LIMIT 3`, [id]);
    modal({
      title: c.name, wide: true,
      body: `
        <div class="detail-head">
          <div><div class="muted">Contact</div>${esc(c.email)}<br>${esc(c.city ?? '')}</div>
          <div><div class="muted">Client depuis</div>${date(c.created_at)}</div>
          <div><div class="muted">Total dépensé</div><strong>${money(c.spent_cents)}</strong></div>
          <div><div class="muted">Segment</div>${segBadge(c.segment)}</div>
        </div>
        ${fav.length ? `<p class="muted">Produits favoris : ${fav.map((f) => `${esc(f.name)} (×${f.qty})`).join(', ')}</p>` : ''}
        <div class="table-wrap scroll">${table({
          rows: orders, empty: 'Aucune commande',
          columns: [
            { label: 'N°', render: (r) => `#${r.id}` },
            { label: 'Date', render: (r) => date(r.created_at) },
            { label: 'Articles', align: 'num', render: (r) => num(r.units) },
            { label: 'Total', align: 'num', render: (r) => money(r.total_cents) },
            { label: 'Statut', render: (r) => badge(r.status) },
          ],
        })}</div>`,
    });
  };

  el.oninput = (e) => { if (e.target.name in state) { state[e.target.name] = e.target.value; draw(); } };
  el.onclick = async (e) => {
    const seg = e.target.closest('[data-seg]');
    if (seg) { state.segment = seg.dataset.seg; return draw(); }
    const link = e.target.closest('[data-id]');
    if (link) return showCustomer(+link.dataset.id);
    if (e.target.closest('[data-act="new"]') && await customerDialog(ctx)) draw();
  };
  draw();
}
