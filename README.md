# Shop Database MCP Server

This local stdio MCP server lets an AI agent inspect and analyze `shop.db`. It is read-only: SQLite is opened read-only, `query_only` is enabled, and the server rejects anything except one `SELECT` or `WITH ... SELECT` query.

## Prerequisites

Node.js 20 or newer and the supplied SQLite database.

## Install

```sh
npm install
```

## Configure

`SHOP_DB_PATH` is optional. If set, a relative value is resolved from the process working directory; an absolute value is used directly. Otherwise the server finds `shop.db` relative to its compiled module, including when launched outside the project directory. See `.env.example`; it is not loaded automatically.

## Build

```sh
npm run build
```

## Run manually

```sh
npm start
```

A stdio server normally appears idle because it waits for MCP messages.

## Connect to Codex IDE extension and CLI

In the IDE extension: Gear menu → **MCP servers** → **Add server** → **STDIO**. Set command, arguments, and environment from `config/codex.config.toml.example`, save, and restart the extension.

For a project-scoped setup, copy that example to `.codex/config.toml` and replace every `/ABSOLUTE/PATH/TO/PROJECT` placeholder. Codex CLI and the IDE extension share Codex MCP configuration. Do not commit the active configuration file.

## Available tools

`inspect_database` takes no parameters. Use it before querying or when uncertain; it returns tables, columns, primary/foreign keys, relationships, and row counts.

`query_database` accepts `sql` (required), `params` (positional string, finite number, boolean, or null values), `limit` (1–200; default 100), and `offset` (default 0). Use `?` placeholders; joins and aggregates work. It accepts exactly one read-only `SELECT` or `WITH ... SELECT`. Inspect schema before assuming columns, date formats, prices, or statuses. Results contain `columns`, `rows`, `rowCount`, `limit`, `offset`, and `hasMore`; request another page with a new offset.

```json
{"sql":"SELECT country, COUNT(*) AS customer_count FROM customers GROUP BY country ORDER BY customer_count DESC","params":[],"limit":100,"offset":0}
```

## Test

```sh
npm test
```

Tests create temporary fixture databases and never modify `shop.db`.

## Safety design and troubleshooting

Safety layers are read-only file access, SQLite `query_only`, conservative token-aware validation that ignores comments/strings/quoted identifiers, a single-statement rule, and server-side pagination. Tool errors are concise and do not expose stack traces or local paths.

If startup fails, verify `SHOP_DB_PATH` names an existing regular SQLite file. If a query fails, call `inspect_database`, use `?` parameters, and verify names and relationships.
