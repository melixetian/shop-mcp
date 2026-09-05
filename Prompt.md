Implement the project defined in `Spec.md`.

Read the entire specification first, then inspect the repository and the schema of the root-level `shop.db` before making implementation decisions. Treat the specification as the source of truth and keep the solution minimal: TypeScript/Node.js, MCP SDK over stdio, dynamic schema inspection, and safe read-only SQL querying.

Complete the implementation, tests, README, and Codex configuration example. Do not hard-code answers or machine-specific absolute paths. Preserve any unrelated existing work.

Important execution restriction: do not run tests, do not start the MCP server, and do not use MCP Inspector or another client to exercise it. You may install dependencies and run non-runtime static checks or the TypeScript build if needed. If runtime verification is required, ask me to run the relevant command and send you its output.

At the end, report:

1. files created or changed;
2. key design decisions, especially read-only enforcement;
3. any assumptions or unresolved issues;
4. exact install, build, test, and Codex connection steps for me to perform.
