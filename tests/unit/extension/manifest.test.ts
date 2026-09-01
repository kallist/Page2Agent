import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

interface Manifest {
  manifest_version?: number;
  name?: string;
  version?: string;
  permissions?: string[];
  host_permissions?: string[];
  content_scripts?: unknown[];
  action?: { default_popup?: string };
  side_panel?: { default_path?: string };
  background?: { service_worker?: string; type?: string };
  content_security_policy?: { extension_pages?: string };
}

function loadManifest(): Manifest {
  return JSON.parse(
    readFileSync(resolve(rootDir, "public", "manifest.json"), "utf8"),
  ) as Manifest;
}

function loadPackageJson(): { name?: string; version?: string } {
  return JSON.parse(
    readFileSync(resolve(rootDir, "package.json"), "utf8"),
  ) as { name?: string; version?: string };
}

const REQUIRED_PERMISSIONS = ["activeTab", "scripting", "sidePanel", "storage"];

const FORBIDDEN_PERMISSIONS = [
  "cookies",
  "history",
  "bookmarks",
  "webRequest",
  "downloads",
  "nativeMessaging",
  "tabs",
];

describe("manifest.json", () => {
  const manifest = loadManifest();
  const pkg = loadPackageJson();

  it("is a Manifest V3 extension named Page2Agent", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe("Page2Agent");
  });

  it("version matches package.json version", () => {
    expect(pkg.version).toBeDefined();
    expect(manifest.version).toBe(pkg.version);
  });

  it("declares the exact least-privilege permissions", () => {
    expect(manifest.permissions).toBeDefined();
    for (const permission of REQUIRED_PERMISSIONS) {
      expect(manifest.permissions).toContain(permission);
    }
  });

  it("does not request forbidden or premature permissions", () => {
    for (const permission of FORBIDDEN_PERMISSIONS) {
      expect(manifest.permissions).not.toContain(permission);
    }
  });

  it("has no host permissions and never grants <all_urls>", () => {
    expect(manifest.host_permissions).toBeUndefined();
  });

  it("has no persistent content scripts", () => {
    expect(manifest.content_scripts).toBeUndefined();
  });

  it("has no popup (Side Panel is the primary UI)", () => {
    expect(manifest.action?.default_popup).toBeUndefined();
  });

  it("points side_panel.default_path at a real side panel page", () => {
    expect(manifest.side_panel?.default_path).toBe("sidepanel.html");
  });

  it("declares an ES module service worker", () => {
    expect(manifest.background?.service_worker).toBe("assets/service-worker.js");
    expect(manifest.background?.type).toBe("module");
  });

  it("uses a strict extension CSP without unsafe-eval", () => {
    const csp = manifest.content_security_policy?.extension_pages ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("unsafe-inline");
  });
});
