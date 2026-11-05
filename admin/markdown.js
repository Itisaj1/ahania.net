// TipTap 3.32.2 and markdown-it 15.0.3, bundled so one prosemirror copy loads.
import {
    MarkdownIt,
    taskLists,
    container,
    Editor,
    Extension,
    Node,
    StarterKit,
    TaskItem,
    TaskList,
    Table,
    TableCell,
    TableHeader,
    TableRow,
    Image,
    CodeBlock,
    Placeholder,
    TextStyle,
    Color,
    Markdown,
} from "./vendor/tiptap.js";

export const PANEL_TYPES = ["info", "note", "success", "warning", "error"];

export const TEXT_COLORS = ["#a8321f", "#8a5a00", "#23683a", "#1d4f9a", "#5b3a9a", "#6b6a66"];

const BLOCK_TAGS = new Set([
    "P", "DIV", "UL", "OL", "PRE", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6",
    "TABLE", "HR", "DETAILS",
]);

function plugin(mod) {
    return mod && mod.default ? mod.default : mod;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;");
}

export function toHex(color) {
    if (!color) return null;
    const value = String(color).trim().toLowerCase();
    if (!value || value === "inherit" || value === "currentcolor" || value === "transparent") return null;
    const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (hex) {
        const digits = hex[1];
        return `#${digits.length === 3 ? digits.split("").map((part) => part + part).join("") : digits}`;
    }
    const rgb = value.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (!rgb) return null;
    return `#${rgb.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
}

export function splitFrontMatter(text) {
    const source = String(text || "").replace(/\r\n/g, "\n");
    if (!source.startsWith("---\n")) return { meta: {}, body: source, hasFrontMatter: false };
    const end = source.indexOf("\n---", 3);
    if (end === -1) return { meta: {}, body: source, hasFrontMatter: false };
    const meta = {};
    for (const line of source.slice(4, end).split("\n")) {
        const splitAt = line.indexOf(":");
        if (splitAt === -1) continue;
        let value = line.slice(splitAt + 1).trim();
        if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[0] === value[value.length - 1]) {
            value = value.slice(1, -1);
        }
        meta[line.slice(0, splitAt).trim()] = value;
    }
    return { meta, body: source.slice(end + 4).replace(/^\n+/, ""), hasFrontMatter: true };
}

function unescapeSerialized(markdown) {
    return markdown
        .replace(/&gt;/g, ">")
        .replace(/&lt;/g, "<")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/\\([\\`*_[\]~])/g, "$1");
}

function cleanMarkdown(markdown) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    const kept = [];
    let fence = false;
    for (const line of lines) {
        if (line.trim().startsWith("```")) fence = !fence;
        if (!fence && line.trim() === "&nbsp;") continue;
        kept.push(line);
    }
    return kept.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
}

function plainNumber(value) {
    const text = String(value ?? "").trim();
    return /^-?\d+(\.\d+)?$/.test(text) ? text : "";
}

export function composeMarkdown(meta, body) {
    const text = cleanMarkdown(unescapeSerialized(body));
    const title = (meta && meta.title ? String(meta.title) : "").replace(/\s+/g, " ").trim();
    const description = (meta && meta.description ? String(meta.description) : "").replace(/\s+/g, " ").trim();
    const date = (meta && meta.date ? String(meta.date) : "").trim();
    const location = (meta && meta.location ? String(meta.location) : "").replace(/\s+/g, " ").trim();
    const lat = plainNumber(meta && meta.lat);
    const lng = plainNumber(meta && meta.lng);
    if (!title && !description && !date && !location && !lat && !lng) return text ? `${text}\n` : "";
    const lines = ["---", `title: ${title}`];
    if (description) lines.push(`description: ${description}`);
    if (date) lines.push(`date: ${date}`);
    if (location) lines.push(`location: ${location}`);
    if (lat) lines.push(`lat: ${lat}`);
    if (lng) lines.push(`lng: ${lng}`);
    lines.push("---", "");
    return `${lines.join("\n")}${text}\n`;
}

function panelRender(kind) {
    return (tokens, idx) => {
        if (tokens[idx].nesting === 1) {
            return `<div class="panel panel--${kind}"><p class="panel-label">${kind}</p>\n`;
        }
        return "</div>\n";
    };
}

