// Smoke test for a staged/deployed plugin folder: proves every runtime
// dependency and every module the entry point loads can be resolved from the
// folder itself, i.e. that packaging did not strip anything Studio needs.
//
// Feed this file via stdin with cwd set to the plugin folder:
//   (cd <plugin-dir> && node --input-type=module < scripts/smoke-test.mjs)
// Why stdin: Node resolves bare specifiers (e.g. "bonjour-service") relative to
// the importing module. Run as a file from the repo, it would resolve against
// the repo's intact node_modules and miss exactly the breakage we are guarding
// against. Stdin/eval modules resolve against cwd instead.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

const targets = Object.keys(pkg.dependencies ?? {});

// plugin/app.js is not imported: it opens a WebSocket to Studio at load time.
// Importing the modules it depends on covers the same resolution graph without
// that side effect.
const pluginFiles = (await readdir(path.join(root, "plugin")))
  .filter((f) => f.endsWith(".js") && f !== "app.js")
  .map((f) => path.join(root, "plugin", f));
targets.push(...pluginFiles, path.join(root, "plugin-common-node", "index.js"));

let failed = 0;
for (const target of targets) {
  const specifier = path.isAbsolute(target)
    ? pathToFileURL(target).href
    : target;
  try {
    await import(specifier);
    console.log(
      `ok   ${path.isAbsolute(target) ? path.relative(root, target) : target}`,
    );
  } catch (err) {
    failed++;
    console.error(`FAIL ${target}\n     ${err.code ?? ""} ${err.message}`);
  }
}

console.log(
  `node ${process.version}: ${targets.length - failed}/${targets.length} modules resolved`,
);
// Some deps (e.g. mDNS sockets) may keep handles open after import; exit
// explicitly so the check never hangs the packaging pipeline.
process.exit(failed ? 1 : 0);
