import { esc, money, num, toast } from '../ui.js';
import { friendlyError } from '../db.js';

export default function newOrder(el, ctx) {
  const { db } = ctx;
  const customers = db.all('SELECT id, name, city FROM customers ORDER BY name');
  const products = db.all(`SELECT p.id, p.name, p.sku, p.price_cents, p.cost_cents, p.stock, c.name AS category
                           FROM products p JOIN categories c ON c.id = p.category_id
                           WHERE p.active = 1 ORDER BY c.name, p.name`);
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = [{ product_id: products.find((p) => p.stock > 0)?.id ?? products[0]?.id, qty: 1 }];

  const productOptions = (sel) => {
    let group = '';
    return products.map((p) => {
      const head = p.category !== group ? `${group ? '</optgroup>' : ''}<optgroup label="${esc(p.category)}">` : '';
      group = p.category;
      return `${head}<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)} — ${money(p.price_cents)} (stock ${p.stock})</option>`;
    }).join('') + '</optgroup>';
  };

  el.innerHTML = `
    <header class="page-head">
      <div><h1>Nouvelle commande</h1><p class="sub">Enregistrée dans une transaction unique : si un trigger refuse une ligne, rien n'est écrit.</p></div>
      <a class="btn ghost" href="#/orders">← Retour</a>
    </header>
    <form class="card order-form" id="form">
      <label>Client
        <select name="customer" required>${customers.map((c) => `<option value="${c.id}">${esc(c.name)}${c.city ? ` — ${esc(c.city)}` : ''}</option>`).join('')}</select>
      </label>
      <div class="lines" id="lines"></div>
      <button type="button" class="btn ghost" data-act="add">+ Ajouter une ligne</button>
      <div class="order-summary" id="summary"></div>
      <label class="check"><input type="checkbox" name="paid"> Marquer immédiatement comme payée</label>
      <div class="form-actions"><button class="btn primary">Créer la commande</button></div>
    </form>`;

  const drawLines = () => {
    el.querySelector('#lines').innerHTML = lines.map((l, i) => {
      const p = byId.get(l.product_id);
      const over = p && l.qty > p.stock;
      return `<div class="line-row" data-i="${i}">
        <select data-field="product_id">${productOptions(l.product_id)}</select>
        <input data-field="qty" type="number" min="1" value="${l.qty}" aria-label="Quantité">
        <span class="num">${p ? money(p.price_cents * l.qty) : '—'}</span>
        <button type="button" class="icon-btn" data-act="remove" aria-label="Supprimer" ${lines.length === 1 ? 'disabled' : ''}>✕</button>
        ${over ? `<p class="warn">Dépasse le stock (${p.stock}). Le trigger <code>trg_movement_guard</code> annulera toute la transaction.</p>` : ''}
      </div>`;
    }).join('');
    drawSummary();
  };

  const drawSummary = () => {
    let total = 0, cost = 0, units = 0;
    for (const l of lines) {
      const p = byId.get(l.product_id);
      if (!p) continue;
      total += p.price_cents * l.qty; cost += p.cost_cents * l.qty; units += l.qty;
    }
    el.querySelector('#summary').innerHTML = `
      <div><span class="muted">Articles</span><strong>${num(units)}</strong></div>
      <div><span class="muted">Marge estimée</span><strong>${money(total - cost)}</strong></div>
      <div><span class="muted">Total TTC</span><strong class="big">${money(total)}</strong></div>`;
  };

  el.oninput = (e) => {
    const row = e.target.closest('.line-row');
    if (!row) return;
    const l = lines[+row.dataset.i];
    if (e.target.dataset.field === 'qty') { l.qty = Math.max(1, parseInt(e.target.value, 10) || 1); drawSummary(); }
    else if (e.target.dataset.field === 'product_id') { l.product_id = +e.target.value; drawLines(); }
  };
  el.querySelector('#lines').addEventListener('change', (e) => { if (e.target.dataset.field === 'qty') drawLines(); });
  el.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'add') { lines.push({ product_id: products[0].id, qty: 1 }); drawLines(); }
    if (act === 'remove') { lines.splice(+e.target.closest('.line-row').dataset.i, 1); drawLines(); }
  };

  el.querySelector('#form').onsubmit = (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    // Fusionne les doublons de produit
    const merged = new Map();
    for (const l of lines) merged.set(l.product_id, (merged.get(l.product_id) ?? 0) + l.qty);
    try {
      const id = db.transaction(() => {
        const orderId = db.run('INSERT INTO orders (customer_id) VALUES (?)', [+form.get('customer')]).lastId;
        for (const [pid, qty] of merged) {
          // Prix et coût figés au moment de la vente
          db.run(`INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents, unit_cost_cents)
                  SELECT ?, id, ?, price_cents, cost_cents FROM products WHERE id = ?`, [orderId, qty, pid]);
        }
        if (form.get('paid')) db.run("UPDATE orders SET status = 'paid', updated_at = datetime('now') WHERE id = ?", [orderId]);
        return orderId;
      });
      ctx.changed();
      toast(`Commande #${id} créée`);
      ctx.navigate('#/orders');
    } catch (err) {
      toast(`Transaction annulée : ${friendlyError(err)}`, 'error');
    }
  };

  drawLines();
}
