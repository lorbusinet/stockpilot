// Actions métier partagées entre les vues (dialogues + écritures transactionnelles).
import { friendlyError } from './db.js';
import { modal, confirmDialog, toast, esc, money, num, date, badge, table, sparkline, STATUS } from './ui.js';

const euros = (v) => Math.round(parseFloat(String(v).replace(',', '.')) * 100);

export async function restockDialog(ctx, productId) {
  const p = ctx.db.get('SELECT id, name, sku, stock, reorder_level FROM products WHERE id = ?', [productId]);
  const ok = await modal({
    title: `Mouvement de stock — ${p.name}`,
    submitLabel: 'Enregistrer le mouvement',
    body: `
      <p class="muted">Stock actuel : <strong>${num(p.stock)}</strong> · seuil d'alerte : ${num(p.reorder_level)}</p>
      <div class="grid2">
        <label>Type<select name="reason">
          <option value="restock">Réception fournisseur (+)</option>
          <option value="adjust">Ajustement d'inventaire (±)</option>
        </select></label>
        <label>Quantité<input name="qty" type="number" required value="${p.reorder_level * 4}" step="1"></label>
      </div>
      <label>Référence<input name="ref" placeholder="BL-12345" maxlength="40"></label>
      <p class="hint">Un trigger SQL refuse tout mouvement qui rendrait le stock négatif.</p>`,
    onSubmit: ({ reason, qty, ref }) => {
      const delta = parseInt(qty, 10);
      if (!delta) return 'La quantité doit être non nulle.';
      if (reason === 'restock' && delta < 0) return 'Une réception doit être positive.';
      try {
        ctx.db.run('INSERT INTO stock_movements (product_id, delta, reason, ref) VALUES (?, ?, ?, ?)',
          [p.id, delta, reason, ref || null]);
      } catch (e) { return friendlyError(e); }
    },
  });
  if (ok) { ctx.changed(); toast(`Stock de « ${p.name} » mis à jour`); }
  return ok;
}

