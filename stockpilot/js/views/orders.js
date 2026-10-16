import { esc, money, num, date, badge, table, STATUS } from '../ui.js';
import { orderDetail, changeStatus, NEXT } from '../actions.js';

const PAGE = 25;
const state = { status: '', q: '', page: 1 };

export default function orders(el, ctx) {
  const { db } = ctx;

  el.innerHTML = `
    <header class="page-head">
      <div><h1>Commandes</h1><p class="sub">Les transitions de statut sont contrôlées par une machine à états en SQL</p></div>
      <a class="btn primary" href="#/orders/new">+ Nouvelle commande</a>
    </header>
    <div class="tabs" id="tabs"></div>
    <div class="toolbar"><input type="search" name="q" placeholder="Client ou n° de commande…" value="${esc(state.q)}"></div>
    <div class="card table-wrap" id="tbl"></div>
    <div class="pager" id="pager"></div>`;

  const draw = () => {
    const counts = Object.fromEntries(db.all('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').map((r) => [r.status, r.n]));
    const all = Object.values(counts).reduce((a, b) => a + b, 0);
    el.querySelector('#tabs').innerHTML = [['', 'Toutes', all], ...Object.entries(STATUS).map(([k, s]) => [k, s.label, counts[k] ?? 0])]
      .map(([k, l, n]) => `<button class="tab ${state.status === k ? 'active' : ''}" data-status="${k}">${l} <span class="count">${num(n)}</span></button>`).join('');

    const where = [], params = [];
    if (state.status) { where.push('status = ?'); params.push(state.status); }
    if (state.q) {
      const id = parseInt(state.q.replace(/\D/g, ''), 10);
      where.push('(customer LIKE ? OR id = ?)'); params.push(`%${state.q}%`, Number.isNaN(id) ? -1 : id);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.value(`SELECT COUNT(*) FROM v_order_totals ${w}`, params);
    const pages = Math.max(1, Math.ceil(total / PAGE));
    state.page = Math.min(state.page, pages);
    const rows = db.all(`SELECT * FROM v_order_totals ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, PAGE, (state.page - 1) * PAGE]);

    el.querySelector('#tbl').innerHTML = table({
      rows,
      empty: 'Aucune commande',
      columns: [
        { label: 'N°', render: (r) => `<button class="link" data-detail="${r.id}">#${r.id}</button>` },
        { label: 'Date', render: (r) => date(r.created_at, true) },
        { label: 'Client', key: 'customer' },
        { label: 'Articles', align: 'num', render: (r) => `${num(r.units)} <span class="muted small">(${r.lines} l.)</span>` },
        { label: 'Total', align: 'num', render: (r) => `<strong>${money(r.total_cents)}</strong>` },
        { label: 'Statut', render: (r) => badge(r.status) },
        { label: '', align: 'actions', render: (r) => (NEXT[r.status] ?? [])
          .map(([s, l]) => `<button class="btn small ${s === 'cancelled' ? 'ghost' : ''}" data-id="${r.id}" data-to="${s}">${l}</button>`).join('') },
      ],
    });
    el.querySelector('#pager').innerHTML = pages > 1 ? `
      <button class="btn small ghost" data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>← Préc.</button>
      <span>Page ${state.page} / ${pages} · ${num(total)} commandes</span>
      <button class="btn small ghost" data-page="${state.page + 1}" ${state.page >= pages ? 'disabled' : ''}>Suiv. →</button>` : '';
  };

  el.oninput = (e) => { if (e.target.name === 'q') { state.q = e.target.value.trim(); state.page = 1; draw(); } };
  el.onclick = async (e) => {
    const t = e.target.closest('[data-status],[data-page],[data-detail],[data-to]');
    if (!t) return;
    if (t.dataset.status !== undefined) { state.status = t.dataset.status; state.page = 1; draw(); }
    else if (t.dataset.page) { state.page = +t.dataset.page; draw(); }
    else if (t.dataset.detail) orderDetail(ctx, +t.dataset.detail);
    else if (await changeStatus(ctx, +t.dataset.id, t.dataset.to)) draw();
  };
  draw();
}