function expandRender(tokens, idx) {
    if (tokens[idx].nesting !== 1) return "</details>\n";
    const info = tokens[idx].info.trim();
    const space = info.indexOf(" ");
    const title = space === -1 ? "details" : info.slice(space + 1).trim() || "details";
    return `<details class="expand"><summary>${escapeHtml(title)}</summary>\n`;
}

function buildMarkdown() {
    const md = new MarkdownIt("commonmark", { html: true, linkify: false });
    md.enable(["table", "strikethrough"]);
    md.use(plugin(taskLists), { enabled: false });
    for (const kind of PANEL_TYPES) md.use(plugin(container), kind, { render: panelRender(kind) });
    md.use(plugin(container), "expand", { render: expandRender });
    md.renderer.rules.html_block = (tokens, idx) => {
        const source = tokens[idx].content.replace(/\n$/, "");
        return `<div data-html-block="${encodeURIComponent(source)}"></div>\n`;
    };
    return md;
}

const MARKDOWN = buildMarkdown();

function wrapLoose(element) {
    const doc = element.ownerDocument;
    let paragraph = null;
    for (const node of [...element.childNodes]) {
        if (node.nodeType === 1 && BLOCK_TAGS.has(node.tagName)) {
            paragraph = null;
            continue;
        }
        if (node.nodeType === 3 && !node.textContent.trim()) continue;
        if (!paragraph) {
            paragraph = doc.createElement("p");
            node.before(paragraph);
        }
        paragraph.appendChild(node);
    }
    if (!element.querySelector("p, ul, ol, pre, blockquote, h1, h2, h3, h4, table, hr, details, div")) {
        element.appendChild(doc.createElement("p"));
    }
}

function prepareDom(html) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    const root = doc.body;
    root.querySelectorAll("ul.contains-task-list").forEach((list) => {
        list.setAttribute("data-type", "taskList");
        list.querySelectorAll(":scope > li.task-list-item").forEach((item) => {
            const input = item.querySelector("input.task-list-item-checkbox");
            const checked = !!(input && input.hasAttribute("checked"));
            input?.remove();
            item.setAttribute("data-type", "taskItem");
            item.setAttribute("data-checked", checked ? "true" : "false");
            const paragraph = item.querySelector(":scope > p");
            if (paragraph?.firstChild?.nodeType === 3) {
                paragraph.firstChild.textContent = paragraph.firstChild.textContent.replace(/^\s+/, "");
            }
        });
    });
    root.querySelectorAll("p").forEach((paragraph) => {
        if (paragraph.children.length === 1 && paragraph.firstElementChild.tagName === "IMG" && !paragraph.textContent.trim()) {
            paragraph.replaceWith(paragraph.firstElementChild);
        }
    });
    root.querySelectorAll("li, td, th").forEach((element) => {
        if (element.matches("li.task-list-item, li[data-type='taskItem']")) return;
        wrapLoose(element);
    });
    return root.innerHTML;
}

export function markdownToEditorHtml(markdown) {
    const rendered = MARKDOWN.render(String(markdown || "")).replace(/\n+$/, "");
    if (!rendered.trim()) return "<p></p>";
    return prepareDom(rendered);
}

function innerMarkdown(node, helpers) {
    const content = node.content || [];
    if (!content.length) return "";
    return String(helpers.renderChildren(content) || "").replace(/^\n+|\n+$/g, "");
}

function renderTable(node, helpers) {
    const rows = node.content || [];
    if (!rows.length) return "";
    const cellText = (cell) => innerMarkdown(cell, helpers).replace(/\n+/g, " ").replace(/\|/g, "\\|").trim();
    const lines = rows.map((row) => `| ${(row.content || []).map(cellText).join(" | ")} |`);
    const width = (rows[0].content || []).length || 1;
    lines.splice(1, 0, `| ${Array.from({ length: width }, () => "---").join(" | ")} |`);
    return lines.join("\n");
}

