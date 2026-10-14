import { esc, num } from '../ui.js';

const EXAMPLES = [
  ['CA mensuel (vue + CTE récursive)', 'SELECT month, revenue_cents / 100.0 AS ca_eur, margin_cents / 100.0 AS marge_eur, orders\nFROM v_monthly_revenue;'],
  ['Classement clients (fonctions de fenêtre)', `SELECT name, segment,
       spent_cents / 100.0                         AS depense_eur,
       RANK()  OVER (ORDER BY spent_cents DESC)    AS rang,
       NTILE(4) OVER (ORDER BY spent_cents DESC)   AS quartile,
       ROUND(100.0 * SUM(spent_cents) OVER (ORDER BY spent_cents DESC)
             / SUM(spent_cents) OVER (), 1)        AS pct_cumule
FROM v_customer_stats
ORDER BY rang
LIMIT 25;`],
  ['Produits achetés ensemble', `SELECT a.name AS produit_a, b.name AS produit_b, COUNT(*) AS commandes_communes
FROM order_items x
JOIN order_items y ON y.order_id = x.order_id AND y.product_id > x.product_id
JOIN products a ON a.id = x.product_id
JOIN products b ON b.id = y.product_id
GROUP BY x.product_id, y.product_id
ORDER BY commandes_communes DESC
LIMIT 15;`],
  ['Vérifier la cohérence du stock', `-- Le stock doit toujours égaler la somme des mouvements
WITH recalc AS (
  SELECT product_id, SUM(delta) AS total FROM stock_movements GROUP BY product_id
)
SELECT p.sku, p.name, p.stock, r.total AS stock_recalcule,
       CASE WHEN p.stock = r.total THEN '✓' ELSE '✗' END AS coherent
FROM products p JOIN recalc r ON r.product_id = p.id
ORDER BY coherent, p.sku;`],
  ['Ventes par jour de semaine', `SELECT CASE strftime('%w', created_at)
         WHEN '0' THEN 'dimanche' WHEN '1' THEN 'lundi' WHEN '2' THEN 'mardi'
         WHEN '3' THEN 'mercredi' WHEN '4' THEN 'jeudi' WHEN '5' THEN 'vendredi'
         ELSE 'samedi' END AS jour,
       COUNT(*) AS commandes,
       ROUND(AVG(total_cents) / 100.0, 2) AS panier_moyen_eur
FROM v_order_totals WHERE status <> 'cancelled'
GROUP BY strftime('%w', created_at)
ORDER BY strftime('%w', created_at);`],
  ['Tester un trigger (doit échouer)', `-- Tente de sortir 100 000 unités : le trigger trg_movement_guard l'interdit
INSERT INTO stock_movements (product_id, delta, reason, ref)
VALUES (1, -100000, 'adjust', 'TEST');`],
  ['Plan d\'exécution (index)', `EXPLAIN QUERY PLAN
SELECT * FROM orders WHERE customer_id = 12 ORDER BY created_at;`],
  ['Schéma complet', `SELECT type, name, tbl_name FROM sqlite_master
WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name;`],
];

const state = { sql: EXAMPLES[1][1] };

export default function sqlConsole(el, ctx, params) {
  const { db } = ctx;
  if (params.get('q')) state.sql = params.get('q');

  const schema = db.all(`SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','view','trigger')
                         ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 ELSE 2 END, name`);
  const group = (t) => schema.filter((s) => s.type === t);

  el.innerHTML = `
    <header class="page-head">
      <div><h1>Console SQL</h1><p class="sub">SQLite ${esc(db.value('SELECT sqlite_version()'))} exécuté dans le navigateur · Ctrl+Entrée pour lancer</p></div>
      <select id="examples"><option value="">Exemples de requêtes…</option>${EXAMPLES.map(([l], i) => `<option value="${i}">${esc(l)}</option>`).join('')}</select>
    </header>
    <div class="console">
      <aside class="card schema">
        ${['table', 'view', 'trigger'].map((t) => `
          <h3>${{ table: 'Tables', view: 'Vues', trigger: 'Triggers' }[t]} <span class="count">${group(t).length}</span></h3>
          <ul>${group(t).map((s) => `<li><button class="link" data-obj="${esc(s.name)}" data-type="${t}">${esc(s.name)}</button><div class="cols" hidden></div></li>`).join('')}</ul>`).join('')}
      </aside>
      <div class="console-main">
        <div class="card editor">
          <textarea id="sql" spellcheck="false" aria-label="Requête SQL">${esc(state.sql)}</textarea>
          <div class="editor-bar"><span class="muted small" id="meta"></span><button class="btn primary" id="run">▶ Exécuter</button></div>
        </div>
        <div id="results"></div>
      </div>
    </div>`;

  const ta = el.querySelector('#sql');
  const out = el.querySelector('#results');
  const meta = el.querySelector('#meta');

  const run = () => {
    state.sql = ta.value;
    const before = db.value('SELECT total_changes()');
    const t0 = performance.now();
    let sets;
    try {
      sets = db.exec(state.sql);
    } catch (e) {
      meta.textContent = '';
      out.innerHTML = `<div class="card error-box"><strong>Erreur SQLite</strong><pre>${esc(e.message)}</pre></div>`;
      return;
    }
    const ms = performance.now() - t0;
    const changes = db.value('SELECT total_changes()') - before;
    if (changes > 0) ctx.changed();
    meta.textContent = `${sets.length} jeu(x) de résultats · ${ms.toFixed(1)} ms${changes ? ` · ${num(changes)} ligne(s) modifiée(s)` : ''}`;
    out.innerHTML = sets.length ? sets.map(({ columns, values }) => `
      <div class="card table-wrap scroll result">
        <div class="muted small result-meta">${num(values.length)} ligne(s)${values.length > 500 ? ' — 500 premières affichées' : ''}</div>
        <table class="data mono"><thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${values.slice(0, 500).map((row) => `<tr>${row.map((v) => v === null
          ? '<td class="null">NULL</td>'
          : `<td class="${typeof v === 'number' ? 'num' : ''}">${esc(v instanceof Uint8Array ? `[BLOB ${v.length} o]` : v)}</td>`).join('')}</tr>`).join('')}</tbody></table>
      </div>`).join('') : `<div class="card empty">Requête exécutée${changes ? ` — ${num(changes)} ligne(s) modifiée(s)` : ', aucun résultat à afficher'}.</div>`;
  };

  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
    if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); }
  });
  el.querySelector('#run').onclick = run;
  el.querySelector('#examples').onchange = (e) => {
    if (e.target.value === '') return;
    ta.value = EXAMPLES[+e.target.value][1];
    e.target.value = '';
    run();
  };
  el.onclick = (e) => {
    const b = e.target.closest('[data-obj]');
    if (!b) return;
    const { obj, type } = b.dataset;
    if (type === 'trigger') {
      ta.value = db.value('SELECT sql FROM sqlite_master WHERE name = ?', [obj]) + ';';
      out.innerHTML = '<div class="card empty">Définition du trigger chargée dans l\'éditeur (lecture seule : ne pas exécuter).</div>';
      return;
    }
    const cols = b.nextElementSibling;
    if (cols.hidden) {
      cols.innerHTML = db.all(`SELECT name, type, pk, "notnull" FROM pragma_table_info(?)`, [obj])
        .map((c) => `<div><span>${esc(c.name)}</span><span class="muted">${esc(c.type || '—')}${c.pk ? ' 🔑' : ''}</span></div>`).join('');
    }
    cols.hidden = !cols.hidden;
    ta.value = `SELECT * FROM ${obj} LIMIT 50;`;
    run();
  };
  run();
}
