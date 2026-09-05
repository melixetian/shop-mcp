import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppError, safeSqlError } from "./errors.js";
import { validateReadOnlySql } from "./safety.js";

export type BindValue = string | number | boolean | null;

export function resolveDatabasePath(envPath = process.env.SHOP_DB_PATH, moduleUrl = import.meta.url): string {
  if (envPath?.trim()) return normalize(isAbsolute(envPath) ? envPath : resolve(process.cwd(), envPath));
  // Both src/database.ts and dist/database.js sit one directory below project root.
  return normalize(resolve(dirname(fileURLToPath(moduleUrl)), "..", "shop.db"));
}

export type Inspection = { tables: Array<Record<string, unknown>> };
export type QueryResult = { columns: string[]; rows: Record<string, unknown>[]; rowCount: number; limit: number; offset: number; hasMore: boolean };

function purposeFor(name: string, columns: string[]): string {
  const known: Record<string, string> = {
    customers: "customer identity, contact, and country information.",
    products: "product catalog, categories, and pricing information.",
    orders: "customer orders, including date and status information.",
    order_items: "order line items connecting orders and products, including quantities and any line-level pricing."
  };
  return known[name] ?? `Table ${name} with columns: ${columns.join(", ") || "none"}.`;
}

function jsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

export class ShopDatabase {
  private readonly db: Database.Database;
  readonly path: string;
  constructor(path = resolveDatabasePath()) {
    this.path = path;
    if (!existsSync(path) || !statSync(path).isFile()) throw new AppError("Database unavailable: configured path is not an existing regular file.");
    try {
      this.db = new Database(path, { readonly: true, fileMustExist: true });
      this.db.defaultSafeIntegers(true);
      this.db.pragma("query_only = ON");
    } catch (error) { throw new AppError("Database unavailable: could not open the configured database.", error); }
  }
  close(): void { this.db.close(); }
  inspect(): Inspection {
    try {
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
      return { tables: tables.map(({ name }) => {
        const columns = this.db.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all() as Array<{ name: string; type: string; notnull: number | bigint; dflt_value: unknown; pk: number | bigint }>;
        const foreignKeys = this.db.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(name)})`).all() as Array<{ from: string; table: string; to: string }>;
        const count = this.db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`).get() as { count: number | bigint };
        return { name, purpose: purposeFor(name, columns.map((column) => column.name)), rowCount: jsonValue(count.count), columns: columns.map((column) => ({ name: column.name, type: column.type, nullable: Number(column.notnull) === 0 && Number(column.pk) === 0, defaultValue: jsonValue(column.dflt_value), primaryKeyPosition: Number(column.pk) })), foreignKeys: foreignKeys.map((foreignKey) => ({ fromColumn: foreignKey.from, toTable: foreignKey.table, toColumn: foreignKey.to })) };
      }) };
    } catch (error) { throw safeSqlError(error); }
  }
  query(sql: string, params: BindValue[] = [], limit = 100, offset = 0): QueryResult {
    const validated = validateReadOnlySql(sql);
    const sqliteParams = params.map((value) => typeof value === "boolean" ? Number(value) : value);
    try {
      const statement = this.db.prepare(`SELECT * FROM (${validated}) AS _shop_query LIMIT ? OFFSET ?`);
      const result = statement.all(...sqliteParams, limit + 1, offset) as Array<Record<string, unknown>>;
      const hasMore = result.length > limit;
      const rows = result.slice(0, limit).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, jsonValue(value)])));
      return { columns: statement.columns().map((column) => column.name), rows, rowCount: rows.length, limit, offset, hasMore };
    } catch (error) { throw safeSqlError(error); }
  }
}

function quoteIdentifier(name: string): string { return `"${name.replaceAll('"', '""')}"`; }