const Panel = Node.create({
    name: "panel",
    group: "block",
    content: "block+",
    defining: true,
    addAttributes() {
        return { type: { default: "info" } };
    },
    parseHTML() {
        return [{
            tag: "div.panel",
            priority: 60,
            getAttrs(element) {
                const fromClass = [...element.classList].find((name) => name.startsWith("panel--"));
                const type = fromClass ? fromClass.slice("panel--".length) : "info";
                element.querySelector(":scope > .panel-label")?.remove();
                wrapLoose(element);
                return { type: PANEL_TYPES.includes(type) ? type : "info" };
            },
        }];
    },
    renderHTML({ node }) {
        return ["div", { class: `panel panel--${node.attrs.type}` }, ["div", { class: "panel-body" }, 0]];
    },
    renderMarkdown(node, helpers) {
        const type = PANEL_TYPES.includes(node.attrs?.type) ? node.attrs.type : "info";
        return `:::${type}\n${innerMarkdown(node, helpers)}\n:::`;
    },
    addNodeView() {
        return ({ node, editor, getPos }) => {
            const dom = document.createElement("div");
            const bar = document.createElement("div");
            const select = document.createElement("select");
            const remove = document.createElement("button");
            const content = document.createElement("div");
            dom.className = `panel panel--${node.attrs.type}`;
            bar.className = "panel-bar";
            select.className = "panel-label";
            select.setAttribute("aria-label", "panel type");
            content.className = "panel-body";
            for (const type of PANEL_TYPES) {
                const option = document.createElement("option");
                option.value = type;
                option.textContent = type;
                select.appendChild(option);
            }
            select.value = node.attrs.type;
            remove.type = "button";
            remove.className = "panel-remove";
            remove.textContent = "remove panel";
            bar.append(select, remove);
            dom.append(bar, content);
            select.addEventListener("change", () => {
                const pos = getPos();
                if (typeof pos !== "number") return;
                editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { type: select.value }));
            });
            remove.addEventListener("mousedown", (event) => {
                event.preventDefault();
                const pos = getPos();
                if (typeof pos !== "number") return;
                const current = editor.state.doc.nodeAt(pos);
                if (!current) return;
                editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + current.nodeSize, current.content));
            });
            return {
                dom,
                contentDOM: content,
                stopEvent: (event) => bar.contains(event.target),
                ignoreMutation: (mutation) => !content.contains(mutation.target),
                update: (updated) => {
                    if (updated.type.name !== "panel") return false;
                    dom.className = `panel panel--${updated.attrs.type}`;
                    if (select.value !== updated.attrs.type) select.value = updated.attrs.type;
                    return true;
                },
            };
        };
    },
});

const Expand = Node.create({
    name: "expand",
    group: "block",
    content: "block+",
    defining: true,
    addAttributes() {
        return { title: { default: "" } };
    },
    parseHTML() {
        return [{
            tag: "details.expand",
            priority: 60,
            getAttrs(element) {
                const summary = element.querySelector(":scope > summary");
                const title = summary ? summary.textContent : "";
                summary?.remove();
                wrapLoose(element);
                return { title };
            },
        }];
    },
    renderHTML({ node }) {
        return ["details", { class: "expand", open: "open" }, ["summary", node.attrs.title || ""], ["div", 0]];
    },
    renderMarkdown(node, helpers) {
        const title = String(node.attrs?.title || "").trim();
        const head = title ? `:::expand ${title}` : ":::expand";
        return `${head}\n${innerMarkdown(node, helpers)}\n:::`;
    },
    addNodeView() {
        return ({ node, editor, getPos }) => {
            const dom = document.createElement("details");
            const summary = document.createElement("summary");
            const input = document.createElement("input");
            const content = document.createElement("div");
            dom.className = "expand";
            dom.open = true;
            input.className = "expand-title";
            input.value = node.attrs.title || "";
            input.placeholder = "title";
            input.setAttribute("aria-label", "expand title");
            content.className = "expand-body";
            summary.appendChild(input);
            dom.append(summary, content);
            summary.addEventListener("click", (event) => {
                if (event.target !== input) event.preventDefault();
            });
            input.addEventListener("input", () => {
                const pos = getPos();
                if (typeof pos !== "number") return;
                const current = editor.state.doc.nodeAt(pos);
                if (!current || current.attrs.title === input.value) return;
                editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { title: input.value }));
            });
            return {
                dom,
                contentDOM: content,
                stopEvent: (event) => event.target === input,
                ignoreMutation: (mutation) => !content.contains(mutation.target),
                update: (updated) => {
                    if (updated.type.name !== "expand") return false;
                    dom.open = true;
                    if (document.activeElement !== input && input.value !== (updated.attrs.title || "")) {
                        input.value = updated.attrs.title || "";
                    }
                    return true;
                },
            };
        };
    },
});

