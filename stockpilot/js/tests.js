// Mini-framework de test + suite couvrant schéma, triggers, vues et persistance.
import { Database } from './db.js';
import { migrate, MIGRATIONS } from './schema.js';
import { seed } from './seed.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (cond, msg = 'assertion échouée') => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg = '') => assert(a === b, `${msg} attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`);
const throws = (fn, re) => {
  try { fn(); } catch (e) {
    if (re && !re.test(e.message)) throw new Error(`erreur inattendue : ${e.message}`);
    return;
  }
  throw new Error('aucune erreur levée');
};

async function fresh() {
  const db = await Database.create();
  migrate(db);
  return db;
}

/** Jeu minimal : 1 catégorie, 1 produit avec 10 en stock, 1 client. */
function fixture(db) {
  db.run("INSERT INTO categories (name) VALUES ('Test')");
  db.run("INSERT INTO products (sku, name, category_id, price_cents, cost_cents) VALUES ('T-1', 'Widget', 1, 1000, 400)");
  db.run("INSERT INTO stock_movements (product_id, delta, reason) VALUES (1, 10, 'initial')");
  db.run("INSERT INTO customers (name, email) VALUES ('Ada', 'ada@test.fr')");
}
const order = (db, qty) => db.transaction(() => {
  const id = db.run('INSERT INTO orders (customer_id) VALUES (1)').lastId;
  db.run('INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents, unit_cost_cents) VALUES (?, 1, ?, 1000, 400)', [id, qty]);
  return id;
});
const stock = (db) => db.value('SELECT stock FROM products WHERE id = 1');

// ── Schéma ──────────────────────────────────────────────────────────
test('les migrations sont appliquées et idempotentes', async () => {
  const db = await fresh();
  eq(db.value('PRAGMA user_version'), MIGRATIONS.length, 'version');
  eq(migrate(db), 0, 'seconde migration');
});

test('les clés étrangères sont appliquées', async () => {
  const db = await fresh();
  throws(() => db.run("INSERT INTO products (sku, name, category_id, price_cents, cost_cents) VALUES ('X', 'X', 999, 1, 1)"), /FOREIGN KEY/);
});

test('contraintes CHECK : prix négatif refusé', async () => {
  const db = await fresh();
  db.run("INSERT INTO categories (name) VALUES ('C')");
  throws(() => db.run("INSERT INTO products (sku, name, category_id, price_cents, cost_cents) VALUES ('X', 'X', 1, -5, 1)"), /CHECK/);
});

// ── Triggers ────────────────────────────────────────────────────────
test('une vente décrémente le stock et crée un mouvement', async () => {
  const db = await fresh(); fixture(db);
  const id = order(db, 3);
  eq(stock(db), 7, 'stock');
  eq(db.value("SELECT delta FROM stock_movements WHERE reason = 'sale' AND ref = ?", [`CMD-${id}`]), -3, 'mouvement');
});

test('stock insuffisant : toute la transaction est annulée', async () => {
  const db = await fresh(); fixture(db);
  throws(() => order(db, 11), /Stock insuffisant/);
  eq(stock(db), 10, 'stock inchangé');
  eq(db.value('SELECT COUNT(*) FROM orders'), 0, 'aucune commande orpheline');
});

test("l'annulation remet les articles en stock", async () => {
  const db = await fresh(); fixture(db);
  const id = order(db, 4);
  db.run("UPDATE orders SET status = 'cancelled' WHERE id = ?", [id]);
  eq(stock(db), 10);
  eq(db.value("SELECT COUNT(*) FROM stock_movements WHERE reason = 'cancel'"), 1);
});

test('machine à états : transitions interdites refusées', async () => {
  const db = await fresh(); fixture(db);
  const id = order(db, 1);
  throws(() => db.run("UPDATE orders SET status = 'shipped' WHERE id = ?", [id]), /Transition/);
  db.run("UPDATE orders SET status = 'paid' WHERE id = ?", [id]);
  db.run("UPDATE orders SET status = 'shipped' WHERE id = ?", [id]);
  throws(() => db.run("UPDATE orders SET status = 'cancelled' WHERE id = ?", [id]), /Transition/);
});

test('impossible d\'ajouter une ligne à une commande payée', async () => {
  const db = await fresh(); fixture(db);
  const id = order(db, 1);
  db.run("UPDATE orders SET status = 'paid' WHERE id = ?", [id]);
  throws(() => db.run('INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents, unit_cost_cents) VALUES (?, 1, 1, 1, 1)', [id]), /en attente/);
});

test('suppression en cascade des lignes de commande', async () => {
  const db = await fresh(); fixture(db);
  const id = order(db, 2);
  db.run('DELETE FROM orders WHERE id = ?', [id]);
  eq(db.value('SELECT COUNT(*) FROM order_items'), 0);
});

