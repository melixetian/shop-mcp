import { AppError } from "./errors.js";

type Token = { value: string; depth: number; kind: "word" | "symbol" };

const FORBIDDEN = new Set([
  "INSERT", "UPDATE", "DELETE", "REPLACE", "CREATE", "ALTER", "DROP", "TRUNCATE",
  "VACUUM", "REINDEX", "ANALYZE", "ATTACH", "DETACH", "PRAGMA", "BEGIN", "COMMIT",
  "ROLLBACK", "SAVEPOINT", "RELEASE", "LOAD_EXTENSION"
]);

/** Tokenizes enough SQLite syntax to make conservative read-only decisions. */
export function tokenizeSql(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let depth = 0;
  const pushWord = (value: string) => tokens.push({ value: value.toUpperCase(), depth, kind: "word" });
  while (i < sql.length) {
    const char = sql[i]!;
    if (/\s/.test(char)) { i++; continue; }
    if (sql.startsWith("--", i)) { i = sql.indexOf("\n", i + 2); if (i === -1) break; continue; }
    if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) throw new AppError("Query rejected: malformed SQL comment.");
      i = end + 2; continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      const quote = char; i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { i += 2; continue; }
          i++; closed = true; break;
        }
        i++;
      }
      if (!closed) throw new AppError("Query rejected: malformed quoted value.");
      continue;
    }
    if (char === "[") {
      const end = sql.indexOf("]", i + 1);
      if (end === -1) throw new AppError("Query rejected: malformed quoted identifier.");
      i = end + 1; continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = i++; while (i < sql.length && /[A-Za-z0-9_$]/.test(sql[i]!)) i++;
      pushWord(sql.slice(start, i)); continue;
    }
    if (char === "(") { tokens.push({ value: char, depth, kind: "symbol" }); depth++; i++; continue; }
    if (char === ")") { depth--; if (depth < 0) throw new AppError("Query rejected: malformed SQL."); tokens.push({ value: char, depth, kind: "symbol" }); i++; continue; }
    tokens.push({ value: char, depth, kind: "symbol" }); i++;
  }
  if (depth !== 0) throw new AppError("Query rejected: malformed SQL.");
  return tokens;
}

export function validateReadOnlySql(sql: string): string {
  if (!sql.trim()) throw new AppError("Query rejected: SQL must not be empty.");
  const tokens = tokenizeSql(sql);
  const semicolons = tokens.filter((token) => token.kind === "symbol" && token.value === ";");
  if (semicolons.length > 1 || (semicolons.length === 1 && tokens.at(-1) !== semicolons[0])) {
    throw new AppError("Query rejected: only one read-only SELECT statement is allowed.");
  }
  const words = tokens.filter((token) => token.kind === "word");
  if (words.some((token) => FORBIDDEN.has(token.value))) {
    throw new AppError("Query rejected: only one read-only SELECT statement is allowed.");
  }
  const first = words[0];
  if (!first || (first.value !== "SELECT" && first.value !== "WITH")) {
    throw new AppError("Query rejected: only one read-only SELECT statement is allowed.");
  }
  if (first.value === "WITH" && !words.some((token) => token.depth === 0 && token.value === "SELECT")) {
    throw new AppError("Query rejected: only one read-only SELECT statement is allowed.");
  }
  return semicolons.length === 1 ? sql.slice(0, sql.lastIndexOf(";")) : sql;
}
