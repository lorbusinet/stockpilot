// Couche d'accès aux données : enveloppe fine autour de sql.js (SQLite compilé en WebAssembly).
const SQLJS_VERSION = '1.10.3';
const CDN = `https://cdnjs.cloudflare.com/ajax/libs/sql.js/${SQLJS_VERSION}/`;

let enginePromise = null;

export function loadEngine() {
  if (!enginePromise) {
    if (typeof window.initSqlJs !== 'function') {
      throw new Error("sql.js n'a pas pu être chargé (connexion au CDN requise).");
    }
    enginePromise = window.initSqlJs({ locateFile: (file) => CDN + file });
  }
  return enginePromise;
}

export class Database {
  constructor(raw) {
    this.raw = raw;
    this.raw.run('PRAGMA foreign_keys = ON');
  }

  static async create(bytes = null) {
    const SQL = await loadEngine();
    return new Database(bytes ? new SQL.Database(bytes) : new SQL.Database());
  }

  /** Toutes les lignes sous forme d'objets. Paramètres positionnels (?). */
  all(sql, params = []) {
    const stmt = this.raw.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(sql, params = []) {
    return this.all(sql, params)[0] ?? null;
  }

  value(sql, params = []) {
    const row = this.get(sql, params);
    return row ? Object.values(row)[0] : null;
  }

  run(sql, params = []) {
    this.raw.run(sql, params);
    return {
      changes: this.raw.getRowsModified(),
      lastId: this.value('SELECT last_insert_rowid()'),
    };
  }

  /** Script multi-instructions brut : renvoie [{ columns, values }]. */
  exec(sql) {
    return this.raw.exec(sql);
  }

  /** Exécute fn dans une transaction ; tout est annulé si une erreur (ou un trigger) échoue. */
  transaction(fn) {
    this.raw.run('BEGIN');
    try {
      const result = fn(this);
      this.raw.run('COMMIT');
      return result;
    } catch (err) {
      this.raw.run('ROLLBACK');
      throw err;
    }
  }

  /** Sérialise la base en octets. sql.js rouvre la connexion : on réactive les clés étrangères. */
  export() {
    const bytes = this.raw.export();
    this.raw.run('PRAGMA foreign_keys = ON');
    return bytes;
  }

  close() {
    this.raw.close();
  }
}

/** Traduit les erreurs SQLite techniques en messages lisibles. */
export function friendlyError(err) {
  const msg = String(err?.message ?? err);
  const unique = msg.match(/UNIQUE constraint failed: (\w+)\.(\w+)/);
  if (unique) return `La valeur du champ « ${unique[2]} » existe déjà.`;
  if (msg.includes('FOREIGN KEY constraint failed')) return 'Référence invalide : un élément lié est introuvable ou encore utilisé.';
  if (msg.includes('CHECK constraint failed')) return `Valeur refusée par une contrainte : ${msg.split(':').pop().trim()}`;
  return msg;
}
