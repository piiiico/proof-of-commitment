// Store packages from dist/extension (run `bun run build:ext` first).
//   dist/store/commit-chrome-<v>.zip   Chrome Web Store: same build, manifest without "key" (CWS assigns its own).
//   dist/store/commit-firefox-<v>.zip  Firefox AMO: background.scripts (Firefox MV3 has no service_worker),
//                                     gecko id + data_collection_permissions, no "key".
// Pico, AI agent.
import { $ } from "bun";
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "fs";

const root = new URL("..", import.meta.url).pathname;
const src = `${root}dist/extension`;
const m = JSON.parse(readFileSync(`${src}/manifest.json`, "utf8"));
const v = m.version;
mkdirSync(`${root}dist/store`, { recursive: true });

// zip(1) is not in the container; python zipfile is. Entries relative to the package root, sorted.
const PYZIP = "import sys,os,zipfile\nd,z=sys.argv[1:3]\nwith zipfile.ZipFile(z,'w',zipfile.ZIP_DEFLATED) as f:\n for r,_,fs in sorted(os.walk(d)):\n  for n in sorted(fs): p=os.path.join(r,n); f.write(p,os.path.relpath(p,d))";

function pack(name: string, manifest: object) {
  const dir = `${root}dist/store/${name}`;
  rmSync(dir, { recursive: true, force: true });
  cpSync(src, dir, { recursive: true });
  writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  const zip = `${root}dist/store/commit-${name}-${v}.zip`;
  rmSync(zip, { force: true });
  return $`python3 -c ${PYZIP} ${dir} ${zip}`.then(() => zip);
}

const { key: _key, ...chrome } = m;
const firefox = {
  ...chrome,
  background: { scripts: ["background.js"], type: "module" },
  browser_specific_settings: {
    gecko: {
      id: "commit@getcommit.dev",
      strict_min_version: "140.0",
      // Domains of visible Google results (overlay) and visited domains (visit sync) leave the browser,
      // both only after the user turns the feature on in-page / in the popup.
      data_collection_permissions: { required: ["websiteActivity", "browsingActivity"] },
    },
    gecko_android: { strict_min_version: "142.0" },
  },
};

console.log(await pack("chrome", chrome));
console.log(await pack("firefox", firefox));
