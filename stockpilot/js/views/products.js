import { esc, money, num, pct, table, sqlLink } from '../ui.js';
import { productDialog, restockDialog, productHistory } from '../actions.js';

// L'état des filtres survit aux changements de page
const state = { q: '', cat: '', stock: '', sort: 'revenue', dir: 'desc' };

// Liste blanche : jamais d'ORDER BY construit depuis une saisie libre
const SORTS = {
  sku: 'v.sku', name: 'v.name', price: 'v.price_cents', stock: 'v.stock',
  sold: 'v.units_sold', revenue: 'v.revenue_cents', margin: '(v.price_cents - p.cost_cents) * 1.0 / v.price_cents',
};

function buildQuery() {
  const where = [], params = [];
  if (state.q) { where.push('(v.name LIKE ? OR v.sku LIKE ?)'); params.push(`%${state.q}%`, `%${state.q}%`); }
  if (state.cat) { where.push('v.category_id = ?'); params.push(+state.cat); }
  if (state.stock === 'low') where.push('v.active = 1 AND v.stock <= v.reorder_level');
  else if (state.stock === 'out') where.push('v.stock = 0');
  if (state.stock === 'archived') where.push('v.active = 0');
  else where.push('v.active = 1');
  const sql = `SELECT v.*, p.cost_cents, s.name AS supplier
FROM v_product_performance v
JOIN products p ON p.id = v.id
LEFT JOIN suppliers s ON s.id = p.supplier_id
WHERE ${where.join(' AND ')}
ORDER BY ${SORTS[state.sort]} ${state.dir === 'asc' ? 'ASC' : 'DESC'}`;
  return { sql, params };
}

export default function products(el, ctx) {
  const { db } = ctx;
  const cats = db.all('SELECT id, name FROM categories ORDER BY name');

  el.innerHTML = `
    <header class="page-head">
      <div><h1>Produits</h1><p class="sub" id="count"></p></div>
      <button class="btn primary" data-act="new">+ Nouveau produit</button>
    </header>
    <div class="toolbar">
      <input type="search" name="q" placeholder="Rechercher un nom ou un SKU…" value="${esc(state.q)}">
      <select name="cat"><option value="">Toutes les catégories</option>
        ${cats.map((c) => `<option value="${c.id}" ${String(c.id) === state.cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <select name="stock">
        ${[['', 'Tous les stocks'], ['low', 'Sous le seuil'], ['out', 'En rupture'], ['archived', 'Archivés']]
          .map(([v, l]) => `<option value="${v}" ${v === state.stock ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <span id="sql"></span>
    </div>
    <div class="card table-wrap" id="tbl"></div>`;

  const draw = () => {
    const { sql, params } = buildQuery();
    const rows = db.all(sql, params);
    el.querySelector('#count').textContent = `${num(rows.length)} produit(s) · cliquer sur un en-tête pour trier`;
    el.querySelector('#sql').innerHTML = sqlLink(sql.replace(/\?/g, () => {
      const v = params.shift(); return typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`;
    }));
    el.querySelector('#tbl').innerHTML = table({
      rows,
      sort: { key: state.sort, dir: state.dir },
      empty: 'Aucun produit ne correspond aux filtres',
      columns: [
        { label: 'SKU', sort: 'sku', render: (r) => `<code>${esc(r.sku)}</code>` },
        { label: 'Produit', sort: 'name', render: (r) => `<button class="link" data-act="history" data-id="${r.id}">${esc(r.name)}</button>
            <div class="muted small"><span class="dot-c" style="background:${esc(r.color)}"></span>${esc(r.category)} · ${esc(r.supplier ?? '—')}</div>` },
        { label: 'Prix', sort: 'price', align: 'num', render: (r) => money(r.price_cents) },
        { label: 'Marge', sort: 'margin', align: 'num', render: (r) => pct((r.price_cents - r.cost_cents) / (r.price_cents || 1), 0) },
        { label: 'Stock', sort: 'stock', render: (r) => {
          const low = r.stock <= r.reorder_level;
          return `<div class="stock-cell"><div class="stockbar"><span class="${low ? 'low' : ''}" style="width:${Math.min(100, r.stock / (r.reorder_level * 5 || 1) * 100)}%"></span></div>
            <span class="${low ? 'neg' : ''}">${num(r.stock)}</span></div>`;
        } },
        { label: 'Vendus', sort: 'sold', align: 'num', render: (r) => num(r.units_sold) },
        { label: 'CA', sort: 'revenue', align: 'num', render: (r) => money(r.revenue_cents) },
        { label: '', align: 'actions', render: (r) => `
          <button class="btn small" data-act="restock" data-id="${r.id}">Stock</button>
          <button class="btn small ghost" data-act="edit" data-id="${r.id}">Modifier</button>
          <button class="btn small ghost" data-act="toggle" data-id="${r.id}" title="${r.active ? 'Archiver' : 'Réactiver'}">${r.active ? 'Archiver' : 'Réactiver'}</button>` },
      ],
    });
  };

  el.oninput = (e) => {
    if (e.target.name in state) { state[e.target.name] = e.target.value; draw(); }
  };
  el.onclick = async (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const key = th.dataset.sort;
      state.dir = state.sort === key && state.dir === 'desc' ? 'asc' : 'desc';
      state.sort = key;
      return draw();
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = +btn.dataset.id;
    switch (btn.dataset.act) {
      case 'new': if (await productDialog(ctx)) draw(); break;
      case 'edit': if (await productDialog(ctx, id)) draw(); break;
      case 'restock': if (await restockDialog(ctx, id)) draw(); break;
      case 'history': productHistory(ctx, id); break;
      case 'toggle':
        db.run('UPDATE products SET active = 1 - active WHERE id = ?', [id]);
        ctx.changed(); draw(); break;
    }
  };
  draw();
}
