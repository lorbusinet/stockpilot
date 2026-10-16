// Point d'entrée : démarrage du moteur, migrations, routage, persistance.
import { Database, friendlyError } from './db.js';
import { migrate } from './schema.js';
import { seed } from './seed.js';
import * as store from './store.js';
import { toast, confirmDialog, esc, num } from './ui.js';
import dashboard from './views/dashboard.js';
import products from './views/products.js';
import orders from './views/orders.js';
import newOrder from './views/newOrder.js';
import customers from './views/customers.js';
import sqlConsole from './views/sqlConsole.js';
import journal from './views/journal.js';

const ROUTES = {
  dashboard, products, orders, 'orders/new': newOrder, customers, sql: sqlConsole, journal,
};

const view = document.getElementById('view');
const statusEl = document.getElementById('db-status');
let db = null;
let saveTimer = null;

const ctx = {
  get db() { return db; },
  changed() {
    setStatus('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 300);
  },
  navigate(hash) { location.hash = hash; },
  refresh() { render(); },
};

function setStatus(kind) {
  const label = { saving: 'Enregistrement…', saved: 'Enregistré localement', error: 'Échec de sauvegarde' }[kind];
  statusEl.className = `db-status ${kind}`;
  statusEl.textContent = label;
  updateStats();
}

function updateStats() {
  if (!db) return;
  const s = db.get(`SELECT (SELECT COUNT(*) FROM orders) AS o, (SELECT COUNT(*) FROM products) AS p,
                           (SELECT COUNT(*) FROM customers) AS c, (SELECT COUNT(*) FROM stock_movements) AS m,
                           (SELECT page_count * page_size FROM pragma_page_count, pragma_page_size) AS bytes`);
  document.getElementById('db-stats').textContent =
    `${num(s.o)} commandes · ${num(s.p)} produits · ${num(s.c)} clients · ${num(s.m)} mouvements · ${(s.bytes / 1024).toFixed(0)} Ko`;
}

async function persist() {
  try {
    await store.save(db.export());
    setStatus('saved');
  } catch (e) {
    console.error(e);
    setStatus('error');
  }
}

async function freshDatabase() {
  const fresh = await Database.create();
  migrate(fresh);
  const t0 = performance.now();
  seed(fresh);
  console.info(`Données de démo générées en ${(performance.now() - t0).toFixed(0)} ms`);
  return fresh;
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [path, qs] = raw.split('?');
  return { path, params: new URLSearchParams(qs ?? '') };
}

function render() {
  const { path, params } = parseHash();
  const route = ROUTES[path] ? path : 'dashboard';
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === route.split('/')[0]));
  view.onclick = view.oninput = view.onchange = null;
  view.innerHTML = '';
  try {
    ROUTES[route](view, ctx, params);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card error-box"><strong>Erreur d'affichage</strong><pre>${esc(friendlyError(e))}</pre></div>`;
  }
  view.scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

function wireSidebar() {
  document.getElementById('btn-export').onclick = () => {
    const blob = new Blob([db.export()], { type: 'application/vnd.sqlite3' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `stockpilot-${new Date().toISOString().slice(0, 10)}.sqlite`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Base exportée (ouvrable avec DB Browser for SQLite, DBeaver…)');
  };

  const file = document.getElementById('import-file');
  document.getElementById('btn-import').onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    try {
      const candidate = await Database.create(new Uint8Array(await f.arrayBuffer()));
      candidate.value('SELECT COUNT(*) FROM sqlite_master'); // vérifie que c'est bien une base SQLite
      migrate(candidate);
      candidate.value('SELECT COUNT(*) FROM v_order_totals'); // vérifie que le schéma est compatible
      db.close();
      db = candidate;
      await persist();
      render();
      toast(`Base « ${f.name} » importée`);
    } catch (e) {
      toast(`Import impossible : ${friendlyError(e)}`, 'error');
    }
  };

  document.getElementById('btn-reset').onclick = async () => {
    const ok = await confirmDialog('Réinitialiser les données ?',
      'Toutes vos modifications seront remplacées par un nouveau jeu de données de démonstration (12 mois d\'activité).', 'Réinitialiser');
    if (!ok) return;
    db.close();
    db = await freshDatabase();
    await persist();
    render();
    toast('Données de démonstration régénérées');
  };
}

async function boot() {
  try {
    const bytes = await store.load();
    if (bytes) {
      db = await Database.create(bytes);
      if (migrate(db)) await persist();
    } else {
      view.querySelector('.loading-msg').textContent = 'Génération de 12 mois de données de démonstration…';
      await new Promise((r) => setTimeout(r, 30)); // laisse le message s'afficher
      db = await freshDatabase();
      await persist();
    }
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card error-box"><strong>Impossible de démarrer</strong><pre>${esc(e.message)}</pre>
      <p>sql.js est chargé depuis cdnjs.cloudflare.com : une connexion Internet est nécessaire au premier lancement.</p></div>`;
    return;
  }
  setStatus('saved');
  wireSidebar();
  window.addEventListener('hashchange', render);
  render();
}

boot();
