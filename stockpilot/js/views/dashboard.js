import { money, moneyShort, num, pct, esc, barChart, donut, monthLabel, sqlLink, ago } from '../ui.js';
import { restockDialog } from '../actions.js';

const Q = {
  kpis: `SELECT
  (SELECT SUM(revenue_cents) FROM v_monthly_revenue) AS revenue,
  (SELECT SUM(margin_cents)  FROM v_monthly_revenue) AS margin,
  (SELECT SUM(orders)        FROM v_monthly_revenue) AS orders,
  (SELECT COUNT(*) FROM v_customer_stats WHERE segment NOT IN ('Prospect', 'Inactif')) AS active_customers,
  (SELECT SUM(stock * cost_cents) FROM products WHERE active = 1) AS stock_value,
  (SELECT COUNT(*) FROM orders WHERE status IN ('pending', 'paid')) AS to_process`,
  monthly: `SELECT month, revenue_cents, margin_cents, orders FROM v_monthly_revenue`,
  categories: `SELECT category AS label, color, SUM(revenue_cents) AS value
FROM v_product_performance GROUP BY category_id ORDER BY value DESC`,
  top: `SELECT id, name, category, color, units_sold, revenue_cents, margin_cents
FROM v_product_performance ORDER BY revenue_cents DESC LIMIT 6`,
  champions: `-- Fonction de fenêtre : meilleur produit de chaque catégorie
SELECT category, color, name, revenue_cents FROM (
  SELECT category, color, name, revenue_cents,
         ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY revenue_cents DESC) AS rang
  FROM v_product_performance
) WHERE rang = 1 ORDER BY revenue_cents DESC`,
  low: `SELECT id, name, sku, stock, reorder_level, daily_sales,
       CASE WHEN daily_sales > 0 THEN CAST(stock / daily_sales AS INTEGER) END AS days_left
FROM v_low_stock ORDER BY stock * 1.0 / MAX(daily_sales, 0.01) LIMIT 7`,
  activity: `SELECT entity, entity_id, action, details, created_at FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 8`,
};

const ACTIVITY = { order: 'Commande', product: 'Produit', customer: 'Client' };

