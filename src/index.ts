import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AppError } from "./errors.js";
import { resolveDatabasePath, ShopDatabase } from "./database.js";

const database = openDatabase();
const server = new McpServer(
  { name: "shop-database", version: "1.0.0" },
  { instructions: "This database is read-only. Inspect the schema before assuming column names or relationships; analytical questions may require joins and aggregations. Use inspect_database first when the schema is uncertain." }
);

server.registerTool("inspect_database", {
  description: "Use before your first query or whenever the schema is uncertain. Returns tables, columns, keys, relationships, and row counts.",
  annotations: { readOnlyHint: true, destructiveHint: false },
  outputSchema: z.object({ tables: z.array(z.record(z.string(), z.unknown())) })
}, async () => toolResult(() => database.inspect()));

const bindValue = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
server.registerTool("query_database", {
  description: "Execute one parameterized read-only SELECT or WITH ... SELECT statement. Use ? placeholders and params for dynamic values. Joins and aggregate queries are supported; schema and data changes are forbidden. Results are paginated: use offset for the next page when hasMore is true. Inspect the schema instead of guessing column names, date formats, price fields, or order status semantics.",
  inputSchema: z.object({ sql: z.string().trim().min(1), params: z.array(bindValue).default([]), limit: z.number().int().min(1).max(200).default(100), offset: z.number().int().min(0).default(0) }),
  annotations: { readOnlyHint: true, destructiveHint: false },
  outputSchema: z.object({ columns: z.array(z.string()), rows: z.array(z.record(z.string(), z.unknown())), rowCount: z.number(), limit: z.number(), offset: z.number(), hasMore: z.boolean() })
}, async ({ sql, params, limit, offset }) => toolResult(() => database.query(sql, params, limit, offset)));

function toolResult<T>(operation: () => T) {
  try { const value = operation(); return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value }; }
  catch (error) {
    const text = error instanceof AppError ? error.publicMessage : "Unexpected internal error.";
    if (!(error instanceof AppError)) console.error("Unexpected database tool error.");
    return { content: [{ type: "text" as const, text }], isError: true };
  }
}
function openDatabase(): ShopDatabase {
  try { return new ShopDatabase(resolveDatabasePath()); }
  catch (error) { console.error(error instanceof AppError ? error.publicMessage : "Database unavailable at startup."); process.exitCode = 1; throw error; }
}
async function shutdown(): Promise<void> { database.close(); await server.close(); }
process.once("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
await server.connect(new StdioServerTransport());
