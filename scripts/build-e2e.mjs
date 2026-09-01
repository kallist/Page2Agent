// Test-only E2E harness build: copies the production dist/ to dist-e2e/ and
// patches ONLY the test manifest with local fixture host access, replacing the
// activeTab grant that GUI automation cannot reliably trigger.
//
// This harness NEVER ships: it lives outside dist/, is gitignored, and the
// production build validator still audits the real dist/ manifest.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
const distE2eDir = join(root, "dist-e2e");

if (!existsSync(join(distDir, "manifest.json"))) {
  console.error("dist/ is missing. Run `npm run build` first.");
  process.exit(1);
}

rmSync(distE2eDir, { recursive: true, force: true });
mkdirSync(distE2eDir, { recursive: true });
cpSync(distDir, distE2eDir, { recursive: true });

const manifestPath = join(distE2eDir, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.host_permissions !== undefined) {
  console.error("production manifest unexpectedly already has host_permissions");
  process.exit(1);
}
manifest.host_permissions = ["http://127.0.0.1/*"];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log("dist-e2e/ built: production dist copied, test-only host_permissions added.");
