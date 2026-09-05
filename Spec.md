# Shop Database MCP Server — Implementation Specification

## 1. Goal

Build a local MCP server that lets an AI agent inspect and analyze the provided SQLite database of an online shop. The server must use the MCP TypeScript SDK, communicate over stdio, and expose read-only database access suitable for both simple lookups and multi-table analytical queries.

The repository already contains `shop.db` in its root. The implementation must not modify that file.

## 2. Scope

### In scope

- TypeScript MCP server running on Node.js.
- MCP stdio transport; no HTTP server and no separately managed process.
- SQLite schema introspection.
- Arbitrary parameterized read-only SQL queries initiated by an AI agent.
- Pagination and a strict response row limit.
- Layered protection against database writes.
- Clear, sanitized error responses.
- Automated tests that can be run by the user.
- Setup and Codex connection documentation.

### Out of scope

- Any database mutation.
- A tool dedicated to each assignment question.
- Authentication, remote hosting, UI, REST API, or web server.
- Conversation memory or an LLM inside the MCP server.
- Docker support unless it can be added without complicating the core solution.

## 3. Required technology

- Node.js 20 or newer.
- TypeScript in strict mode.
- ESM modules.
- Current stable `@modelcontextprotocol/sdk` package.
- `better-sqlite3` for SQLite access.
- `zod` for MCP tool input schemas.
- A minimal test runner; prefer Node's built-in `node:test` unless another runner provides a clear advantage.

Pin dependency versions in `package.json`. Include a lockfile if dependency installation creates one.

## 4. Required repository contents

The final repository must contain at least:

```text
.
├── shop.db
├── package.json
├── tsconfig.json
├── README.md
├── .gitignore
├── .env.example
├── config/
│   └── codex.config.toml.example
├── src/
│   ├── index.ts
│   ├── database.ts
│   ├── safety.ts
│   └── errors.ts
└── test/
    └── ...
```

The exact internal file split may change if a simpler structure remains clear and testable. Compiled output must go to `dist/` and must not be committed.

`package.json` must provide these scripts:

- `build`: compile TypeScript to `dist/`.
- `start`: run the compiled stdio server.
- `test`: run all automated tests.
- `typecheck`: check TypeScript without emitting output.

## 5. Configuration and database path

Use the environment variable `SHOP_DB_PATH` when it is set and non-empty. It may be absolute or relative:

- Absolute values are used as supplied.
- Relative values are resolved against the process working directory.

When `SHOP_DB_PATH` is absent, resolve `shop.db` relative to the project root derived from the server module location, not from a hard-coded absolute path and not solely from the caller's working directory. This fallback must work when the compiled entry point is `dist/index.js`.

At startup:

1. Resolve and normalize the database path.
2. Verify that it points to an existing regular file.
3. Open it with SQLite read-only mode and `fileMustExist` enabled.
4. Enable SQLite `query_only` mode as a second line of defense.
5. Do not enable extension loading.

If configuration or database opening fails, write a concise diagnostic to stderr and exit non-zero. Never write logs to stdout because stdout is reserved for MCP protocol messages.

`.env.example` must contain:

```dotenv
SHOP_DB_PATH=./shop.db
```

The application does not need to load `.env` automatically; the MCP client can supply environment variables.

## 6. MCP server behavior

Use `StdioServerTransport`. The process starts the MCP server directly; it must not listen on a network port.

Server metadata:

- Name: `shop-database`
- A valid semantic version matching the package version.
- Server-level instructions must state, within their first 512 characters, that the database is read-only, that the agent should inspect the schema before assuming column names or relationships, and that analytical questions may require joins and aggregations.

Register exactly the two tools below. More tools may be added only if they solve a demonstrated limitation; do not create one tool per assignment question.

### 6.1 `inspect_database`

Purpose: discover the available user tables and enough schema information for an agent to construct correct queries.

Input: no parameters.

Tool description must tell the agent to use it before its first query or whenever the schema is uncertain. It must say that the result includes tables, columns, keys, relationships, and row counts.

Inspect SQLite metadata dynamically. Exclude internal tables whose names start with `sqlite_`. Return tables in alphabetical order. For each table return:

```json
{
  "name": "orders",
  "purpose": "Customer orders, including order date and status.",
  "rowCount": 123,
  "columns": [
    {
      "name": "id",
      "type": "INTEGER",
      "nullable": false,
      "defaultValue": null,
      "primaryKeyPosition": 1
    }
  ],
  "foreignKeys": [
    {
      "fromColumn": "customer_id",
      "toTable": "customers",
      "toColumn": "id"
    }
  ]
}
```