export default function dashboard(el, ctx) {
  const { db } = ctx;
  const k = db.get(Q.kpis);
  const months = db.all(Q.monthly);
  const cats = db.all(Q.categories);
  const top = db.all(Q.top);
  const champs = db.all(Q.champions);
  const low = db.all(Q.low);
  const activity = db.all(Q.activity);

  const [prev, last] = months.slice(-3, -1); // deux derniers mois complets
  const trend = prev?.revenue_cents ? (last.revenue_cents - prev.revenue_cents) / prev.revenue_cents : 0;
  const maxTop = Math.max(1, ...top.map((t) => t.revenue_cents));

  el.innerHTML = `
    <header class="page-head">
      <div><h1>Tableau de bord</h1><p class="sub">12 derniers mois · calculé en direct par SQLite à chaque affichage</p></div>
      <a class="btn primary" href="#/orders/new">+ Nouvelle commande</a>
    </header>

    <section class="kpis">
      <div class="kpi"><span class="kpi-label">Chiffre d'affaires</span><span class="kpi-val">${moneyShort(k.revenue)}</span>
        <span class="kpi-sub ${trend >= 0 ? 'pos' : 'neg'}">${trend >= 0 ? '▲' : '▼'} ${pct(Math.abs(trend))} le mois dernier</span></div>
      <div class="kpi"><span class="kpi-label">Marge brute</span><span class="kpi-val">${moneyShort(k.margin)}</span>
        <span class="kpi-sub">${pct(k.margin / (k.revenue || 1))} du CA</span></div>
      <div class="kpi"><span class="kpi-label">Commandes</span><span class="kpi-val">${num(k.orders)}</span>
        <span class="kpi-sub">panier moyen ${money(k.revenue / (k.orders || 1))}</span></div>
      <div class="kpi"><span class="kpi-label">Clients actifs</span><span class="kpi-val">${num(k.active_customers)}</span>
        <span class="kpi-sub"><a href="#/customers">voir la segmentation</a></span></div>
      <div class="kpi"><span class="kpi-label">Valeur du stock</span><span class="kpi-val">${moneyShort(k.stock_value)}</span>
        <span class="kpi-sub">au coût d'achat</span></div>
      <div class="kpi"><span class="kpi-label">À traiter</span><span class="kpi-val">${num(k.to_process)}</span>
        <span class="kpi-sub"><a href="#/orders">commandes ouvertes</a></span></div>
    </section>

    <section class="grid-main">
      <div class="card span2">
        <div class="card-head"><h2>Chiffre d'affaires mensuel</h2>
          <div class="chart-legend"><span class="lg bar"></span>CA <span class="lg line"></span>Marge</div>${sqlLink(Q.monthly)}</div>
        ${barChart(months.map((m) => ({
          label: monthLabel(m.month), value: m.revenue_cents, value2: m.margin_cents,
          title: `${m.month} : ${money(m.revenue_cents)} · marge ${money(m.margin_cents)} · ${m.orders} commandes`,
        })))}
      </div>
      <div class="card">
        <div class="card-head"><h2>Ventes par catégorie</h2>${sqlLink(Q.categories)}</div>
        ${donut(cats)}
      </div>
    </section>

    <section class="grid-main">
      <div class="card">
        <div class="card-head"><h2>Meilleures ventes</h2>${sqlLink(Q.top)}</div>
        <ol class="ranking">${top.map((t) => `
          <li><div class="rk-top"><span>${esc(t.name)}</span><strong>${money(t.revenue_cents)}</strong></div>
            <div class="rk-bar"><span style="width:${(t.revenue_cents / maxTop) * 100}%;background:${esc(t.color)}"></span></div>
            <div class="muted small">${num(t.units_sold)} vendus · marge ${pct(t.margin_cents / (t.revenue_cents || 1), 0)}</div></li>`).join('')}
        </ol>
      </div>
      <div class="card">
        <div class="card-head"><h2>Champion par catégorie</h2>${sqlLink(Q.champions)}</div>
        <ul class="plain">${champs.map((c) => `
          <li><span class="dot-c" style="background:${esc(c.color)}"></span><span class="grow"><span class="muted small">${esc(c.category)}</span><br>${esc(c.name)}</span>
          <strong>${moneyShort(c.revenue_cents)}</strong></li>`).join('')}</ul>
      </div>
      <div class="card">
        <div class="card-head"><h2>Alertes de stock</h2>${sqlLink(Q.low)}</div>
        ${low.length ? `<ul class="plain">${low.map((p) => `
          <li><span class="grow">${esc(p.name)}<br><span class="muted small">${num(p.stock)} en stock · seuil ${num(p.reorder_level)}
            ${p.days_left !== null ? ` · ≈ ${num(p.days_left)} j restants` : ''}</span></span>
            <button class="btn small" data-restock="${p.id}">Réassort</button></li>`).join('')}</ul>`
          : '<div class="empty">Aucun produit sous le seuil 🎉</div>'}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Activité récente</h2>${sqlLink(Q.activity)}<a href="#/journal" class="small">Journal complet →</a></div>
      <ul class="plain activity">${activity.map((a) => `
        <li><span class="tag">${esc(ACTIVITY[a.entity] ?? a.entity)}${a.entity === 'order' ? ` #${a.entity_id}` : ''}</span>
          <span class="grow">${esc(a.action === 'create' ? `Création : ${a.details}` : a.details)}</span>
          <span class="muted small">${ago(a.created_at)}</span></li>`).join('')}</ul>
    </section>`;

  el.onclick = async (e) => {
    const btn = e.target.closest('[data-restock]');
    if (btn && await restockDialog(ctx, +btn.dataset.restock)) ctx.refresh();
  };
}
