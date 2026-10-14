// Utilitaires d'interface : formatage, composants HTML, modale, notifications, graphiques SVG.

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const eurShort = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 });
const nf = new Intl.NumberFormat('fr-FR');

export const money = (cents) => eur.format((cents ?? 0) / 100);
export const moneyShort = (cents) => eurShort.format((cents ?? 0) / 100);
export const num = (n) => nf.format(n ?? 0);
export const pct = (x, digits = 1) => `${(x * 100).toFixed(digits).replace('.', ',')} %`;

const parse = (s) => new Date(String(s).replace(' ', 'T') + 'Z');
export function date(s, withTime = false) {
  if (!s) return '—';
  return parse(s).toLocaleDateString('fr-FR', withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' });
}
export function ago(s) {
  if (!s) return '—';
  const days = Math.floor((Date.now() - parse(s)) / 864e5);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 30) return `il y a ${days} j`;
  if (days < 365) return `il y a ${Math.floor(days / 30)} mois`;
  return `il y a ${Math.floor(days / 365)} an(s)`;
}
export const monthLabel = (ym) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' }).replace('.', '');

export const STATUS = {
  pending: { label: 'En attente', cls: 'st-pending' },
  paid: { label: 'Payée', cls: 'st-paid' },
  shipped: { label: 'Expédiée', cls: 'st-shipped' },
  cancelled: { label: 'Annulée', cls: 'st-cancelled' },
};
export const badge = (status) => `<span class="badge ${STATUS[status]?.cls ?? ''}">${esc(STATUS[status]?.label ?? status)}</span>`;

export const SEGMENTS = { VIP: 'seg-vip', 'Fidèle': 'seg-loyal', Occasionnel: 'seg-casual', Inactif: 'seg-inactive', Prospect: 'seg-prospect' };
export const segBadge = (s) => `<span class="badge ${SEGMENTS[s] ?? ''}">${esc(s)}</span>`;

/** Lien « voir le SQL » qui ouvre la requête dans la console. */
export const sqlLink = (sql) =>
  `<a class="sql-link" href="#/sql?q=${encodeURIComponent(sql.trim())}" title="Ouvrir cette requête dans la console SQL">SQL ↗</a>`;

export function toast(message, kind = 'ok') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  box.append(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3600);
}

/**
 * Modale générique. onSubmit(values, form) : renvoie une chaîne pour afficher une erreur,
 * ou lève une exception ; sinon la modale se ferme et la promesse résout true.
 */
