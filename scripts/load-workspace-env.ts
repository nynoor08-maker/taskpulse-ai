import { loadEnvConfig } from "@next/env";

/** Load `.env`, `.env.local`, etc. the same way Next.js does. */
export function loadWorkspaceEnv() {
  loadEnvConfig(process.cwd());
}