Use these human-readable purposes for the expected tables:

- `customers`: customer identity, contact, and country information.
- `products`: product catalog, categories, and pricing information.
- `orders`: customer orders, including date and status information.
- `order_items`: order line items connecting orders and products, including quantities and any line-level pricing.

For an unexpected table, use a neutral purpose derived from its name and columns without inventing business facts.

The tool response must be valid JSON represented as MCP text content. Also return structured content if the selected SDK version supports it cleanly. Metadata inspection must itself use only read operations.

### 6.2 `query_database`

Purpose: execute one parameterized read-only SQL query for filtering, joins, aggregation, sorting, and analysis.

Input schema:

```json
{
  "sql": "SELECT country, COUNT(*) AS customer_count FROM customers GROUP BY country ORDER BY customer_count DESC LIMIT 1",
  "params": [],
  "limit": 100,
  "offset": 0
}
```

Input fields:

- `sql`: required non-empty string containing exactly one SQL statement. Only a result-producing `SELECT` or `WITH ... SELECT` statement is allowed.
- `params`: optional array of positional bind values; permitted values are string, finite number, boolean, and null. Default `[]`. Convert booleans to SQLite integers `1` and `0`.
- `limit`: optional integer from 1 through 200. Default `100`.
- `offset`: optional non-negative integer. Default `0`.

Tool description must explicitly explain:

- Use `?` placeholders and `params` for dynamic values.
- The tool supports joins and aggregate queries.
- Only one read-only `SELECT`/`WITH` statement is accepted.
- Schema and data changes are forbidden.
- Results are paginated; use `offset` to request the next page when `hasMore` is true.
- The agent should inspect the schema instead of guessing column names, date formats, price fields, or order status semantics.

Successful output shape:

```json
{
  "columns": ["country", "customer_count"],
  "rows": [
    {"country": "Germany", "customer_count": 12}
  ],
  "rowCount": 1,
  "limit": 100,
  "offset": 0,
  "hasMore": false
}
```

Pagination must be enforced by the server even if the submitted SQL has no `LIMIT`. Read no more than `offset + limit + 1` result rows and return only the requested page. `hasMore` is true when at least one additional row exists. Never return more than 200 rows from one call.

Preserve SQLite scalar types that JSON can represent. Serialize SQLite integers outside JavaScript's safe integer range without precision loss, for example as decimal strings. Convert any other non-JSON-native value to a stable string representation.

## 7. Read-only safety

Safety must be enforced in layers; prompt text alone is not a control.

