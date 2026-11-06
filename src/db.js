// D1 access. The schema lives here, not in a migration, because the Git-connected
// build only runs `wrangler deploy`, which never applies migrations. The table is
// created on first use and the statement is a no-op afterwards.
//
// The CHECK limits are a loose backstop; the real limits are in validate.js.

const SCHEMA = `CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  created_at INTEGER NOT NULL
)`;

// An identical message from the same name within this window counts as a double submit.
const DUPLICATE_WINDOW_MS = 60_000;

let schemaReady;

function ensureSchema(db) {
  schemaReady ??= db
    .prepare(SCHEMA)
    .run()
    .catch((err) => {
      schemaReady = undefined;
      throw err;
    });
  return schemaReady;
}

// Returns true if a row was added, false if it was skipped as a double submit.
export async function addMessage(db, { name, message }, now = Date.now()) {
  await ensureSchema(db);
  const result = await db
    .prepare(
      `INSERT INTO messages (name, message, created_at)
       SELECT ?1, ?2, ?3
       WHERE NOT EXISTS (
         SELECT 1 FROM messages WHERE name = ?1 AND message = ?2 AND created_at > ?4
       )`,
    )
    .bind(name, message, now, now - DUPLICATE_WINDOW_MS)
    .run();
  return result.meta.changes > 0;
}

// Newest first. The requested page is clamped to the pages that exist.
export async function listMessages(db, page, pageSize) {
  await ensureSchema(db);
  const { n: total } = await db.prepare('SELECT COUNT(*) AS n FROM messages').first();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);
  const { results } = await db
    .prepare('SELECT id, name, message, created_at FROM messages ORDER BY id DESC LIMIT ?1 OFFSET ?2')
    .bind(pageSize, (current - 1) * pageSize)
    .all();
  return { messages: results, total, pages, page: current };
}
