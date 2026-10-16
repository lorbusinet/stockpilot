// Génération de données de démonstration réalistes et reproductibles (PRNG à graine fixe).
// Toutes les écritures passent par le schéma : ce sont les triggers qui tiennent le stock à jour.

export function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES = [
  ['Informatique', '#6366f1', [
    ['Portable Zen 14"', 89900, 64000], ['Écran 27" QHD', 32900, 21500], ['Clavier mécanique', 11900, 6200],
    ['Souris ergonomique', 5900, 2400], ['Station d\'accueil USB-C', 14900, 8800], ['SSD externe 1 To', 10900, 6900],
  ]],
  ['Audio', '#ec4899', [
    ['Casque à réduction de bruit', 27900, 16500], ['Écouteurs sans fil', 12900, 6800], ['Enceinte Bluetooth', 7900, 4100],
    ['Barre de son', 34900, 22000], ['Micro USB studio', 9900, 5200],
  ]],
  ['Maison', '#14b8a6', [
    ['Lampe connectée', 4900, 2100], ['Aspirateur robot', 29900, 19000], ['Purificateur d\'air', 18900, 11200],
    ['Machine à café', 24900, 15800], ['Bouilloire réglable', 6900, 3300], ['Thermostat intelligent', 15900, 9300],
  ]],
  ['Sport', '#f59e0b', [
    ['Montre GPS', 22900, 13800], ['Tapis de yoga', 3900, 1400], ['Haltères réglables', 17900, 10900],
    ['Gourde isotherme', 2900, 900], ['Bracelet d\'activité', 7900, 3900],
  ]],
  ['Bureau', '#22c55e', [
    ['Chaise ergonomique', 39900, 24500], ['Bureau assis-debout', 49900, 31000], ['Lampe de bureau LED', 5900, 2600],
    ['Carnet premium', 1900, 600], ['Organiseur de câbles', 1500, 500],
  ]],
  ['Jeux', '#ef4444', [
    ['Console portable', 34900, 26500], ['Manette sans fil', 6900, 3800], ['Casque gaming', 9900, 5100],
    ['Jeu de société stratégie', 4500, 2200], ['Puzzle 1000 pièces', 2500, 1000],
  ]],
];

const SUPPLIERS = [
  ['TechDistri', 'contact@techdistri.example', 'France'],
  ['NordAudio', 'sales@nordaudio.example', 'Danemark'],
  ['CasaPro', 'pro@casapro.example', 'Italie'],
  ['ActivGear', 'orders@activgear.example', 'Allemagne'],
  ['OfficeLine', 'b2b@officeline.example', 'Belgique'],
  ['PlayHub', 'trade@playhub.example', 'Japon'],
];

const FIRST = ['Camille', 'Léa', 'Hugo', 'Lucas', 'Chloé', 'Manon', 'Nathan', 'Inès', 'Louis', 'Jade', 'Gabriel', 'Emma',
  'Arthur', 'Sarah', 'Jules', 'Zoé', 'Adam', 'Lina', 'Raphaël', 'Alice', 'Yanis', 'Nora', 'Théo', 'Mila'];
const LAST = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau',
  'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard'];
const CITIES = ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Nantes', 'Bordeaux', 'Lille', 'Rennes', 'Strasbourg',
  'Montpellier', 'Nice', 'Grenoble', 'Dijon', 'Angers', 'Brest'];

