// Build artifact validator: proves that `vite build` produced a structurally
// consistent MV3 extension artifact, not just a successful exit code.
// Any violation fails the build with a non-zero exit code.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");

const FORBIDDEN_PERMISSIONS = [
  "cookies",
  "history",
  "bookmarks",
  "webRequest",
  "downloads",
  "nativeMessaging",
  "tabs",
];

/** Exactly the least-privilege set this stage genuinely uses. */
const REQUIRED_PERMISSIONS = ["activeTab", "scripting", "sidePanel", "storage"];

const failures = [];
function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function findFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

// 1. dist/manifest.json exists.
const manifestPath = join(distDir, "manifest.json");
check(existsSync(manifestPath), "dist/manifest.json is missing");

if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  // 2. Manifest V3.
  check(
    manifest.manifest_version === 3,
    `manifest_version must be 3, got ${manifest.manifest_version}`,
  );

  // 3. Manifest version matches package.json version.
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  check(
    manifest.version === pkg.version,
    `manifest version ${manifest.version} does not match package.json version ${pkg.version}`,
  );

  // 4. side_panel.default_path points to a real file.
  const sidePanelPath = manifest.side_panel?.default_path;
  check(
    typeof sidePanelPath === "string" && existsSync(join(distDir, sidePanelPath)),
    "side_panel.default_path target file is missing in dist/",
  );

  // 5. background.service_worker points to a real file.
  const serviceWorkerPath = manifest.background?.service_worker;
  check(
    typeof serviceWorkerPath === "string" && existsSync(join(distDir, serviceWorkerPath)),
    "background.service_worker target file is missing in dist/",
  );

  // 6. The self-contained content script exists at its stable path.
  check(
    existsSync(join(distDir, "assets", "content-script.js")),
    "dist/assets/content-script.js is missing",
  );

  // 7. No <all_urls> host permission.
  const hostPermissions = manifest.host_permissions ?? [];
  check(
    !hostPermissions.includes("<all_urls>"),
    "manifest grants <all_urls> host permission",
  );

  // 8. No persistent content_scripts.
  check(
    !Array.isArray(manifest.content_scripts) || manifest.content_scripts.length === 0,
    "manifest declares persistent content_scripts",
  );

  // 9. No popup UI (Side Panel is the primary UI).
  check(
    !manifest.action || !("default_popup" in manifest.action),
    "manifest declares a default_popup",
  );

  // 10. No forbidden permissions.
  const permissions = manifest.permissions ?? [];
  for (const permission of FORBIDDEN_PERMISSIONS) {
    check(
      !permissions.includes(permission),
      `manifest requests forbidden permission: ${permission}`,
    );
  }

  // 11. The exact least-privilege permission set is present (storage is now
  //     genuinely used for chrome.storage.session).
  for (const permission of REQUIRED_PERMISSIONS) {
    check(
      permissions.includes(permission),
      `manifest is missing required permission: ${permission}`,
    );
  }
  check(
    permissions.every((permission) =>
      [...REQUIRED_PERMISSIONS, ...FORBIDDEN_PERMISSIONS].includes(permission),
    ),
    `manifest requests an unexpected permission: ${permissions.join(", ")}`,
  );

  // 12. No source map artifacts.
  const mapFiles = findFiles(distDir).filter((file) => file.endsWith(".map"));
  check(mapFiles.length === 0, `source map artifacts present in dist/: ${mapFiles.join(", ")}`);

  // 13. Manifest-owned files all resolve inside dist/.
  const manifestOwned = [serviceWorkerPath, sidePanelPath].filter(
    (path) => typeof path === "string",
  );
  for (const path of manifestOwned) {
    check(
      existsSync(join(distDir, path)),
      `manifest-owned file missing in dist/: ${path}`,
    );
  }

  // Content script must be self-contained: no top-level import statements.
  const contentScriptSource = readFileSync(join(distDir, "assets", "content-script.js"), "utf8");
  check(
    !/^\s*import\s/m.test(contentScriptSource),
    "content-script.js contains top-level import statements (not self-contained)",
  );
}

if (failures.length > 0) {
  console.error("Build validation FAILED:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Build validation PASSED: dist/ is a structurally valid MV3 extension artifact.");
