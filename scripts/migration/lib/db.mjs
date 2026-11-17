// Small database helper shared by the migration stages.
// Uses the "pg" package when it is installed (it is, in the project folder) and falls back to the psql command.
// Reads from the OLD database always run in a read-only session.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

/** SQL string literal (or NULL). */
export function lit(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** A stable id from a kind and a key, so re-running a stage never creates duplicates. */
export function stableId(kind, key) {
  return "mg" + crypto.createHash("sha1").update(`${kind}:${key}`).digest("hex").slice(0, 22);
}

export async function openDb(url, { readOnly = false, driver = process.env.MIGRATION_DB_DRIVER || "auto" } = {}) {
  if (driver !== "psql") {
    try {
      const pg = (await import("pg")).default;
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      if (readOnly) await client.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
      return {
        driver: "pg",
        select: async (sql) => (await client.query(sql)).rows,
        // Runs all statements in ONE transaction; commits only when commit = true, otherwise rolls back (dry run).
        runAll: async (statements, commit) => {
          await client.query("BEGIN");
          try {
            for (const statement of statements) await client.query(statement);
            await client.query(commit ? "COMMIT" : "ROLLBACK");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
        },
        close: () => client.end(),
      };
    } catch (error) {
      if (driver === "pg") throw error;
    }
  }
  const env = { ...process.env, ...(readOnly ? { PGOPTIONS: "-c default_transaction_read_only=on" } : {}) };
  return {
    driver: "psql",
    select: async (sql) => {
      const out = execFileSync("psql", [url, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", `SELECT coalesce(json_agg(t), '[]'::json) FROM (${sql}) t`], { env, maxBuffer: 1 << 30, encoding: "utf8" });
      return JSON.parse(out.trim() || "[]");
    },
    runAll: async (statements, commit) => {
      const script = ["BEGIN;", ...statements.map((s) => s.trim().replace(/;$/, "") + ";"), commit ? "COMMIT;" : "ROLLBACK;"].join("\n");
      execFileSync("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"], { env, input: script, maxBuffer: 1 << 30, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] });
    },
    close: async () => {},
  };
}

export function arg(name, envName) {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) return process.argv[index + 1];
  return envName ? process.env[envName] : undefined;
}
export const flag = (name) => process.argv.includes(`--${name}`);