const DAY = 864e5;
const HOUR = 36e5;
const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function seed(db, { seed = 42, days = 365, customers = 90 } = {}) {
  const rnd = mulberry32(seed);
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const now = Date.now();

  db.transaction(() => {
    // Référentiels
    SUPPLIERS.forEach(([name, email, country]) =>
      db.run('INSERT INTO suppliers (name, email, country) VALUES (?, ?, ?)', [name, email, country]));

    const products = [];
    CATEGORIES.forEach(([catName, color, items], ci) => {
      const catId = db.run('INSERT INTO categories (name, color) VALUES (?, ?)', [catName, color]).lastId;
      items.forEach(([name, price, cost], pi) => {
        const sku = `${strip(catName).slice(0, 3).toUpperCase()}-${String(100 + pi * 7 + ci).padStart(4, '0')}`;
        const reorder = price > 20000 ? int(4, 8) : int(10, 20);
        const createdAt = fmt(now - (days + 20) * DAY);
        const id = db.run(
          `INSERT INTO products (sku, name, category_id, supplier_id, price_cents, cost_cents, reorder_level, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [sku, name, catId, ci + 1, price, cost, reorder, createdAt]).lastId;
        const initial = reorder * int(4, 7);
        db.run(`INSERT INTO stock_movements (product_id, delta, reason, ref, created_at) VALUES (?, ?, 'initial', 'INVENTAIRE', ?)`,
          [id, initial, createdAt]);
        // Popularité : distribution très inégale (quelques best-sellers)
        products.push({ id, price, cost, reorder, stock: initial, weight: 0.15 + rnd() ** 2 * (price < 15000 ? 3 : 1.2) });
      });
    });
    const totalWeight = products.reduce((s, p) => s + p.weight, 0);
    const pickProduct = () => {
      let r = rnd() * totalWeight;
      for (const p of products) if ((r -= p.weight) <= 0) return p;
      return products[products.length - 1];
    };

    // Clients (triés par ancienneté : les plus anciens sont les plus fidèles)
    const custs = [];
    const usedEmails = new Set();
    for (let i = 0; i < customers; i++) {
      const first = pick(FIRST), last = pick(LAST);
      let email = `${strip(first)}.${strip(last)}@exemple.fr`;
      for (let n = 2; usedEmails.has(email); n++) email = `${strip(first)}.${strip(last)}${n}@exemple.fr`;
      usedEmails.add(email);
      custs.push({ name: `${first} ${last}`, email, city: pick(CITIES), created: now - int(5, days + 30) * DAY - int(0, 23) * HOUR });
    }
    custs.sort((a, b) => a.created - b.created);
    for (const c of custs) {
      c.id = db.run('INSERT INTO customers (name, email, city, created_at) VALUES (?, ?, ?, ?)',
        [c.name, c.email, c.city, fmt(c.created)]).lastId;
    }

    const restock = (ts) => {
      for (const p of products) {
        if (p.stock <= p.reorder * 1.5) {
          const qty = p.reorder * int(3, 5);
          db.run(`INSERT INTO stock_movements (product_id, delta, reason, ref, created_at) VALUES (?, ?, 'restock', ?, ?)`,
            [p.id, qty, `BL-${int(10000, 99999)}`, fmt(ts)]);
          p.stock += qty;
        }
      }
    };

    const SEASON = [0.8, 0.85, 0.95, 1, 1, 0.95, 0.85, 0.8, 1, 1.1, 1.35, 1.8]; // jan → déc
    const setStatus = (id, status, ts) =>
      db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', [status, fmt(Math.min(ts, now)), id]);

    // Simulation jour par jour
    for (let ago = days; ago >= 0; ago--) {
      const dayStart = now - ago * DAY;
      if (ago % 7 === 0 && ago > 0) restock(dayStart - 20 * HOUR);

      const d = new Date(dayStart);
      const trend = 1.1 + ((days - ago) / days) * 1.7;
      const weekend = d.getDay() === 0 || d.getDay() === 6 ? 0.75 : 1;
      const count = Math.floor(trend * SEASON[d.getMonth()] * weekend + rnd() * 2);

      for (let k = 0; k < count; k++) {
        const ts = dayStart - Math.floor(rnd() * 20 * HOUR);
        const eligible = custs.filter((c) => c.created < ts);
        if (!eligible.length) continue;
        const customer = eligible[Math.floor(rnd() ** 1.7 * eligible.length)];

        // Composition du panier, plafonnée par le stock disponible
        const basket = new Map();
        const nLines = 1 + Math.floor(rnd() ** 2 * 4);
        for (let l = 0; l < nLines; l++) {
          const p = pickProduct();
          const want = 1 + Math.floor(rnd() ** 3 * (p.price < 5000 ? 4 : 2));
          const qty = Math.min(want, p.stock - (basket.get(p) ?? 0));
          if (qty > 0) basket.set(p, (basket.get(p) ?? 0) + qty);
        }
        if (!basket.size) continue;

        const orderId = db.run('INSERT INTO orders (customer_id, created_at, updated_at) VALUES (?, ?, ?)',
          [customer.id, fmt(ts), fmt(ts)]).lastId;
        for (const [p, qty] of basket) {
          db.run(`INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents, unit_cost_cents)
                  VALUES (?, ?, ?, ?, ?)`, [orderId, p.id, qty, p.price, p.cost]);
          p.stock -= qty;
        }

        // Cycle de vie de la commande selon son âge
        const r = rnd();
        if (r < 0.06) {
          setStatus(orderId, 'cancelled', ts + int(1, 30) * HOUR);
          for (const [p, qty] of basket) p.stock += qty;
        } else if (ago > 6) {
          setStatus(orderId, 'paid', ts + int(1, 6) * HOUR);
          setStatus(orderId, 'shipped', ts + int(20, 80) * HOUR);
        } else if (ago > 1) {
          setStatus(orderId, 'paid', ts + int(1, 6) * HOUR);
          if (r < 0.55) setStatus(orderId, 'shipped', ts + int(20, 40) * HOUR);
        } else if (r < 0.5) {
          setStatus(orderId, 'paid', ts + HOUR);
        }
      }
    }

    // Quelques évolutions de prix pour alimenter le journal d'audit
    for (let i = 0; i < 4; i++) {
      const p = pick(products);
      p.price = Math.round(p.price * (1 + (rnd() * 0.16 - 0.06)) / 100) * 100;
      db.run('UPDATE products SET price_cents = ? WHERE id = ?', [p.price, p.id]);
    }
  });
}