export async function productDialog(ctx, productId = null) {
  const { db } = ctx;
  const p = productId ? db.get('SELECT * FROM products WHERE id = ?', [productId]) : null;
  const cats = db.all('SELECT id, name FROM categories ORDER BY name');
  const sups = db.all('SELECT id, name FROM suppliers ORDER BY name');
  const opt = (list, sel) => list.map((x) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const ok = await modal({
    title: p ? `Modifier « ${p.name} »` : 'Nouveau produit',
    submitLabel: p ? 'Enregistrer' : 'Créer le produit',
    body: `
      <div class="grid2">
        <label>SKU<input name="sku" required maxlength="20" value="${esc(p?.sku)}" placeholder="INF-0200"></label>
        <label>Nom<input name="name" required maxlength="80" value="${esc(p?.name)}"></label>
        <label>Catégorie<select name="category_id" required>${opt(cats, p?.category_id)}</select></label>
        <label>Fournisseur<select name="supplier_id"><option value="">—</option>${opt(sups, p?.supplier_id)}</select></label>
        <label>Prix de vente (€)<input name="price" required inputmode="decimal" pattern="\\d+([.,]\\d{1,2})?" value="${p ? (p.price_cents / 100).toFixed(2) : ''}"></label>
        <label>Coût d'achat (€)<input name="cost" required inputmode="decimal" pattern="\\d+([.,]\\d{1,2})?" value="${p ? (p.cost_cents / 100).toFixed(2) : ''}"></label>
        <label>Seuil d'alerte<input name="reorder" type="number" min="0" required value="${p?.reorder_level ?? 10}"></label>
        ${p ? '' : '<label>Stock initial<input name="initial" type="number" min="0" value="0"></label>'}
      </div>
      ${p ? '<p class="hint">Les changements de prix sont tracés automatiquement dans le journal (trigger d\'audit).</p>' : ''}`,
    onSubmit: (v) => {
      const price = euros(v.price), cost = euros(v.cost);
      if (cost > price) return 'Le coût d\'achat dépasse le prix de vente.';
      const params = [v.sku.trim().toUpperCase(), v.name.trim(), +v.category_id, v.supplier_id ? +v.supplier_id : null, price, cost, +v.reorder];
      try {
        db.transaction(() => {
          if (p) {
            db.run(`UPDATE products SET sku=?, name=?, category_id=?, supplier_id=?, price_cents=?, cost_cents=?, reorder_level=? WHERE id=?`,
              [...params, p.id]);
          } else {
            const id = db.run(`INSERT INTO products (sku, name, category_id, supplier_id, price_cents, cost_cents, reorder_level)
                               VALUES (?, ?, ?, ?, ?, ?, ?)`, params).lastId;
            if (+v.initial > 0) db.run(`INSERT INTO stock_movements (product_id, delta, reason, ref) VALUES (?, ?, 'initial', 'CRÉATION')`, [id, +v.initial]);
          }
        });
      } catch (e) { return friendlyError(e); }
    },
  });
  if (ok) { ctx.changed(); toast(p ? 'Produit mis à jour' : 'Produit créé'); }
  return ok;
}

export function productHistory(ctx, productId) {
  const { db } = ctx;
  const p = db.get('SELECT name, sku, stock FROM products WHERE id = ?', [productId]);
  // Fonction de fenêtre : solde cumulé après chaque mouvement
  const moves = db.all(`
    SELECT created_at, delta, reason, ref,
           SUM(delta) OVER (ORDER BY created_at, id) AS balance
    FROM stock_movements WHERE product_id = ? ORDER BY created_at, id`, [productId]);
  const REASONS = { initial: 'Inventaire initial', restock: 'Réception', sale: 'Vente', cancel: 'Annulation', adjust: 'Ajustement' };
  const last = moves.slice(-40).reverse();
  return modal({
    title: `Historique — ${p.name}`,
    wide: true,
    body: `
      <p class="muted">${esc(p.sku)} · stock actuel <strong>${num(p.stock)}</strong> · ${num(moves.length)} mouvements</p>
      <div class="spark-wrap">${sparkline(moves.map((m) => m.balance))}</div>
      <div class="table-wrap scroll">${table({
        rows: last,
        columns: [
          { label: 'Date', render: (r) => date(r.created_at, true) },
          { label: 'Type', render: (r) => esc(REASONS[r.reason] ?? r.reason) },
          { label: 'Réf.', key: 'ref' },
          { label: 'Mouvement', align: 'num', render: (r) => `<span class="${r.delta > 0 ? 'pos' : 'neg'}">${r.delta > 0 ? '+' : ''}${num(r.delta)}</span>` },
          { label: 'Solde', align: 'num', render: (r) => num(r.balance) },
        ],
      })}</div>`,
  });
}

export const NEXT = {
  pending: [['paid', 'Encaisser'], ['cancelled', 'Annuler']],
  paid: [['shipped', 'Expédier'], ['cancelled', 'Annuler']],
};

export async function changeStatus(ctx, orderId, status) {
  if (status === 'cancelled') {
    const ok = await confirmDialog(`Annuler la commande #${orderId} ?`,
      'Les articles seront automatiquement remis en stock par un trigger SQL.', 'Annuler la commande');
    if (!ok) return false;
  }
  try {
    ctx.db.run("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?", [status, orderId]);
  } catch (e) {
    toast(friendlyError(e), 'error');
    return false;
  }
  ctx.changed();
  toast(`Commande #${orderId} : ${STATUS[status].label.toLowerCase()}`);
  return true;
}

export function orderDetail(ctx, orderId) {
  const { db } = ctx;
  const o = db.get('SELECT * FROM v_order_totals WHERE id = ?', [orderId]);
  const items = db.all(`
    SELECT p.name, p.sku, i.quantity, i.unit_price_cents, i.quantity * i.unit_price_cents AS line_cents
    FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = ?`, [orderId]);
  const history = db.all(`SELECT details, created_at FROM audit_log WHERE entity = 'order' AND entity_id = ? ORDER BY id`, [orderId]);
  return modal({
    title: `Commande #${o.id}`,
    wide: true,
    body: `
      <div class="detail-head">
        <div><div class="muted">Client</div><strong>${esc(o.customer)}</strong></div>
        <div><div class="muted">Date</div>${date(o.created_at, true)}</div>
        <div><div class="muted">Statut</div>${badge(o.status)}</div>
        <div><div class="muted">Marge</div>${money(o.margin_cents)} (${o.total_cents ? Math.round(o.margin_cents / o.total_cents * 100) : 0} %)</div>
      </div>
      <div class="table-wrap">${table({
        rows: items,
        columns: [
          { label: 'Produit', render: (r) => `${esc(r.name)} <span class="muted">${esc(r.sku)}</span>` },
          { label: 'Qté', align: 'num', render: (r) => num(r.quantity) },
          { label: 'Prix unitaire', align: 'num', render: (r) => money(r.unit_price_cents) },
          { label: 'Total', align: 'num', render: (r) => money(r.line_cents) },
        ],
      })}</div>
      <p class="total-line">Total : <strong>${money(o.total_cents)}</strong></p>
      <h3>Historique</h3>
      <ul class="timeline">
        <li><span>Création</span><span class="muted">${date(o.created_at, true)}</span></li>
        ${history.map((h) => `<li><span>${esc(h.details)}</span><span class="muted">${date(h.created_at, true)}</span></li>`).join('')}
      </ul>`,
  });
}

export async function customerDialog(ctx) {
  const ok = await modal({
    title: 'Nouveau client',
    submitLabel: 'Créer le client',
    body: `
      <label>Nom complet<input name="name" required maxlength="80"></label>
      <div class="grid2">
        <label>E-mail<input name="email" type="email" required maxlength="120"></label>
        <label>Ville<input name="city" maxlength="60"></label>
      </div>`,
    onSubmit: ({ name, email, city }) => {
      try {
        ctx.db.run('INSERT INTO customers (name, email, city) VALUES (?, ?, ?)', [name.trim(), email.trim().toLowerCase(), city.trim() || null]);
      } catch (e) { return friendlyError(e); }
    },
  });
  if (ok) { ctx.changed(); toast('Client créé'); }
  return ok;
}
