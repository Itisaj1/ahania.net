// Bundle TipTap 3.32.2 and the markdown-it dialect into admin/vendor/tiptap.js.
// esm.sh loads a separate prosemirror build per package, so the editor
// imports this one file instead. Run: node scripts/build-admin-vendor.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cache = join(root, "scripts/.vendor-cache");
const versions = {
    "@tiptap/core": "3.32.2",
    "@tiptap/pm": "3.32.2",
    "@tiptap/starter-kit": "3.32.2",
    "@tiptap/extension-list": "3.32.2",
    "@tiptap/extension-table": "3.32.2",
    "@tiptap/extension-image": "3.32.2",
    "@tiptap/extension-code-block": "3.32.2",
    "@tiptap/extension-placeholder": "3.32.2",
    "@tiptap/extension-text-style": "3.32.2",
    "@tiptap/extension-color": "3.32.2",
    "@tiptap/markdown": "3.32.2",
    "markdown-it": "15.0.3",
    "markdown-it-task-lists": "2.1.1",
    "markdown-it-container": "4.0.0",
    esbuild: "0.28.2",
};

const entry = `
export { Editor, Extension, Node } from "@tiptap/core";
export { default as StarterKit } from "@tiptap/starter-kit";
export { TaskItem, TaskList } from "@tiptap/extension-list";
export { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
export { default as Image } from "@tiptap/extension-image";
export { default as CodeBlock } from "@tiptap/extension-code-block";
export { default as Placeholder } from "@tiptap/extension-placeholder";
export { TextStyle } from "@tiptap/extension-text-style";
export { Color } from "@tiptap/extension-color";
export { Markdown } from "@tiptap/markdown";
export { default as MarkdownIt } from "markdown-it";
export { default as taskLists } from "markdown-it-task-lists";
export { default as container } from "markdown-it-container";
`;

function npmBin() {
    const cli = join(cache, "package/bin/npm-cli.js");
    if (existsSync(cli)) return cli;
    const packed = join(cache, "npm.tgz");
    mkdirSync(cache, { recursive: true });
    const download = spawnSync("curl", ["-fsSL", "https://registry.npmjs.org/npm/-/npm-10.9.2.tgz", "-o", packed], { stdio: "inherit" });
    if (download.status !== 0) throw new Error("could not download npm");
    const unpacked = spawnSync("tar", ["-xzf", packed, "-C", cache], { stdio: "inherit" });
    if (unpacked.status !== 0) throw new Error("could not unpack npm");
    return cli;
}

mkdirSync(cache, { recursive: true });
writeFileSync(join(cache, "package.json"), JSON.stringify({ private: true, dependencies: versions }, null, 2));
const install = spawnSync(process.execPath, [npmBin(), "install", "--prefix", cache], { stdio: "inherit" });
if (install.status !== 0) process.exit(install.status ?? 1);

const esbuildModule = await import(pathToFileURL(join(cache, "node_modules/esbuild/lib/main.js")).href);
const esbuild = esbuildModule.default ?? esbuildModule;
await esbuild.build({
    stdin: {
        contents: entry,
        resolveDir: join(cache, "node_modules"),
        sourcefile: "admin-vendor-entry.js",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "none",
    outfile: join(root, "admin/vendor/tiptap.js"),
    banner: {
        js: "/* TipTap 3.32.2, markdown-it 15.0.3, markdown-it-task-lists 2.1.1, markdown-it-container 4.0.0. MIT. */",
    },
});
