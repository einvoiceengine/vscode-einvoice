import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const common = { bundle: true, platform: "node", target: "node18", format: "cjs", sourcemap: false, logLevel: "info" };

// the extension (vscode is provided by the editor)
const ext = { ...common, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js", external: ["vscode"], minify: !watch };
// the validation core on its own, for the tests (not shipped in the .vsix)
const core = { ...common, entryPoints: ["src/core.ts"], outfile: "dist/core.js" };

if (watch) {
  for (const o of [ext, core]) await (await esbuild.context(o)).watch();
} else {
  await Promise.all([esbuild.build(ext), esbuild.build(core)]);
}
