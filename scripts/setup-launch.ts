/**
 * End-to-end launch bootstrap:
 * 1) load env
 * 2) optionally apply schema.sql (SKIP_SCHEMA_APPLY=true to skip)
 * 3) run launch readiness checks
 */
import { spawn } from "node:child_process";
import { loadWorkspaceEnv } from "./load-workspace-env";

loadWorkspaceEnv();

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "null"}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  if (process.env.SKIP_SCHEMA_APPLY !== "true") {
    const canApply =
      Boolean(process.env.SUPABASE_ACCESS_TOKEN && process.env.SUPABASE_PROJECT_REF) ||
      Boolean(process.env.DATABASE_URL);
    if (canApply) {
      console.log("Applying schema.sql…");
      await run("npx", ["tsx", "scripts/apply-schema.ts"]);
    } else {
      console.log(
        "Skipping schema apply (set SUPABASE_ACCESS_TOKEN+SUPABASE_PROJECT_REF or DATABASE_URL).",
      );
    }
  } else {
    console.log("Skipping schema apply (SKIP_SCHEMA_APPLY=true).");
  }

  console.log("Running launch readiness…");
  await run("npx", ["tsx", "scripts/launch-check.ts"]);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
