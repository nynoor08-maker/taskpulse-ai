/**
 * Apply schema.sql to the linked Supabase project.
 *
 * Preferred: SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (Management API migration).
 * Alternative: DATABASE_URL (direct Postgres via `pg`).
 *
 * Usage:
 *   npm run db:apply-schema
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { loadWorkspaceEnv } from "./load-workspace-env";

loadWorkspaceEnv();

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function schemaMigrationName(sql: string) {
  const hash = createHash("sha256").update(sql).digest("hex").slice(0, 12);
  return `taskpulse_schema_${hash}`;
}

async function applyViaManagementApi(sql: string) {
  const token = required("SUPABASE_ACCESS_TOKEN");
  const projectRef = required("SUPABASE_PROJECT_REF");
  const name = schemaMigrationName(sql);
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/migrations`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        query: sql,
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    // Idempotent re-apply: same content hash already recorded as a migration.
    if (
      response.status === 400 ||
      response.status === 409 ||
      /already exists|duplicate|conflict/i.test(body)
    ) {
      console.log(
        `Schema migration ${name} already applied (or conflicted) on project ${projectRef}; treating as success.`,
      );
      console.log(`API response: ${body.slice(0, 400)}`);
      return;
    }
    throw new Error(
      `Supabase Management API rejected schema apply (${response.status}): ${body}`,
    );
  }
  console.log(`Schema applied via Management API (${name}) to project ${projectRef}.`);
}

async function applyViaDatabaseUrl(sql: string) {
  const databaseUrl = required("DATABASE_URL");
  const require = createRequire(import.meta.url);
  let Client: new (config: {
    connectionString: string;
    ssl?: { rejectUnauthorized: boolean };
  }) => {
    connect: () => Promise<void>;
    query: (text: string) => Promise<unknown>;
    end: () => Promise<void>;
  };
  try {
    ({ Client } = require("pg") as { Client: typeof Client });
  } catch {
    throw new Error(
      "DATABASE_URL is set but the `pg` package is not installed. Run `npm install pg` or use SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF instead.",
    );
  }
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    console.log("Schema applied via DATABASE_URL.");
  } finally {
    await client.end();
  }
}

async function main() {
  const sql = await readFile("schema.sql", "utf8");
  if (!sql.trim()) throw new Error("schema.sql is empty.");

  if (process.env.SUPABASE_ACCESS_TOKEN && process.env.SUPABASE_PROJECT_REF) {
    await applyViaManagementApi(sql);
    return;
  }
  if (process.env.DATABASE_URL) {
    await applyViaDatabaseUrl(sql);
    return;
  }

  throw new Error(
    [
      "No schema apply credentials found.",
      "Set either:",
      "  - SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (recommended)",
      "  - DATABASE_URL (Postgres connection string)",
      "Then re-run: npm run db:apply-schema",
    ].join("\n"),
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
