import { esc, num, date, table } from '../ui.js';

const state = { tab: 'moves', reason: '' };
const REASONS = { initial: 'Inventaire initial', restock: 'Réception', sale: 'Vente', cancel: 'Annulation', adjust: 'Ajustement' };
const ENTITIES = { order: 'Commande', product: 'Produit', customer: 'Client' };
const ACTIONS = { create: 'Création', status: 'Statut', price: 'Prix' };

export default function journal(el, ctx) {
  const { db } = ctx;
  el.innerHTML = `
    <header class="page-head"><div><h1>Journal</h1><p class="sub">Alimenté exclusivement par des triggers SQL — aucune ligne n'est écrite par le code JavaScript</p></div></header>
    <div class="tabs">
      <button class="tab" data-tab="moves">Mouvements de stock <span class="count">${num(db.value('SELECT COUNT(*) FROM stock_movements'))}</span></button>
      <button class="tab" data-tab="audit">Audit <span class="count">${num(db.value('SELECT COUNT(*) FROM audit_log'))}</span></button>
    </div>
    <div class="toolbar" id="filters"></div>
    <div class="card table-wrap" id="tbl"></div>`;

  const draw = () => {
    el.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.tab));
    const filters = el.querySelector('#filters');
    if (state.tab === 'moves') {
      filters.innerHTML = `<select name="reason"><option value="">Tous les types</option>${Object.entries(REASONS)
        .map(([k, l]) => `<option value="${k}" ${k === state.reason ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
      const rows = db.all(`SELECT m.*, p.name, p.sku FROM stock_movements m JOIN products p ON p.id = m.product_id
        ${state.reason ? 'WHERE m.reason = ?' : ''} ORDER BY m.created_at DESC, m.id DESC LIMIT 200`, state.reason ? [state.reason] : []);
      el.querySelector('#tbl').innerHTML = table({
        rows,
        columns: [
          { label: 'Date', render: (r) => date(r.created_at, true) },
          { label: 'Produit', render: (r) => `${esc(r.name)} <span class="muted small">${esc(r.sku)}</span>` },
          { label: 'Type', render: (r) => `<span class="tag">${esc(REASONS[r.reason])}</span>` },
          { label: 'Référence', key: 'ref' },
          { label: 'Quantité', align: 'num', render: (r) => `<span class="${r.delta > 0 ? 'pos' : 'neg'}">${r.delta > 0 ? '+' : ''}${num(r.delta)}</span>` },
        ],
      });
    } else {
      filters.innerHTML = '';
      const rows = db.all('SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 200');
      el.querySelector('#tbl').innerHTML = table({
        rows,
        columns: [
          { label: 'Date', render: (r) => date(r.created_at, true) },
          { label: 'Entité', render: (r) => `<span class="tag">${esc(ENTITIES[r.entity] ?? r.entity)} #${r.entity_id}</span>` },
          { label: 'Action', render: (r) => esc(ACTIONS[r.action] ?? r.action) },
          { label: 'Détails', key: 'details' },
        ],
      });
    }
  };

  el.onclick = (e) => { const t = e.target.closest('[data-tab]'); if (t) { state.tab = t.dataset.tab; draw(); } };
  el.onchange = (e) => { if (e.target.name === 'reason') { state.reason = e.target.value; draw(); } };
  draw();
}
