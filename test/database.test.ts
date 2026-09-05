import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { resolveDatabasePath, ShopDatabase } from "../src/database.js";
import { AppError } from "../src/errors.js";

function fixture(): { path: string; database: ShopDatabase } {
  const path = join(mkdtempSync(join(tmpdir(), "shop-mcp-")), "fixture.db");
  const db = new Database(path);
  db.exec(`CREATE TABLE customers (id INTEGER PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL, country TEXT, created_at TEXT NOT NULL);
CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price REAL NOT NULL);
CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), order_date TEXT NOT NULL, status TEXT NOT NULL, total_amount REAL NOT NULL);
CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL, unit_price REAL NOT NULL);`);
  db.prepare("INSERT INTO customers VALUES (?, ?, ?, ?, ?, ?)").run(1, "Ada", "Lovelace", "ada@example.test", "Germany", "2025-01-01");
  db.prepare("INSERT INTO customers VALUES (?, ?, ?, ?, ?, ?)").run(2, "Grace", "Hopper", "grace@example.test", "USA", "2025-01-02");
  db.prepare("INSERT INTO products VALUES (?, ?, ?, ?)").run(1, "Widget", "Tools", 10);
  db.prepare("INSERT INTO products VALUES (?, ?, ?, ?)").run(2, "Gadget", "Tools", 20);
  db.prepare("INSERT INTO orders VALUES (?, ?, ?, ?, ?)").run(1, 1, "2025-02-01", "completed", 30);
  db.prepare("INSERT INTO orders VALUES (?, ?, ?, ?, ?)").run(2, 2, "2025-03-01", "cancelled", 20);
  db.prepare("INSERT INTO order_items VALUES (?, ?, ?, ?, ?)").run(1, 1, 1, 1, 10);
  db.prepare("INSERT INTO order_items VALUES (?, ?, ?, ?, ?)").run(2, 1, 2, 1, 20);
  for (let id = 3; id <= 210; id++) db.prepare("INSERT INTO products VALUES (?, ?, ?, ?)").run(id, `Product ${id}`, "Bulk", id);
  db.close(); return { path, database: new ShopDatabase(path) };
}
function message(fn: () => unknown): string { try { fn(); assert.fail("Expected an error"); } catch (error) { assert.ok(error instanceof AppError); return error.publicMessage; } }

test("resolves explicit and module-relative database paths", () => {
  assert.equal(resolveDatabasePath("relative.db", "file:///project/dist/database.js"), join(process.cwd(), "relative.db"));
  assert.equal(resolveDatabasePath(undefined, "file:///project/dist/database.js"), "/project/shop.db");
});
test("inspects schema while excluding SQLite internal tables", () => {
  const { database } = fixture(); const inspection = database.inspect(); database.close();
  assert.deepEqual(inspection.tables.map((table) => table.name), ["customers", "order_items", "orders", "products"]);
  const orders = inspection.tables.find((table) => table.name === "orders")!;
  assert.ok((orders.columns as Array<{ name: string }>).some((column) => column.name === "status"));
  assert.deepEqual(orders.foreignKeys, [{ fromColumn: "customer_id", toTable: "customers", toColumn: "id" }]);
});
test("executes parameterized queries, joins, aggregates, and pagination", () => {
  const { database } = fixture();
  assert.equal(database.query("SELECT first_name FROM customers WHERE country = ?", ["Germany"]).rows[0]!.first_name, "Ada");
  assert.deepEqual(database.query("SELECT c.first_name, SUM(oi.quantity * oi.unit_price) AS revenue FROM customers c JOIN orders o ON o.customer_id = c.id JOIN order_items oi ON oi.order_id = o.id WHERE o.status = ? GROUP BY c.id", ["completed"]).rows, [{ first_name: "Ada", revenue: 30 }]);
  const first = database.query("SELECT id FROM products ORDER BY id", [], 200, 0); const second = database.query("SELECT id FROM products ORDER BY id", [], 200, 200); database.close();
  assert.equal(first.rows.length, 200); assert.equal(first.hasMore, true); assert.equal(second.rows.length, 10); assert.equal(second.hasMore, false); assert.equal(second.rows[0]!.id, 201);
});
test("sanitizes malformed SQL and permits keywords in literals and comments", () => {
  const { database } = fixture(); assert.match(message(() => database.query("SELECT missing_column FROM customers")), /^SQL error: no such column:/);
  assert.deepEqual(database.query("/* DELETE ignored */ SELECT 'UPDATE' AS word").rows, [{ word: "UPDATE" }]); database.close();
});
test("rejects forbidden operations, multiple statements, and leaves the fixture unchanged", () => {
  const { path, database } = fixture(); const before = createHash("sha256").update(readFileSync(path)).digest("hex");
  const forbidden = ["INSERT INTO customers VALUES (3, 'x', 'y', 'z', 'x', 'x')", "UPDATE customers SET first_name = 'x'", "DELETE FROM orders", "REPLACE INTO products VALUES (1, 'x', 'x', 1)", "CREATE TABLE x(id)", "ALTER TABLE customers ADD COLUMN x", "DROP TABLE customers", "TRUNCATE TABLE customers", "VACUUM", "REINDEX", "ANALYZE", "ATTACH DATABASE 'x' AS x", "DETACH DATABASE x", "PRAGMA user_version", "BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT x", "RELEASE x", "SELECT load_extension('x')", "SELECT 1; SELECT 2"];
  for (const sql of forbidden) assert.match(message(() => database.query(sql)), /^Query rejected:/);
  database.close(); assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), before);
});
