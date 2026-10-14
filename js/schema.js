// Schéma versionné : chaque migration est appliquée une seule fois (suivi via PRAGMA user_version).
// Règle métier centrale : le stock n'est JAMAIS modifié directement, uniquement via stock_movements.

export const MIGRATIONS = [
  // ── v1 : tables et index ─────────────────────────────────────────────
  `
  CREATE TABLE categories (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#6366f1'
  );

  CREATE TABLE suppliers (
    id      INTEGER PRIMARY KEY,
    name    TEXT NOT NULL UNIQUE,
    email   TEXT,
    country TEXT
  );

  CREATE TABLE products (
    id            INTEGER PRIMARY KEY,
    sku           TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    category_id   INTEGER NOT NULL REFERENCES categories(id),
    supplier_id   INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
    cost_cents    INTEGER NOT NULL CHECK (cost_cents >= 0),
    stock         INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    reorder_level INTEGER NOT NULL DEFAULT 10 CHECK (reorder_level >= 0),
    active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE customers (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL UNIQUE,
    city       TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE orders (
    id          INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE order_items (
    id               INTEGER PRIMARY KEY,
    order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id       INTEGER NOT NULL REFERENCES products(id),
    quantity         INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    unit_cost_cents  INTEGER NOT NULL CHECK (unit_cost_cents >= 0)
  );

  CREATE TABLE stock_movements (
    id         INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    delta      INTEGER NOT NULL CHECK (delta <> 0),
    reason     TEXT NOT NULL CHECK (reason IN ('initial', 'restock', 'sale', 'cancel', 'adjust')),
    ref        TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE audit_log (
    id         INTEGER PRIMARY KEY,
    entity     TEXT NOT NULL,
    entity_id  INTEGER NOT NULL,
    action     TEXT NOT NULL,
    details    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX idx_products_category ON products(category_id);
  CREATE INDEX idx_orders_customer   ON orders(customer_id);
  CREATE INDEX idx_orders_created    ON orders(created_at);
  CREATE INDEX idx_orders_status     ON orders(status);
  CREATE INDEX idx_items_order       ON order_items(order_id);
  CREATE INDEX idx_items_product     ON order_items(product_id);
  CREATE INDEX idx_moves_product     ON stock_movements(product_id, created_at);
  CREATE INDEX idx_audit_entity      ON audit_log(entity, entity_id);
  `,

  // ── v2 : triggers (règles métier dans la base) ──────────────────────
  `
  -- Un mouvement ne peut pas rendre le stock négatif
  CREATE TRIGGER trg_movement_guard BEFORE INSERT ON stock_movements
  WHEN (SELECT stock FROM products WHERE id = NEW.product_id) + NEW.delta < 0
  BEGIN
    SELECT RAISE(ABORT, 'Stock insuffisant pour cette opération');
  END;

  -- Chaque mouvement met à jour le stock du produit
  CREATE TRIGGER trg_movement_apply AFTER INSERT ON stock_movements
  BEGIN
    UPDATE products SET stock = stock + NEW.delta WHERE id = NEW.product_id;
  END;

  -- On ne modifie que les commandes en attente
  CREATE TRIGGER trg_item_guard BEFORE INSERT ON order_items
  WHEN (SELECT status FROM orders WHERE id = NEW.order_id) <> 'pending'
  BEGIN
    SELECT RAISE(ABORT, 'Seule une commande en attente peut recevoir des lignes');
  END;

  -- Une ligne de commande génère une sortie de stock datée comme la commande
  CREATE TRIGGER trg_item_sale AFTER INSERT ON order_items
  BEGIN
    INSERT INTO stock_movements (product_id, delta, reason, ref, created_at)
    VALUES (NEW.product_id, -NEW.quantity, 'sale', 'CMD-' || NEW.order_id,
            (SELECT created_at FROM orders WHERE id = NEW.order_id));
  END;

  -- Machine à états : pending → paid → shipped, annulation possible avant expédition
  CREATE TRIGGER trg_order_status_guard BEFORE UPDATE OF status ON orders
  WHEN NOT (
       OLD.status = NEW.status
    OR (OLD.status = 'pending' AND NEW.status IN ('paid', 'cancelled'))
    OR (OLD.status = 'paid'    AND NEW.status IN ('shipped', 'cancelled'))
  )
  BEGIN
    SELECT RAISE(ABORT, 'Transition de statut interdite');
  END;

  -- Annuler une commande remet les articles en stock
  CREATE TRIGGER trg_order_cancel AFTER UPDATE OF status ON orders
  WHEN NEW.status = 'cancelled' AND OLD.status <> 'cancelled'
  BEGIN
    INSERT INTO stock_movements (product_id, delta, reason, ref, created_at)
    SELECT product_id, quantity, 'cancel', 'CMD-' || NEW.id, NEW.updated_at
    FROM order_items WHERE order_id = NEW.id;
  END;

  -- Journal d'audit automatique
  CREATE TRIGGER trg_audit_order_status AFTER UPDATE OF status ON orders
  WHEN OLD.status <> NEW.status
  BEGIN
    INSERT INTO audit_log (entity, entity_id, action, details, created_at)
    VALUES ('order', NEW.id, 'status', OLD.status || ' → ' || NEW.status, NEW.updated_at);
  END;

  CREATE TRIGGER trg_audit_price AFTER UPDATE OF price_cents ON products
  WHEN OLD.price_cents <> NEW.price_cents
  BEGIN
    INSERT INTO audit_log (entity, entity_id, action, details)
    VALUES ('product', NEW.id, 'price',
            printf('%s : %.2f € → %.2f €', NEW.name, OLD.price_cents / 100.0, NEW.price_cents / 100.0));
  END;

  CREATE TRIGGER trg_audit_product_create AFTER INSERT ON products
  BEGIN
    INSERT INTO audit_log (entity, entity_id, action, details, created_at)
    VALUES ('product', NEW.id, 'create', NEW.name, NEW.created_at);
  END;

  CREATE TRIGGER trg_audit_customer_create AFTER INSERT ON customers
  BEGIN
    INSERT INTO audit_log (entity, entity_id, action, details, created_at)
    VALUES ('customer', NEW.id, 'create', NEW.name, NEW.created_at);
  END;
  `,

  // ── v3 : vues analytiques ───────────────────────────────────────────
  `
  CREATE VIEW v_order_totals AS
  SELECT o.id, o.customer_id, c.name AS customer, o.status, o.created_at, o.updated_at,
         COUNT(i.id)                                                     AS lines,
         COALESCE(SUM(i.quantity), 0)                                    AS units,
         COALESCE(SUM(i.quantity * i.unit_price_cents), 0)               AS total_cents,
         COALESCE(SUM(i.quantity * (i.unit_price_cents - i.unit_cost_cents)), 0) AS margin_cents
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN order_items i ON i.order_id = o.id
  GROUP BY o.id;

  -- CTE récursive : génère les 12 derniers mois, même ceux sans vente
  CREATE VIEW v_monthly_revenue AS
  WITH RECURSIVE months(m, n) AS (
    SELECT date('now', 'start of month', '-11 months'), 0
    UNION ALL
    SELECT date(m, '+1 month'), n + 1 FROM months WHERE n < 11
  )
  SELECT strftime('%Y-%m', m)               AS month,
         COALESCE(SUM(t.total_cents), 0)    AS revenue_cents,
         COALESCE(SUM(t.margin_cents), 0)   AS margin_cents,
         COUNT(t.id)                        AS orders
  FROM months
  LEFT JOIN v_order_totals t
         ON strftime('%Y-%m', t.created_at) = strftime('%Y-%m', m)
        AND t.status <> 'cancelled'
  GROUP BY m
  ORDER BY m;

  CREATE VIEW v_product_performance AS
  SELECT p.id, p.sku, p.name, p.category_id, cat.name AS category, cat.color,
         p.stock, p.reorder_level, p.price_cents, p.active,
         COALESCE(SUM(CASE WHEN o.status <> 'cancelled' THEN i.quantity END), 0) AS units_sold,
         COALESCE(SUM(CASE WHEN o.status <> 'cancelled' THEN i.quantity * i.unit_price_cents END), 0) AS revenue_cents,
         COALESCE(SUM(CASE WHEN o.status <> 'cancelled'
                           THEN i.quantity * (i.unit_price_cents - i.unit_cost_cents) END), 0) AS margin_cents
  FROM products p
  JOIN categories cat ON cat.id = p.category_id
  LEFT JOIN order_items i ON i.product_id = p.id
  LEFT JOIN orders o ON o.id = i.order_id
  GROUP BY p.id;

  -- Segmentation RFM simplifiée
  CREATE VIEW v_customer_stats AS
  SELECT c.id, c.name, c.email, c.city, c.created_at,
         COUNT(t.id)                     AS orders,
         COALESCE(SUM(t.total_cents), 0) AS spent_cents,
         MAX(t.created_at)               AS last_order,
         CASE
           WHEN COUNT(t.id) = 0 THEN 'Prospect'
           WHEN julianday('now') - julianday(MAX(t.created_at)) > 120 THEN 'Inactif'
           WHEN SUM(t.total_cents) >= 500000 THEN 'VIP'
           WHEN COUNT(t.id) >= 6 THEN 'Fidèle'
           ELSE 'Occasionnel'
         END AS segment
  FROM customers c
  LEFT JOIN v_order_totals t ON t.customer_id = c.id AND t.status <> 'cancelled'
  GROUP BY c.id;

  -- Alertes de réapprovisionnement avec vitesse de vente sur 90 jours
  CREATE VIEW v_low_stock AS
  SELECT p.id, p.sku, p.name, p.stock, p.reorder_level,
         ROUND(COALESCE((SELECT -SUM(m.delta) FROM stock_movements m
                         WHERE m.product_id = p.id AND m.reason IN ('sale', 'cancel')
                           AND m.created_at >= datetime('now', '-90 days')), 0) / 90.0, 2) AS daily_sales
  FROM products p
  WHERE p.active = 1 AND p.stock <= p.reorder_level;
  `,
];

/** Applique les migrations manquantes. Renvoie le nombre de migrations appliquées. */
export function migrate(db) {
  const current = db.value('PRAGMA user_version');
  let applied = 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
    applied++;
  }
  return applied;
}