const HtmlBlock = Node.create({
    name: "htmlBlock",
    group: "block",
    atom: true,
    selectable: true,
    addAttributes() {
        return { source: { default: "" } };
    },
    parseHTML() {
        return [{
            tag: "div[data-html-block]",
            priority: 100,
            getAttrs(element) {
                const raw = element.getAttribute("data-html-block") || "";
                try {
                    return { source: decodeURIComponent(raw) };
                } catch {
                    return { source: raw };
                }
            },
        }];
    },
    renderHTML({ node }) {
        return ["div", { "data-html-block": encodeURIComponent(node.attrs.source || ""), class: "html-block" }];
    },
    renderMarkdown(node) {
        return String(node.attrs?.source || "").replace(/\n+$/, "");
    },
    addNodeView() {
        return ({ node, editor, getPos }) => {
            const dom = document.createElement("div");
            const label = document.createElement("div");
            const pre = document.createElement("pre");
            dom.className = "html-block-wrap";
            label.className = "html-block-label";
            label.textContent = "HTML";
            pre.className = "html-block";
            pre.textContent = node.attrs.source || "";
            dom.append(label, pre);
            dom.addEventListener("mousedown", (event) => {
                event.preventDefault();
                const pos = getPos();
                if (typeof pos === "number") editor.commands.setNodeSelection(pos);
            });
            return {
                dom,
                update: (updated) => {
                    if (updated.type.name !== "htmlBlock") return false;
                    pre.textContent = updated.attrs.source || "";
                    return true;
                },
            };
        };
    },
});

const PostImage = Image.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            preview: {
                default: null,
                rendered: false,
                parseHTML: () => null,
            },
            width: {
                default: null,
                rendered: false,
                parseHTML: () => null,
            },
            height: {
                default: null,
                rendered: false,
                parseHTML: () => null,
            },
        };
    },
    renderMarkdown(node) {
        const alt = String(node.attrs?.alt || "").replace(/\r?\n/g, " ").replace(/[\[\]]/g, "");
        return `![${alt}](${node.attrs?.src || ""})`;
    },
    addNodeView() {
        return ({ node, editor, getPos }) => {
            const dom = document.createElement("img");
            const paint = (current) => {
                dom.src = current.attrs.preview || current.attrs.src || "";
                dom.alt = current.attrs.alt || "";
                dom.dataset.path = current.attrs.src || "";
                if (current.attrs.width && current.attrs.height) {
                    dom.width = current.attrs.width;
                    dom.height = current.attrs.height;
                } else {
                    dom.removeAttribute("width");
                    dom.removeAttribute("height");
                }
            };
            paint(node);
            dom.addEventListener("mousedown", (event) => {
                event.preventDefault();
                const pos = getPos();
                if (typeof pos === "number") editor.commands.setNodeSelection(pos);
            });
            return {
                dom,
                update: (updated) => {
                    if (updated.type.name !== "image") return false;
                    paint(updated);
                    return true;
                },
            };
        };
    },
});