1. Open the database in read-only mode.
2. Enable SQLite `query_only` mode.
3. Validate the SQL before preparing it.
4. Allow only one statement whose effective top-level form is `SELECT` or `WITH ... SELECT`.
5. Reject mutation, schema, transaction, attachment, and administrative operations, including at least:
   - `INSERT`, `UPDATE`, `DELETE`, `REPLACE`
   - `CREATE`, `ALTER`, `DROP`, `TRUNCATE`
   - `VACUUM`, `REINDEX`, `ANALYZE`
   - `ATTACH`, `DETACH`
   - `PRAGMA`
   - `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `RELEASE`
   - extension-loading operations
6. Reject multiple statements.

Validation must identify SQL tokens while ignoring keyword-like text inside string literals, quoted identifiers, and comments. Do not rely on a naive substring check as the only validator. It is acceptable for the validator to reject ambiguous input rather than risk accepting a write.

The request `Delete all cancelled orders.` must not be achievable through any exposed tool. A direct `DELETE FROM orders ...` call to `query_database` must return a clear refusal and leave the database byte-for-byte unchanged.

Mark both MCP tools as read-only through the SDK's tool annotations when supported by the installed SDK version.

## 8. Errors and process hygiene

Expected failures must produce a successful MCP protocol response with `isError: true` and concise text suitable for an agent. Distinguish these cases where practical:

- unsafe or non-read-only SQL;
- multiple statements;
- invalid parameters;
- malformed SQL or unknown tables/columns;
- database unavailable at startup;
- unexpected internal failure.

Examples:

- `Query rejected: only one read-only SELECT statement is allowed.`
- `SQL error: no such column: customer_name.`

Do not include stack traces, local source paths, environment contents, or raw error objects in MCP responses. Unexpected details may be logged to stderr, but keep them concise and do not log secrets or query result data.

Handle `SIGINT` and `SIGTERM` by closing the database and MCP server cleanly when possible.

## 9. Analytical capability acceptance criteria

With the MCP connected to a capable AI agent, the agent must be able to answer all of the following from live database data rather than hard-coded answers:

1. List all available tables and explain what each contains.
2. Count customers from Germany.
3. Return the country with the most customers and its customer count.
4. Return the name, email, and total purchase amount of the highest-spending customer.
5. Return the five best-selling products with product name, units sold, and revenue.
6. Return the three product categories with the highest revenue, joining `orders`, `order_items`, and `products` as required by the actual schema.
7. Return revenue generated in calendar year 2025 using the actual order date representation and only the order statuses that represent generated revenue.
8. Return the customer who placed the most orders and the order count.

The MCP server must not encode answers to these questions. The agent should:

- call `inspect_database` to learn exact columns and foreign keys;
- query distinct order statuses or representative values when business semantics are unclear;
- use the database's actual line price or product price fields as appropriate;
- use explicit joins, grouping, sorting, and deterministic tie-breaking;
- avoid counting cancelled orders as revenue unless the database clearly defines otherwise.

If the data contains ties, the query should return all tied leaders or apply a documented deterministic secondary ordering. The final natural-language interpretation belongs to the AI agent, not the MCP server.

## 10. Tests

Add automated tests, but do not run them during the implementation task. The user will run them and provide output if debugging is needed.

Tests must use a temporary fixture database, never mutate the repository's `shop.db`, and cover at least:

- database path resolution from `SHOP_DB_PATH` and the default location;
- schema inspection, expected columns, foreign keys, and internal-table exclusion;
- a parameterized `SELECT` query;
- a join and aggregate query;
- pagination, `hasMore`, offset behavior, and the 200-row maximum;
- malformed SQL with a sanitized error;
- rejection of every forbidden operation category listed in section 7;
- rejection of multiple statements;
- keyword text inside a string or comment not being misclassified as a mutation;
- unchanged database contents after rejected destructive requests;
- enough representative fixture data to exercise the eight analytical question patterns.

Design database and safety logic so it can be tested without starting a stdio MCP process. Protocol-level tests are optional.

## 11. README requirements

`README.md` must be concise but complete and follow this order:

1. What the project does and its read-only guarantee.
2. Prerequisites.
3. Install: `npm install`.
4. Configure: optional `SHOP_DB_PATH`, with the default behavior explained.
5. Build: `npm run build`.
6. Run manually: `npm start` (explain that stdio servers normally appear idle because they wait for MCP messages).
7. Connect to Codex IDE extension and CLI.
8. Available tools, parameters, limits, and example calls.
9. Test: `npm test`.
10. Safety design and troubleshooting.

Document both supported Codex connection approaches:

- IDE: Gear menu → MCP servers → Add server → STDIO → command/arguments/environment → save → restart extension.
- Project-scoped `.codex/config.toml` based on the supplied example.

The configuration example must use placeholders rather than machine-specific committed paths:

```toml
[mcp_servers.shop_database]
command = "node"
args = ["/ABSOLUTE/PATH/TO/PROJECT/dist/index.js"]
cwd = "/ABSOLUTE/PATH/TO/PROJECT"
startup_timeout_sec = 10
tool_timeout_sec = 60
enabled = true

[mcp_servers.shop_database.env]
SHOP_DB_PATH = "/ABSOLUTE/PATH/TO/PROJECT/shop.db"
```

Explain that Codex CLI and the IDE extension share Codex MCP configuration. Do not commit an active machine-specific `.codex/config.toml`.

## 12. Completion criteria

Implementation is complete when:

- all required files and scripts exist;
- TypeScript compiles under strict mode;
- the server uses MCP stdio transport and opens `shop.db` without a hard-coded absolute path;
- `inspect_database` and `query_database` match their specified schemas and descriptions;
- all returned query pages are capped at 200 rows;
- destructive and non-SELECT SQL is refused before execution and SQLite independently enforces read-only access;
- errors do not leak stack traces or local details;
- tests cover the required behavior but have not been run by the coding agent;
- README documents install → configure → build/run → connect to Codex → test;
- no HTTP server, hard-coded analytical answers, unrelated framework, or unnecessary abstraction is added.

## 13. Work restrictions for the coding agent

During implementation, the coding agent must not:

- run the automated tests;
- start the MCP server, including through MCP Inspector or another client;
- execute any command whose purpose is to exercise the running server.

The agent may inspect the repository and `shop.db`, edit files, install dependencies, and run non-runtime static checks or the TypeScript build if useful. At handoff, it must list changed files and give the exact commands the user should run. If verification requires tests or a live server, stop and ask the user to run the relevant command and return its output.