export function modal({ title, body, submitLabel = 'Enregistrer', danger = false, wide = false, onSubmit = null, onOpen = null }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <form class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Fermer">✕</button></header>
        <div class="modal-body">${body}</div>
        <p class="form-error" hidden></p>
        <footer>
          <button type="button" class="btn ghost" data-close>${onSubmit ? 'Annuler' : 'Fermer'}</button>
          ${onSubmit ? `<button class="btn ${danger ? 'danger' : 'primary'}">${esc(submitLabel)}</button>` : ''}
        </footer>
      </form>`;
    const form = wrap.querySelector('form');
    const err = wrap.querySelector('.form-error');
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    const close = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(false); });
    wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(false); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!onSubmit) return close(true);
      try {
        const r = onSubmit(Object.fromEntries(new FormData(form)), form);
        if (typeof r === 'string') { err.textContent = r; err.hidden = false; return; }
        close(true);
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
      }
    });
    document.addEventListener('keydown', onKey);
    document.body.append(wrap);
    onOpen?.(form);
    form.querySelector('.modal-body input, .modal-body select, .modal-body textarea')?.focus();
  });
}

export const confirmDialog = (title, message, label = 'Confirmer', danger = true) =>
  modal({ title, body: `<p>${message}</p>`, submitLabel: label, danger, onSubmit: () => {} });

/** Tableau HTML. columns : [{ key, label, render?, align?, sort? }] */
export function table({ columns, rows, empty = 'Aucun résultat', sort = null, rowAttrs = () => '' }) {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  const head = columns.map((c) => {
    const arrow = sort && sort.key === c.sort ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th class="${c.align ?? ''} ${c.sort ? 'sortable' : ''}" ${c.sort ? `data-sort="${c.sort}"` : ''}>${esc(c.label)}${arrow}</th>`;
  }).join('');
  const body = rows.map((r) => `<tr ${rowAttrs(r)}>${columns.map((c) =>
    `<td class="${c.align ?? ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('');
  return `<table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// ── Graphiques SVG faits main (aucune librairie) ─────────────────────

/** Barres (CA) + courbe (marge). points : [{ label, value, value2, title }] */
export function barChart(points, { height = 240 } = {}) {
  const W = 720, H = height, padL = 56, padB = 28, padT = 12, padR = 8;
  const max = Math.max(1, ...points.map((p) => p.value)) * 1.1;
  const innerW = W - padL - padR, innerH = H - padB - padT;
  const step = innerW / points.length;
  const y = (v) => padT + innerH - (v / max) * innerH;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = max * f;
    return `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
            <text x="${padL - 8}" y="${y(v) + 4}" class="axis" text-anchor="end">${esc(moneyShort(v))}</text>`;
  }).join('');
  const bars = points.map((p, i) => {
    const x = padL + i * step + step * 0.18, w = step * 0.64;
    return `<g><title>${esc(p.title ?? p.label)}</title>
      <rect x="${x}" y="${y(p.value)}" width="${w}" height="${Math.max(0, padT + innerH - y(p.value))}" rx="4" class="bar"/>
      <text x="${x + w / 2}" y="${H - 8}" class="axis" text-anchor="middle">${esc(p.label)}</text></g>`;
  }).join('');
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${padL + i * step + step / 2},${y(p.value2 ?? 0)}`).join(' ');
  const dots = points.map((p, i) => `<circle cx="${padL + i * step + step / 2}" cy="${y(p.value2 ?? 0)}" r="3.5" class="dot"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Chiffre d'affaires mensuel">
    ${grid}${bars}<path d="${line}" class="line"/>${dots}</svg>`;
}

/** Anneau de répartition. segments : [{ label, value, color }] */
export function donut(segments) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const R = 70, C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = segments.map((s) => {
    const len = (s.value / total) * C;
    const arc = `<circle r="${R}" cx="90" cy="90" fill="none" stroke="${esc(s.color)}" stroke-width="26"
      stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}"><title>${esc(s.label)} : ${esc(money(s.value))}</title></circle>`;
    offset += len;
    return arc;
  }).join('');
  const legend = segments.map((s) => `<li><span class="dot-c" style="background:${esc(s.color)}"></span>
      <span class="lg-label">${esc(s.label)}</span><span class="lg-val">${pct(s.value / total, 0)}</span></li>`).join('');
  return `<div class="donut"><svg viewBox="0 0 180 180" role="img" aria-label="Répartition">
      <g transform="rotate(-90 90 90)">${arcs}</g>
      <text x="90" y="86" text-anchor="middle" class="donut-total">${esc(moneyShort(total))}</text>
      <text x="90" y="106" text-anchor="middle" class="axis">depuis l'ouverture</text></svg>
    <ul class="legend">${legend}</ul></div>`;
}

/** Mini-courbe d'évolution. values : nombres */
export function sparkline(values, { width = 520, height = 90 } = {}) {
  if (values.length < 2) return '';
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const x = (i) => (i / (values.length - 1)) * width;
  const y = (v) => height - 4 - ((v - min) / (max - min || 1)) * (height - 8);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${width} ${height}" class="spark" preserveAspectRatio="none">
    <path d="${d} L${width},${height} L0,${height} Z" class="spark-area"/><path d="${d}" class="spark-line"/></svg>`;
}