const ImageUpload = Node.create({
    name: "imageUpload",
    group: "block",
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes() {
        return {
            id: { default: "" },
            name: { default: "" },
            width: { default: 0 },
            height: { default: 0 },
            origWidth: { default: 0 },
            origHeight: { default: 0 },
            bytes: { default: 0 },
            progress: { default: 0 },
            error: { default: "" },
        };
    },
    renderHTML({ node }) {
        return ["div", { class: "image-upload", "data-image-upload": node.attrs.id || "" }];
    },
    renderMarkdown() {
        return "";
    },
    addNodeView() {
        return ({ node }) => {
            let current = node;
            const dom = document.createElement("div");
            const status = document.createElement("p");
            const bar = document.createElement("div");
            const fill = document.createElement("span");
            const note = document.createElement("p");
            const error = document.createElement("p");
            const errorText = document.createElement("span");
            const retry = document.createElement("a");
            const remove = document.createElement("a");
            dom.className = "image-upload";
            status.className = "image-upload-status";
            bar.className = "image-upload-bar";
            bar.appendChild(fill);
            note.className = "image-upload-note";
            error.className = "image-upload-error";
            retry.href = "#";
            retry.textContent = "retry";
            remove.href = "#";
            remove.textContent = "remove";
            error.append(errorText, retry, remove);
            dom.append(status, bar, note, error);
            const paint = (currentNode) => {
                current = currentNode;
                const attrs = currentNode.attrs;
                const size = formatUploadBytes(attrs.bytes);
                status.textContent = attrs.width && attrs.height
                    ? `uploading ${attrs.name} · ${attrs.width} × ${attrs.height}, ${size}`
                    : `uploading ${attrs.name} · ${size}`;
                const resized = attrs.origWidth && attrs.origHeight
                    && (attrs.origWidth !== attrs.width || attrs.origHeight !== attrs.height);
                note.hidden = !resized;
                note.textContent = resized
                    ? `resized from ${attrs.origWidth} × ${attrs.origHeight} before upload`
                    : "";
                const failed = !!attrs.error;
                bar.hidden = failed;
                error.hidden = !failed;
                fill.style.width = `${Math.max(0, Math.min(100, Math.round((attrs.progress || 0) * 100)))}%`;
                errorText.textContent = attrs.error || "";
            };
            const emit = (name) => {
                dom.dispatchEvent(new CustomEvent(name, {
                    bubbles: true,
                    detail: { id: current.attrs.id },
                }));
            };
            retry.addEventListener("click", (event) => {
                event.preventDefault();
                emit("image-upload-retry");
            });
            remove.addEventListener("click", (event) => {
                event.preventDefault();
                emit("image-upload-remove");
            });
            paint(node);
            return {
                dom,
                stopEvent: (event) => !!event.target.closest?.("a"),
                ignoreMutation: () => true,
                update: (updated) => {
                    if (updated.type.name !== "imageUpload") return false;
                    paint(updated);
                    return true;
                },
            };
        };
    },
});

function formatUploadBytes(size) {
    const bytes = Number(size) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FencedCode = CodeBlock.extend({
    renderMarkdown(node, helpers) {
        const language = node.attrs?.language || "";
        const body = String(helpers.renderChildren(node.content || []) || "").replace(/\n$/, "");
        return `\`\`\`${language}\n${body}\n\`\`\``;
    },
});

const ColoredText = TextStyle.extend({
    renderMarkdown(node, helpers) {
        const inner = helpers.renderChildren(node);
        const hex = toHex(node.attrs?.color);
        if (!hex) return inner;
        return `<span style="color:${hex}">${inner}</span>`;
    },
});

const EditorKeys = Extension.create({
    name: "editorKeys",
    addKeyboardShortcuts() {
        return {
            "Mod-Shift-7": () => this.editor.commands.toggleOrderedList(),
            "Mod-Shift-8": () => this.editor.commands.toggleBulletList(),
        };
    },
});

export function editorExtensions() {
    return [
        StarterKit.configure({
            codeBlock: false,
            heading: { levels: [1, 2, 3, 4] },
            link: {
                openOnClick: false,
                autolink: true,
                linkOnPaste: true,
                HTMLAttributes: { target: null, rel: null, class: null },
            },
        }),
        FencedCode,
        Placeholder.configure({
            placeholder: "type / for blocks, or just start writing",
            showOnlyCurrent: true,
            includeChildren: true,
        }),
        TaskList.configure({ HTMLAttributes: { class: "contains-task-list" } }),
        TaskItem.configure({ nested: false }),
        Table.extend({ renderMarkdown: renderTable }).configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        PostImage.configure({ inline: false, allowBase64: false }),
        ImageUpload,
        ColoredText,
        Color,
        Panel,
        Expand,
        HtmlBlock,
        EditorKeys,
        Markdown,
    ];
}

export function createEditor(element) {
    return new Editor({
        element,
        extensions: editorExtensions(),
        content: "<p></p>",
        editorProps: {
            attributes: { "aria-label": "post body", spellcheck: "true" },
        },
    });
}