test('audit : changement de prix et de statut journalisés', async () => {
  const db = await fresh(); fixture(db);
  db.run('UPDATE products SET price_cents = 1200 WHERE id = 1');
  assert(db.value("SELECT details FROM audit_log WHERE action = 'price'").includes('12.00'), 'prix audité');
  const id = order(db, 1);
  db.run("UPDATE orders SET status = 'paid' WHERE id = ?", [id]);
  eq(db.value("SELECT details FROM audit_log WHERE action = 'status'"), 'pending → paid');
});

// ── Données de démo & vues ──────────────────────────────────────────
let seeded;
const seededDb = async () => {
  if (!seeded) { seeded = await fresh(); seed(seeded, { seed: 7, days: 365 }); }
  return seeded;
};

test('seed : volume réaliste généré', async () => {
  const db = await seededDb();
  const n = db.value('SELECT COUNT(*) FROM orders');
  assert(n > 300, `seulement ${n} commandes`);
});

test('seed : stock toujours égal à la somme des mouvements', async () => {
  const db = await seededDb();
  const bad = db.value(`SELECT COUNT(*) FROM products p
    WHERE p.stock <> (SELECT COALESCE(SUM(delta), 0) FROM stock_movements WHERE product_id = p.id)`);
  eq(bad, 0, 'produits incohérents');
});

test('seed : aucune incohérence de statut (expédiée sans paiement)', async () => {
  const db = await seededDb();
  const bad = db.value(`SELECT COUNT(*) FROM orders o WHERE status = 'shipped'
    AND NOT EXISTS (SELECT 1 FROM audit_log WHERE entity = 'order' AND entity_id = o.id AND details = 'pending → paid')`);
  eq(bad, 0);
});

test('seed : déterministe pour une même graine', async () => {
  const a = await fresh(); seed(a, { seed: 99, days: 60 });
  const b = await fresh(); seed(b, { seed: 99, days: 60 });
  const sig = (db) => db.value("SELECT COUNT(*) || ':' || SUM(total_cents) FROM v_order_totals");
  eq(sig(a), sig(b));
});

test('v_monthly_revenue : 12 mois, total cohérent avec les commandes', async () => {
  const db = await seededDb();
  eq(db.value('SELECT COUNT(*) FROM v_monthly_revenue'), 12, 'mois');
  const fromView = db.value('SELECT SUM(revenue_cents) FROM v_monthly_revenue');
  const direct = db.value(`SELECT SUM(i.quantity * i.unit_price_cents) FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.status <> 'cancelled' AND o.created_at >= date('now', 'start of month', '-11 months')`);
  eq(fromView, direct, 'CA');
});

test('v_customer_stats : chaque client a un segment', async () => {
  const db = await seededDb();
  eq(db.value('SELECT COUNT(*) FROM v_customer_stats WHERE segment IS NULL'), 0);
  eq(db.value('SELECT COUNT(*) FROM v_customer_stats'), db.value('SELECT COUNT(*) FROM customers'));
});

test('les requêtes utilisent les index', async () => {
  const db = await seededDb();
  const plan = db.all('EXPLAIN QUERY PLAN SELECT * FROM orders WHERE customer_id = 3').map((r) => r.detail).join(' ');
  assert(/idx_orders_customer/.test(plan), plan);
});

// ── Persistance ─────────────────────────────────────────────────────
test('export / réimport : données conservées, clés étrangères actives', async () => {
  const db = await fresh(); fixture(db); order(db, 2);
  const bytes = db.export();
  eq(db.value('PRAGMA foreign_keys'), 1, 'FK après export');
  const copy = await Database.create(bytes);
  eq(copy.value('SELECT stock FROM products WHERE id = 1'), 8);
  eq(copy.value('PRAGMA user_version'), MIGRATIONS.length);
});

// ── Exécution ───────────────────────────────────────────────────────
(async () => {
  const out = document.getElementById('results');
  let passed = 0;
  const t0 = performance.now();
  for (const t of tests) {
    const start = performance.now();
    let error = null;
    try { await t.fn(); passed++; } catch (e) { error = e; console.error(t.name, e); }
    out.insertAdjacentHTML('beforeend', `<div class="test">
      <span class="${error ? 'ko-mark' : 'ok-mark'}">${error ? '✗' : '✓'}</span>
      <div class="grow">${t.name} <span class="muted small">${(performance.now() - start).toFixed(0)} ms</span>
      ${error ? `<div class="err">${String(error.message).replace(/</g, '&lt;')}</div>` : ''}</div></div>`);
  }
  const summary = document.getElementById('summary');
  summary.textContent = `${passed} / ${tests.length} tests réussis en ${(performance.now() - t0).toFixed(0)} ms`;
  summary.className = passed === tests.length ? 'pos' : 'neg';
  window.__testResult = { passed, total: tests.length };
})();
