import { GitHub, AuthError, ConflictError, RateLimitError, NetworkError } from "./github.js";
import { getAuth, clearAuth, getBackup, setBackup, clearBackup } from "./store.js";
import {
    PANEL_TYPES,
    TEXT_COLORS,
    splitFrontMatter,
    composeMarkdown,
    markdownToEditorHtml,
    createEditor,
    toHex,
} from "./markdown.js";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const $ = (id) => document.getElementById(id);

const ui = {
    fileName: $("file-name"),
    status: $("file-status"),
    save: $("save-draft"),
    menuSave: $("menu-save"),
    publish: $("publish"),
    more: $("more"),
    moreMenu: $("more-menu"),
    viewLive: $("view-live"),
    menuDetails: $("menu-details"),
    unpublish: $("unpublish"),
    deletePost: $("delete-post"),
    notice: $("save-notice"),
    banner: $("backup-banner"),
    bannerText: $("backup-banner-text"),
    toast: $("toast"),
    toastLink: $("toast-link"),
    deleteDialog: $("delete-dialog"),
    deleteTitle: $("delete-title"),
    deleteCancel: $("delete-cancel"),
    deleteConfirm: $("delete-confirm"),
    conflictDialog: $("conflict-dialog"),
    conflictTitle: $("conflict-title"),
    loadTheirs: $("load-theirs"),
    keepMine: $("keep-mine"),
    style: $("style-select"),
    styleButton: $("style-button"),
    styleMenu: $("style-menu"),
    insertButton: $("insert-block"),
    title: $("title"),
    metaDescription: $("meta-description"),
    metaDate: $("meta-date"),
    editDetails: $("edit-details"),
    details: $("details-popover"),
    description: $("description-input"),
    date: $("date-input"),
    backup: $("backup-line"),
    bubble: $("bubble"),
    linkForm: $("link-form"),
    linkUrl: $("link-url"),
    imageFile: $("image-file"),
    altForm: $("alt-form"),
    altInput: $("alt-input"),
    imageBar: $("image-bar"),
    colorMenu: $("color-menu"),
    colorButton: $("color-button"),
    colorBar: $("color-bar"),
    bubbleColor: $("bubble-color"),
    panelButton: $("panel-button"),
    panelMenu: $("panel-menu"),
    slash: $("slash-menu"),
    slashList: $("slash-list"),
    tableBar: $("table-bar"),
    indexLink: $("index-link"),
};

let editor = null;
let github = null;
let slug = "";
let draftPath = "";
let publishedPath = "";
let draftSha = null;
let publishedSha = null;
let baseline = "";
let publishedSnapshot = null;
let publishedText = null;
let description = "";
let date = "";
let backupAt = null;
let githubAt = null;
let saveState = "";
let holdError = false;
let saving = false;
let ready = false;
let pendingAction = null;
let altSrc = "";
let dragDepth = 0;
let lastImageStamp = "";
const imageJobs = new Map();
let openEl = null;
let openAnchor = null;
let focusReturn = null;
let slashPinned = false;
let slashDismissed = null;
let slashIndex = 0;
let slashOptions = [];

function clock(value) {
    if (!value) return "—:—";
    const when = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(when.getTime())) return "—:—";
    return `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
}

function formatDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    if (!match) return "not set";
    return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

function meta() {
    return {
        title: ui.title.value.replace(/\s+/g, " ").trim(),
        description: description.trim(),
        date: date.trim(),
    };
}

function currentMarkdown() {
    return composeMarkdown(meta(), editor.getMarkdown());
}

function displayName() {
    return draftSha ? `_drafts/${slug}.md` : `${slug}.md`;
}

function growTitle() {
    ui.title.style.height = "auto";
    ui.title.style.height = `${ui.title.scrollHeight}px`;
}

function phoneEditor() {
    return window.matchMedia("(max-width: 600px)").matches;
}

function visualFrame() {
    const viewport = window.visualViewport;
    if (!viewport) {
        return { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth };
    }
    return {
        top: viewport.offsetTop,
        left: viewport.offsetLeft,
        right: viewport.offsetLeft + viewport.width,
        bottom: viewport.offsetTop + viewport.height,
        width: viewport.width,
    };
}

function shown(element) {
    if (!element || element === document.body) return false;
    if (element.closest("[hidden]")) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
}

function focusables(container) {
    const selector = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])";
    return [...container.querySelectorAll(selector)].filter(shown);
}

function restoreFocus(node) {
    if (node && node.isConnected && shown(node)) node.focus();
}

function closePops(restore = true) {
    for (const el of [ui.moreMenu, ui.details, ui.linkForm, ui.altForm, ui.colorMenu, ui.panelMenu, ui.styleMenu]) {
        el.hidden = true;
    }
    ui.more.setAttribute("aria-expanded", "false");
    ui.styleButton.setAttribute("aria-expanded", "false");
    openEl = null;
    openAnchor = null;
    const back = focusReturn;
    if (restore) {
        focusReturn = null;
        if (back) restoreFocus(back);
        else if (editor) editor.commands.focus();
    }
    placeFloaters();
}

function placeLayer(element, rect, align, prefer = "below") {
    const frame = visualFrame();
    const width = element.offsetWidth || 240;
    const height = element.offsetHeight || 44;
    const preferred = align === "end" ? rect.right - width : rect.left;
    const left = Math.max(frame.left + 8, Math.min(preferred, frame.right - width - 8));
    let top = prefer === "above" ? rect.top - height - 6 : rect.bottom + 6;
    if (top < frame.top + 8) top = rect.bottom + 6;
    if (top + height > frame.bottom - 8) top = Math.max(frame.top + 8, rect.top - height - 6);
    element.style.top = `${top}px`;
    element.style.left = `${left}px`;
}

function openPop(element, anchor, align) {
    const same = openEl === element && !element.hidden;
    closePops(false);
    if (same) {
        focusReturn = null;
        restoreFocus(anchor);
        return;
    }
    focusReturn = anchor;
    element.hidden = false;
    openEl = element;
    openAnchor = anchor;
    if (anchor?.hasAttribute("aria-expanded")) anchor.setAttribute("aria-expanded", "true");
    placeLayer(element, anchor.getBoundingClientRect(), align);
    focusables(element)[0]?.focus();
}

function slashQuery(state) {
    const { selection } = state;
    if (!selection.empty || selection.node) return null;
    const { $from } = selection;
    if (!$from.parent.isTextblock || $from.parent.type.name === "codeBlock") return null;
    const text = $from.parent.textBetween(0, $from.parentOffset, "\n", "\0");
    const match = /(^|\s)\/([^\s]*)$/.exec(text);
    if (!match) return null;
    const slashAt = match.index + match[1].length;
    return {
        from: $from.pos - (text.length - slashAt),
        to: $from.pos,
        query: match[2],
    };
}

function blockJSON(type, attrs) {
    if (type === "panel") {
        return { type: "panel", attrs, content: [{ type: "paragraph" }] };
    }
    if (type === "expand") {
        return { type: "expand", attrs: { title: "" }, content: [{ type: "paragraph" }] };
    }
    return { type };
}

const SLASH_ITEMS = [
    { label: "heading 1", shortcut: "#", apply: (chain) => chain.setHeading({ level: 1 }).run() },
    { label: "heading 2", shortcut: "##", apply: (chain) => chain.setHeading({ level: 2 }).run() },
    { label: "heading 3", shortcut: "###", apply: (chain) => chain.setHeading({ level: 3 }).run() },
    { label: "bullet list", shortcut: "-", apply: (chain) => chain.toggleBulletList().run() },
    { label: "numbered list", shortcut: "1.", apply: (chain) => chain.toggleOrderedList().run() },
    { label: "task list", shortcut: "[]", apply: (chain) => chain.toggleTaskList().run() },
    { label: "quote", shortcut: ">", apply: (chain) => chain.toggleBlockquote().run() },
    { label: "code block", shortcut: "```", apply: (chain) => chain.setCodeBlock().run() },
    { label: "table", shortcut: "", apply: (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    ...PANEL_TYPES.map((type) => ({
        label: `${type} panel`,
        shortcut: "",
        apply: (chain) => chain.insertContent(blockJSON("panel", { type })).run(),
    })),
    { label: "expand", shortcut: "", apply: (chain) => chain.insertContent(blockJSON("expand")).run() },
    { label: "divider", shortcut: "---", apply: (chain) => chain.setHorizontalRule().run() },
    { label: "image", shortcut: "", apply: (chain) => { chain.run(); openImagePicker(); } },
];

function closeSlash(sticky, restore = false) {
    const wasOpen = !ui.slash.hidden;
    ui.slash.hidden = true;
    slashPinned = false;
    if (!sticky) slashDismissed = null;
    else {
        const query = editor ? slashQuery(editor.state) : null;
        slashDismissed = query ? `${query.from}:${query.query}` : "x";
    }
    if (restore && wasOpen) {
        const back = focusReturn;
        focusReturn = null;
        restoreFocus(back);
    }
}

function renderSlashItem(item, selected, query) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "slash-item";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.id = `slash-opt-${slashOptions.length}`;
    const label = document.createElement("span");
    const needle = query.toLowerCase();
    const at = needle ? item.label.toLowerCase().indexOf(needle) : -1;
    if (at >= 0) {
        label.append(document.createTextNode(item.label.slice(0, at)));
        const mark = document.createElement("span");
        mark.className = "slash-match";
        mark.textContent = item.label.slice(at, at + query.length);
        label.append(mark, document.createTextNode(item.label.slice(at + query.length)));
    } else {
        label.textContent = item.label;
    }
    button.appendChild(label);
    if (item.shortcut) {
        const shortcut = document.createElement("span");
        shortcut.className = "slash-shortcut";
        shortcut.textContent = item.shortcut;
        button.appendChild(shortcut);
    }
    button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        insertSlash(item);
    });
    button.addEventListener("mousemove", () => {
        const index = slashOptions.indexOf(item);
        if (index !== slashIndex) {
            slashIndex = index;
            markSlash();
        }
    });
    slashOptions.push(item);
    return button;
}

function markSlash() {
    const options = [...ui.slashList.querySelectorAll("[role='option']")];
    options.forEach((option, index) => option.setAttribute("aria-selected", index === slashIndex ? "true" : "false"));
    options[slashIndex]?.scrollIntoView({ block: "nearest" });
    if (options[slashIndex]) ui.slashList.setAttribute("aria-activedescendant", options[slashIndex].id);
    if (ui.slash.contains(document.activeElement)) options[slashIndex]?.focus();
}

function fillSlash(queryText) {
    const needle = queryText.toLowerCase();
    const matches = needle ? SLASH_ITEMS.filter((item) => item.label.toLowerCase().includes(needle)) : [];
    ui.slashList.replaceChildren();
    slashOptions = [];
    const addHeading = (text) => {
        const heading = document.createElement("div");
        heading.className = "slash-heading";
        heading.textContent = text;
        ui.slashList.appendChild(heading);
    };
    if (needle) {
        addHeading("matches");
        if (!matches.length) {
            const empty = document.createElement("div");
            empty.className = "slash-empty";
            empty.textContent = "no matches";
            ui.slashList.appendChild(empty);
        } else {
            for (const item of matches) ui.slashList.appendChild(renderSlashItem(item, false, queryText));
        }
    }
    addHeading("all blocks");
    for (const item of SLASH_ITEMS) ui.slashList.appendChild(renderSlashItem(item, false, queryText));
    if (slashIndex >= slashOptions.length) slashIndex = 0;
    markSlash();
}

function updateSlash() {
    if (!editor) return;
    const query = slashQuery(editor.state);
    if (slashPinned && !query) return;
    if (slashPinned && query) {
        slashPinned = false;
        if (focusReturn === ui.insertButton) focusReturn = null;
    }
    slashPinned = false;
    if (!query) {
        slashDismissed = null;
        ui.slash.hidden = true;
        if (focusReturn === ui.insertButton) focusReturn = null;
        return;
    }
    if (slashDismissed === `${query.from}:${query.query}`) return;
    slashDismissed = null;
    fillSlash(query.query);
    ui.slash.hidden = false;
    ui.bubble.hidden = true;
    const coords = editor.view.coordsAtPos(query.to);
    placeLayer(ui.slash, { left: coords.left, right: coords.left, top: coords.top, bottom: coords.bottom });
}

function openInsertMenu() {
    if (!editor || !ready) return;
    closePops(false);
    slashDismissed = null;
    slashPinned = true;
    slashIndex = 0;
    fillSlash("");
    ui.slash.hidden = false;
    ui.bubble.hidden = true;
    focusReturn = ui.insertButton;
    placeLayer(ui.slash, ui.insertButton.getBoundingClientRect());
    focusables(ui.slash)[0]?.focus();
}

function insertSlash(item) {
    const query = slashQuery(editor.state);
    let chain = editor.chain().focus();
    if (query) chain = chain.deleteRange({ from: query.from, to: query.to });
    closeSlash(false);
    item.apply(chain);
}

function moveSlash(delta) {
    if (!slashOptions.length) return;
    slashIndex = (slashIndex + delta + slashOptions.length) % slashOptions.length;
    markSlash();
}

function run(name, trigger) {
    const chain = editor.chain().focus();
    const commands = {
        bold: () => chain.toggleBold().run(),
        italic: () => chain.toggleItalic().run(),
        underline: () => chain.toggleUnderline().run(),
        strike: () => chain.toggleStrike().run(),
        code: () => chain.toggleCode().run(),
        link: () => openLink(trigger),
        bullet: () => chain.toggleBulletList().run(),
        ordered: () => chain.toggleOrderedList().run(),
        task: () => chain.toggleTaskList().run(),
        table: () => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
        codeBlock: () => chain.toggleCodeBlock().run(),
        quote: () => chain.toggleBlockquote().run(),
        expand: () => chain.insertContent(blockJSON("expand")).run(),
        hr: () => chain.setHorizontalRule().run(),
        image: () => openImagePicker(),
        undo: () => chain.undo().run(),
        redo: () => chain.redo().run(),
    };
    commands[name]?.();
}

function paintToolbar() {
    if (!editor) return;
    const active = {
        bold: editor.isActive("bold"),
        italic: editor.isActive("italic"),
        underline: editor.isActive("underline"),
        strike: editor.isActive("strike"),
        code: editor.isActive("code"),
        link: editor.isActive("link"),
        bullet: editor.isActive("bulletList"),
        ordered: editor.isActive("orderedList"),
        task: editor.isActive("taskList"),
        codeBlock: editor.isActive("codeBlock"),
        quote: editor.isActive("blockquote"),
    };
    document.querySelectorAll("[data-cmd]").forEach((button) => {
        const on = !!active[button.dataset.cmd];
        button.classList.toggle("is-active", on);
        if (button.dataset.cmd !== "undo" && button.dataset.cmd !== "redo") {
            button.setAttribute("aria-pressed", on ? "true" : "false");
        }
    });
    document.querySelectorAll("[data-cmd='undo']").forEach((button) => {
        button.disabled = !editor.can().undo();
    });
    document.querySelectorAll("[data-cmd='redo']").forEach((button) => {
        button.disabled = !editor.can().redo();
    });
    let style = "p";
    for (const level of [1, 2, 3, 4]) {
        if (editor.isActive("heading", { level })) style = String(level);
    }
    if (ui.style.value !== style) ui.style.value = style;
    ui.styleMenu.querySelectorAll("[data-style]").forEach((button) => {
        button.setAttribute("aria-checked", button.dataset.style === style ? "true" : "false");
    });
    const hex = toHex(editor.getAttributes("textStyle").color);
    ui.colorBar.style.background = hex || "#37352f";
    ui.colorButton.classList.toggle("is-active", !!hex);
    ui.colorMenu.querySelectorAll(".swatch").forEach((swatch) => {
        swatch.classList.toggle("is-active", (swatch.dataset.color || "") === (hex || ""));
    });
}

function formatStamp(value) {
    const when = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(when.getTime())) return "earlier";
    return `${when.getDate()} ${MONTHS[when.getMonth()]} ${when.getFullYear()}, ${clock(when)}`;
}

function isDirty() {
    return ready && !!editor && currentMarkdown() !== baseline;
}

function hasLive() {
    return publishedSha !== null;
}

function statusInfo() {
    if (saveState === "saving") return { text: "saving…", kind: "status-muted" };
    if (saveState === "error") return { text: "couldn't save", kind: "status-dirty" };
    const dirty = isDirty();
    if (!hasLive()) {
        return dirty
            ? { text: "draft · unsaved changes", kind: "status-dirty" }
            : { text: "draft · all changes saved", kind: "status-draft" };
    }
    if (dirty) return { text: "published · unsaved changes", kind: "status-dirty" };
    if (draftSha !== null) return { text: "published · draft saved", kind: "status-dirty" };
    return { text: "published · all changes saved", kind: "status-published" };
}

function paint() {
    if (!ready) return;
    const info = statusInfo();
    ui.status.textContent = info.text;
    ui.status.className = `file-status ${info.kind}`;
    ui.fileName.textContent = displayName();
    document.title = displayName();
    const nothingNew = publishedSnapshot !== null && currentMarkdown() === publishedSnapshot;
    ui.publish.disabled = saving || nothingNew;
    ui.publish.textContent = nothingNew ? "published" : "publish";
    ui.save.disabled = saving;
    ui.menuSave.disabled = saving;
    ui.metaDescription.textContent = description.trim()
        ? `description: ${description.trim()}`
        : "description: auto, from the first sentence";
    ui.metaDate.textContent = `date: ${formatDate(date)}`;
    ui.backup.textContent = `local backup saved ${clock(backupAt)} · last saved to github ${clock(githubAt)}`;
    ui.viewLive.href = `/blog/${slug}.html`;
    ui.viewLive.hidden = !hasLive();
    ui.unpublish.hidden = !hasLive();
    ui.unpublish.disabled = saving;
    ui.deletePost.disabled = saving;
    ui.deleteConfirm.disabled = saving;
    ui.keepMine.disabled = saving;
    ui.loadTheirs.disabled = saving;
    paintToolbar();
    placeFloaters();
    syncChrome();
}

function placeFloaters() {
    if (!editor) return;
    const selection = editor.state.selection;
    const inTable = editor.isActive("table");
    if (!inTable) {
        ui.tableBar.hidden = true;
    } else {
        const dom = editor.view.domAtPos(selection.from).node;
        const element = dom.nodeType === 1 ? dom : dom.parentElement;
        const table = element?.closest("table");
        if (!table) {
            ui.tableBar.hidden = true;
        } else {
            ui.tableBar.hidden = false;
            const rect = table.getBoundingClientRect();
            placeLayer(ui.tableBar, rect, "start", "above");
        }
    }
    const selectedImage = selection.node?.type.name === "image" ? selection : null;
    if (!selectedImage || !ui.altForm.hidden) {
        ui.imageBar.hidden = true;
    } else {
        const dom = editor.view.nodeDOM(selectedImage.from);
        const rect = dom?.getBoundingClientRect?.();
        if (!rect || (!rect.width && !rect.height)) {
            ui.imageBar.hidden = true;
        } else {
            ui.imageBar.hidden = false;
            placeLayer(ui.imageBar, rect, "start", "above");
        }
    }
    const selected = window.getSelection();
    const textSelected = selected && !selected.isCollapsed && selected.rangeCount
        && editor.view.dom.contains(selected.anchorNode)
        && !selection.node
        && !editor.isActive("codeBlock")
        && ui.slash.hidden
        && ui.linkForm.hidden;
    if (!textSelected) {
        ui.bubble.hidden = true;
        return;
    }
    const rect = selected.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) {
        ui.bubble.hidden = true;
        return;
    }
    ui.bubble.hidden = false;
    const frame = visualFrame();
    const width = ui.bubble.offsetWidth;
    const left = Math.max(frame.left + 8, Math.min(rect.left + rect.width / 2 - width / 2, frame.right - width - 8));
    let top = rect.top - ui.bubble.offsetHeight - 8;
    if (top < frame.top + 8) top = rect.bottom + 8;
    if (top + ui.bubble.offsetHeight > frame.bottom - 8) top = Math.max(frame.top + 8, rect.top - ui.bubble.offsetHeight - 8);
    ui.bubble.style.left = `${left}px`;
    ui.bubble.style.top = `${top}px`;
}

function selectionRect() {
    const selected = window.getSelection();
    if (selected && selected.rangeCount && !selected.isCollapsed) return selected.getRangeAt(0).getBoundingClientRect();
    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    return { left: coords.left, right: coords.left, top: coords.top, bottom: coords.bottom, width: 0, height: coords.bottom - coords.top };
}

function openLink(trigger) {
    closePops(false);
    focusReturn = trigger || null;
    ui.bubble.hidden = true;
    const href = editor.getAttributes("link").href || "";
    ui.linkUrl.value = href;
    ui.linkForm.hidden = false;
    openEl = ui.linkForm;
    openAnchor = trigger || null;
    placeLayer(ui.linkForm, selectionRect());
    ui.linkUrl.focus();
    ui.linkUrl.select();
}

function imageFilesFrom(data) {
    const found = [];
    if (!data) return found;
    for (const file of data.files || []) {
        if (file.type.startsWith("image/")) found.push(file);
    }
    if (!found.length && data.items) {
        for (const item of data.items) {
            if (item.kind === "file" && item.type.startsWith("image/")) {
                const file = item.getAsFile();
                if (file) found.push(file);
            }
        }
    }
    return found;
}

function fileDrag(event) {
    const types = event.dataTransfer?.types;
    return !!types && [...types].includes("Files");
}

function setDropping(on) {
    document.querySelector("article.post")?.classList.toggle("is-dropping", on);
}

function imageStamp() {
    const format = (date) => {
        const pad = (value) => String(value).padStart(2, "0");
        return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    };
    const parse = (stamp) => new Date(
        Number(stamp.slice(0, 4)),
        Number(stamp.slice(4, 6)) - 1,
        Number(stamp.slice(6, 8)),
        Number(stamp.slice(8, 10)),
        Number(stamp.slice(10, 12)),
        Number(stamp.slice(12, 14))
    );
    let stamp = format(new Date());
    if (lastImageStamp && stamp <= lastImageStamp) stamp = format(new Date(parse(lastImageStamp).getTime() + 1000));
    lastImageStamp = stamp;
    return stamp;
}

function uploadErrorText(error) {
    if (error instanceof AuthError) return "your github sign-in expired.";
    if (error instanceof RateLimitError) return "github rate limit.";
    if (error instanceof NetworkError) return "network problem.";
    if (error instanceof ConflictError) return "that file name was just taken.";
    return "couldn't upload.";
}

function findNode(type, match) {
    let found = null;
    editor.state.doc.descendants((node, pos) => {
        if (found || node.type.name !== type || !match(node)) return;
        found = { node, pos };
        return false;
    });
    return found;
}

function updateUpload(id, attrs) {
    const found = findNode("imageUpload", (node) => node.attrs.id === id);
    if (!found) return;
    const tr = editor.state.tr.setNodeMarkup(found.pos, null, { ...found.node.attrs, ...attrs });
    tr.setMeta("addToHistory", false);
    editor.view.dispatch(tr);
}

function insertUpload(attrs, at) {
    const content = { type: "imageUpload", attrs };
    const chain = editor.chain().focus();
    if (typeof at === "number") chain.setTextSelection(at);
    else if (editor.state.selection.node) chain.setTextSelection(editor.state.selection.to);
    chain.insertContent(content).run();
}

async function orientedBitmap(file) {
    try {
        return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
        return await createImageBitmap(file);
    }
}

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("couldn't encode the image"));
        }, type, quality);
    });
}

function canvasHasTransparency(context, width, height) {
    const data = context.getImageData(0, 0, width, height).data;
    for (let index = 3; index < data.length; index += 4) {
        if (data[index] < 255) return true;
    }
    return false;
}

async function prepareImage(file) {
    const bitmap = await orientedBitmap(file);
    const origWidth = bitmap.width;
    const origHeight = bitmap.height;
    if (file.type === "image/gif") {
        bitmap.close?.();
        return {
            blob: file,
            ext: "gif",
            width: origWidth,
            height: origHeight,
            origWidth,
            origHeight,
        };
    }
    const scale = Math.min(1, 1600 / Math.max(origWidth, origHeight));
    const width = Math.max(1, Math.round(origWidth * scale));
    const height = Math.max(1, Math.round(origHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const keepPng = file.type === "image/png" && canvasHasTransparency(context, width, height);
    const blob = await canvasToBlob(canvas, keepPng ? "image/png" : "image/jpeg", keepPng ? undefined : 0.85);
    return {
        blob,
        ext: keepPng ? "png" : "jpg",
        width,
        height,
        origWidth,
        origHeight,
    };
}

function stopImageTimer(job) {
    if (job?.timer) window.clearInterval(job.timer);
    if (job) job.timer = 0;
}

function failUpload(id, error) {
    const job = imageJobs.get(id);
    stopImageTimer(job);
    updateUpload(id, { error: uploadErrorText(error), progress: 0 });
}

async function sendImage(id) {
    const job = imageJobs.get(id);
    if (!job?.prepared || !github || job.sending) return;
    job.sending = true;
    updateUpload(id, { error: "", progress: Math.max(job.prepared ? 0.4 : 0.1, 0.4) });
    const stamp = imageStamp();
    const path = `blog/images/${slug}-${stamp}.${job.prepared.ext}`;
    const src = `/${path}`;
    job.path = path;
    job.src = src;
    stopImageTimer(job);
    job.timer = window.setInterval(() => {
        const found = findNode("imageUpload", (node) => node.attrs.id === id);
        if (!found) return;
        updateUpload(id, { progress: Math.min(0.9, (found.node.attrs.progress || 0.4) + 0.05) });
    }, 250);
    try {
        const content = new Uint8Array(await job.prepared.blob.arrayBuffer());
        await github.commitFiles({
            message: `cms: image for ${slug}.md [skip netlify]`,
            changes: [{ path, content }],
            expect: { [path]: null },
        });
        stopImageTimer(job);
        if (job.preview) URL.revokeObjectURL(job.preview);
        job.preview = URL.createObjectURL(job.prepared.blob);
        const found = findNode("imageUpload", (node) => node.attrs.id === id);
        if (!found) {
            URL.revokeObjectURL(job.preview);
            imageJobs.delete(id);
            return;
        }
        const image = editor.schema.nodes.image.create({
            src,
            alt: "",
            preview: job.preview,
            width: job.prepared.width,
            height: job.prepared.height,
        });
        editor.view.dispatch(editor.state.tr.replaceWith(found.pos, found.pos + found.node.nodeSize, image).scrollIntoView());
        editor.commands.setNodeSelection(found.pos);
        imageJobs.delete(id);
        openAltDialog(src);
    } catch (error) {
        failUpload(id, error);
    } finally {
        job.sending = false;
    }
}

async function runUpload(id) {
    const job = imageJobs.get(id);
    if (!job) return;
    try {
        if (!job.prepared) {
            job.prepared = await prepareImage(job.file);
            updateUpload(id, {
                width: job.prepared.width,
                height: job.prepared.height,
                origWidth: job.prepared.origWidth,
                origHeight: job.prepared.origHeight,
                bytes: job.prepared.blob.size,
                progress: 0.4,
                error: "",
            });
        }
        await sendImage(id);
    } catch (error) {
        failUpload(id, error);
    }
}

function beginUpload(file, at) {
    if (!editor || !file || !ready) return;
    const id = `up-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    insertUpload({
        id,
        name: file.name || "image",
        width: 0,
        height: 0,
        origWidth: 0,
        origHeight: 0,
        bytes: file.size,
        progress: 0.08,
        error: "",
    }, at);
    imageJobs.set(id, { file, prepared: null, timer: 0, preview: null });
    runUpload(id);
}

function takeImages(files, at) {
    files.forEach((file, index) => beginUpload(file, index === 0 ? at : null));
}

function retryUpload(id) {
    const job = imageJobs.get(id);
    if (!job) return;
    updateUpload(id, { error: "", progress: 0.2 });
    runUpload(id);
}

function removeUpload(id) {
    const job = imageJobs.get(id);
    stopImageTimer(job);
    if (job?.preview) URL.revokeObjectURL(job.preview);
    imageJobs.delete(id);
    const found = findNode("imageUpload", (node) => node.attrs.id === id);
    if (!found) return;
    editor.view.dispatch(editor.state.tr.delete(found.pos, found.pos + found.node.nodeSize));
}

function openAltDialog(src, anchor = null) {
    const found = findNode("image", (node) => node.attrs.src === src);
    if (!found) return;
    altSrc = src;
    ui.altInput.value = found.node.attrs.alt || "";
    closePops(false);
    focusReturn = anchor;
    ui.altForm.hidden = false;
    openEl = ui.altForm;
    openAnchor = anchor;
    const place = () => {
        const current = findNode("image", (node) => node.attrs.src === src);
        const dom = current ? editor.view.nodeDOM(current.pos) : null;
        const rect = dom?.getBoundingClientRect?.() || { left: 24, bottom: 160, top: 80 };
        const width = ui.altForm.offsetWidth || 360;
        const height = ui.altForm.offsetHeight || 180;
        let top = rect.bottom + 8;
        const frame = visualFrame();
        if (top + height > frame.bottom - 8) top = Math.max(frame.top + 8, rect.top - height - 8);
        ui.altForm.style.top = `${top}px`;
        ui.altForm.style.left = `${Math.max(frame.left + 8, Math.min(rect.left, frame.right - width - 8))}px`;
    };
    place();
    requestAnimationFrame(place);
    ui.altInput.focus();
    ui.imageBar.hidden = true;
}

function applyAlt(event) {
    event.preventDefault();
    const found = findNode("image", (node) => node.attrs.src === altSrc);
    if (found) {
        const alt = ui.altInput.value.replace(/\s+/g, " ").trim();
        editor.view.dispatch(editor.state.tr.setNodeMarkup(found.pos, null, { ...found.node.attrs, alt }));
    }
    closePops();
}

function removeSelectedImage() {
    const selection = editor.state.selection;
    if (selection.node?.type.name !== "image") return;
    const preview = selection.node.attrs.preview;
    if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    editor.chain().focus().deleteSelection().run();
    ui.imageBar.hidden = true;
}

function openImagePicker() {
    closePops();
    closeSlash(false);
    ui.imageFile.value = "";
    ui.imageFile.click();
}

function applyLink(event) {
    event.preventDefault();
    const href = ui.linkUrl.value.trim();
    const chain = editor.chain().focus();
    if (!href) {
        chain.extendMarkRange("link").unsetLink().run();
    } else if (editor.state.selection.empty && !editor.isActive("link")) {
        chain.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    } else {
        chain.extendMarkRange("link").setLink({ href }).run();
    }
    closePops();
}

function setColor(color) {
    const chain = editor.chain().focus();
    if (!color) chain.unsetColor().run();
    else chain.setColor(color).run();
    closePops();
}

function buildMenus() {
    const addSwatch = (color, label) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = color ? "swatch" : "swatch swatch-default";
        button.dataset.color = color;
        button.setAttribute("aria-label", label);
        if (color) button.style.background = color;
        else button.classList.add("swatch-default");
        button.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            setColor(color);
        });
        ui.colorMenu.appendChild(button);
    };
    addSwatch("", "default color");
    for (const color of TEXT_COLORS) addSwatch(color, `color ${color}`);
    for (const type of PANEL_TYPES) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `${type} panel`;
        button.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            editor.chain().focus().insertContent(blockJSON("panel", { type })).run();
            closePops();
        });
        ui.panelMenu.appendChild(button);
    }
}

function keyboardInset() {
    const viewport = window.visualViewport;
    if (!viewport || !phoneEditor()) return 0;
    return Math.max(0, Math.round(window.innerHeight - viewport.offsetTop - viewport.height));
}

function keepCaretVisible() {
    if (!phoneEditor() || !editor || !editor.view.hasFocus()) return;
    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    const frame = visualFrame();
    const toolbar = document.querySelector(".toolbar");
    const topLimit = document.querySelector(".topbar").getBoundingClientRect().bottom + 8;
    const bottomLimit = Math.min(frame.bottom, toolbar.getBoundingClientRect().top) - 12;
    if (coords.bottom > bottomLimit) window.scrollBy(0, coords.bottom - bottomLimit);
    else if (coords.top < topLimit) window.scrollBy(0, coords.top - topLimit);
}

function syncChrome() {
    const topbar = document.querySelector(".topbar");
    const toolbar = document.querySelector(".toolbar");
    if (!topbar || !toolbar) return;
    let y = topbar.offsetHeight;
    document.documentElement.style.setProperty("--topbar-h", `${y}px`);
    for (const bar of [ui.notice, ui.banner]) {
        if (!bar || bar.hidden) continue;
        bar.style.top = `${y}px`;
        y += bar.offsetHeight;
    }
    if (phoneEditor()) {
        const inset = keyboardInset();
        toolbar.style.top = "auto";
        toolbar.style.bottom = `${inset}px`;
        document.documentElement.style.setProperty("--chrome-h", `${y}px`);
        document.documentElement.style.setProperty("--bottom-chrome", `${toolbar.offsetHeight + inset}px`);
        keepCaretVisible();
    } else {
        toolbar.style.top = `${y}px`;
        toolbar.style.bottom = "";
        document.documentElement.style.setProperty("--chrome-h", `${y + toolbar.offsetHeight}px`);
        document.documentElement.style.setProperty("--bottom-chrome", "0px");
    }
}

function hideNotice() {
    ui.notice.replaceChildren();
    ui.notice.hidden = true;
}

function showNotice(fill) {
    ui.notice.replaceChildren();
    fill(ui.notice);
    ui.notice.hidden = false;
    syncChrome();
}

function linkIn(parent, text, onClick) {
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = text;
    link.addEventListener("click", (event) => {
        event.preventDefault();
        onClick();
    });
    parent.appendChild(link);
}

function showSaveError(error, retry) {
    saveState = "error";
    holdError = true;
    if (error instanceof AuthError) {
        clearAuth();
        showNotice((notice) => {
            notice.append("your github sign-in expired. ");
            const link = document.createElement("a");
            link.href = "/admin/";
            link.textContent = "sign in again";
            notice.appendChild(link);
        });
        return;
    }
    if (error instanceof RateLimitError) {
        const when = error.reset ? formatStamp(error.reset) : "later";
        showNotice((notice) => {
            notice.textContent = `github rate limit resets ${when}.`;
        });
        return;
    }
    if (error instanceof NetworkError) {
        showNotice((notice) => {
            notice.append("network problem. ");
            if (retry) linkIn(notice, "try again", retry);
        });
        return;
    }
    showNotice((notice) => {
        notice.textContent = "couldn't save.";
    });
}

function rememberBackup() {
    if (!ready || saving || !isDirty()) return;
    const markdown = currentMarkdown();
    setBackup(slug, markdown);
    backupAt = new Date().toISOString();
    ui.backup.textContent = `local backup saved ${clock(backupAt)} · last saved to github ${clock(githubAt)}`;
}

function showBackupBanner(savedAt) {
    ui.bannerText.textContent = `you have edits from ${formatStamp(savedAt)} on this device that were never saved to github.`;
    ui.banner.hidden = false;
    syncChrome();
}

function applyDocument(markdown) {
    const parsed = splitFrontMatter(markdown);
    ui.title.value = parsed.meta.title || "";
    description = parsed.meta.description || "";
    date = parsed.meta.date || "";
    ui.description.value = description;
    ui.date.value = date;
    editor.commands.setContent(markdownToEditorHtml(parsed.body), { emitUpdate: false, contentType: "html" });
    growTitle();
}

function restoreBackup() {
    const backup = getBackup(slug);
    if (!backup) return;
    applyDocument(backup.markdown);
    backupAt = backup.savedAt;
    ui.banner.hidden = true;
    closePops();
    paint();
}

function discardBackup() {
    clearBackup(slug);
    backupAt = null;
    ui.banner.hidden = true;
    paint();
}

function closeDialogs() {
    ui.deleteDialog.hidden = true;
    ui.conflictDialog.hidden = true;
    const back = focusReturn;
    focusReturn = null;
    restoreFocus(back);
}

function openDialog(dialog, focus, trigger) {
    closeSlash(false);
    closePops(false);
    focusReturn = trigger || null;
    dialog.hidden = false;
    focus.focus();
}

function dialogOpen() {
    return !ui.deleteDialog.hidden || !ui.conflictDialog.hidden;
}

function showToast() {
    const href = `https://ahania.net/blog/${slug}.html`;
    ui.toastLink.href = href;
    ui.toastLink.textContent = `view ahania.net/blog/${slug}.html ↗`;
    ui.toast.hidden = false;
}

async function refreshShas() {
    const [published, draft] = await Promise.all([
        github.getFile(publishedPath),
        github.getFile(draftPath),
    ]);
    publishedSha = published ? published.sha : null;
    draftSha = draft ? draft.sha : null;
    return { published, draft };
}

function messageFor(action) {
    if (action === "save") return `cms: save draft ${slug}.md [skip netlify]`;
    if (action === "publish") return `cms: publish ${slug}.md`;
    if (action === "unpublish") return `cms: unpublish ${slug}.md`;
    return `cms: delete ${slug}.md`;
}

function changesFor(action, markdown) {
    if (action === "save") return [{ path: draftPath, content: markdown }];
    if (action === "publish") {
        const changes = [{ path: publishedPath, content: markdown }];
        if (draftSha) changes.push({ path: draftPath, delete: true });
        return changes;
    }
    if (action === "unpublish") {
        return [
            { path: draftPath, content: markdown },
            { path: publishedPath, delete: true },
        ];
    }
    const changes = [];
    if (publishedSha) changes.push({ path: publishedPath, delete: true });
    if (draftSha) changes.push({ path: draftPath, delete: true });
    return changes;
}

function expectFor(action) {
    if (action === "save") return { [draftPath]: draftSha };
    return { [draftPath]: draftSha, [publishedPath]: publishedSha };
}

function finishWrite(action, markdown) {
    baseline = markdown;
    githubAt = new Date();
    clearBackup(slug);
    backupAt = null;
    ui.banner.hidden = true;
    hideNotice();
    if (action === "publish") {
        publishedSnapshot = markdown;
        publishedText = markdown;
        showToast();
    }
    if (action === "unpublish") {
        publishedSnapshot = null;
        publishedText = null;
    }
    saveState = "";
}

async function commitAction(action, { skipExpect = false, trigger = null } = {}) {
    const returnTo = trigger || (shown(document.activeElement) ? document.activeElement : ui.publish);
    if (!ready || saving) return;
    if (action === "publish" && !skipExpect && publishedSnapshot !== null && currentMarkdown() === publishedSnapshot) return;
    if (action === "unpublish" && !publishedSha) return;
    if (action === "delete" && !publishedSha && !draftSha) {
        clearBackup(slug);
        ready = false;
        location.assign("/admin/");
        return;
    }
    pendingAction = action;
    saving = true;
    saveState = "saving";
    holdError = false;
    hideNotice();
    paint();
    const markdown = currentMarkdown();
    try {
        await github.commitFiles({
            message: messageFor(action),
            changes: changesFor(action, markdown),
            expect: skipExpect ? undefined : expectFor(action),
        });
        if (action === "delete") {
            clearBackup(slug);
            ready = false;
            location.assign("/admin/");
            return;
        }
        if (action === "save") {
            const draft = await github.getFile(draftPath);
            draftSha = draft ? draft.sha : null;
        } else {
            await refreshShas();
        }
        finishWrite(action, markdown);
    } catch (error) {
        if (error instanceof ConflictError) {
            saveState = "";
            ui.conflictTitle.textContent = `${slug}.md changed on github`;
            openDialog(ui.conflictDialog, ui.loadTheirs, returnTo);
        } else {
            showSaveError(error, () => commitAction(pendingAction));
        }
    } finally {
        saving = false;
        paint();
    }
}

async function loadTheirs() {
    if (saving) return;
    const mine = currentMarkdown();
    if (mine !== baseline) {
        setBackup(slug, mine);
        backupAt = new Date().toISOString();
    }
    closeDialogs();
    saving = true;
    saveState = "saving";
    hideNotice();
    paint();
    try {
        const { published, draft } = await refreshShas();
        if (!published && !draft) {
            saveState = "error";
            showNotice((notice) => {
                notice.textContent = "that post isn't on github.";
            });
            return;
        }
        publishedText = published ? published.text : null;
        if (published) {
            const publishedMeta = loadIntoEditor(published);
            publishedSnapshot = composeMarkdown(publishedMeta, editor.getMarkdown());
        } else {
            publishedSnapshot = null;
        }
        const editingMeta = loadIntoEditor(draft || published);
        ui.title.value = editingMeta.title || "";
        description = editingMeta.description || "";
        date = editingMeta.date || "";
        ui.description.value = description;
        ui.date.value = date;
        growTitle();
        baseline = currentMarkdown();
        githubAt = await github.latestCommit(draft ? draftPath : publishedPath);
        saveState = "";
        const backup = getBackup(slug);
        if (backup && backup.markdown !== baseline) showBackupBanner(backup.savedAt);
        else ui.banner.hidden = true;
    } catch (error) {
        if (error instanceof AuthError || error instanceof RateLimitError || error instanceof NetworkError) {
            showSaveError(error, () => loadTheirs());
        } else {
            saveState = "error";
            holdError = true;
            showNotice((notice) => {
                notice.textContent = "couldn't load this post.";
            });
        }
    } finally {
        saving = false;
        paint();
    }
}

async function keepMine() {
    closeDialogs();
    if (saving) return;
    saving = true;
    paint();
    try {
        await refreshShas();
    } catch (error) {
        showSaveError(error, () => keepMine());
        saving = false;
        paint();
        return;
    }
    saving = false;
    await commitAction(pendingAction, { skipExpect: true });
}

function openDetails(anchor) {
    ui.description.value = description;
    ui.date.value = date;
    openPop(ui.details, anchor);
    ui.description.focus();
}

function loadIntoEditor(file) {
    const parsed = splitFrontMatter(file.text);
    editor.commands.setContent(markdownToEditorHtml(parsed.body), { emitUpdate: false, contentType: "html" });
    return parsed.meta;
}

function bind() {
    buildMenus();
    document.querySelectorAll("[data-cmd]").forEach((button) => {
        button.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            run(button.dataset.cmd, button);
        });
    });
    ui.style.addEventListener("change", () => {
        const chain = editor.chain().focus();
        if (ui.style.value === "p") chain.setParagraph().run();
        else chain.setHeading({ level: Number(ui.style.value) }).run();
    });
    ui.colorButton.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        openPop(ui.colorMenu, ui.colorButton);
    });
    ui.bubbleColor.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        openPop(ui.colorMenu, ui.bubbleColor);
    });
    ui.panelButton.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        openPop(ui.panelMenu, ui.panelButton);
    });
    ui.insertButton.addEventListener("click", () => {
        if (slashPinned && !ui.slash.hidden) closeSlash(false, true);
        else openInsertMenu();
    });
    ui.styleButton.addEventListener("click", () => openPop(ui.styleMenu, ui.styleButton));
    ui.styleMenu.querySelectorAll("[data-style]").forEach((button) => {
        button.addEventListener("click", () => {
            const value = button.dataset.style;
            const chain = editor.chain().focus();
            if (value === "p") chain.setParagraph().run();
            else chain.setHeading({ level: Number(value) }).run();
            closePops();
        });
    });
    ui.save.addEventListener("click", () => commitAction("save"));
    ui.menuSave.addEventListener("click", () => {
        closePops(false);
        commitAction("save", { trigger: ui.more });
    });
    ui.publish.addEventListener("click", () => commitAction("publish"));
    ui.more.addEventListener("click", () => openPop(ui.moreMenu, ui.more, "end"));
    ui.menuDetails.addEventListener("click", () => openDetails(ui.editDetails));
    ui.unpublish.addEventListener("click", () => {
        closePops();
        commitAction("unpublish");
    });
    ui.deletePost.addEventListener("click", () => {
        ui.deleteTitle.textContent = `delete ${slug}.md?`;
        openDialog(ui.deleteDialog, ui.deleteCancel, ui.more);
    });
    ui.deleteCancel.addEventListener("click", closeDialogs);
    ui.deleteConfirm.addEventListener("click", () => {
        closeDialogs();
        commitAction("delete");
    });
    ui.loadTheirs.addEventListener("click", () => loadTheirs());
    ui.keepMine.addEventListener("click", () => keepMine());
    $("backup-restore").addEventListener("click", (event) => {
        event.preventDefault();
        restoreBackup();
    });
    $("backup-discard").addEventListener("click", (event) => {
        event.preventDefault();
        discardBackup();
    });
    $("toast-dismiss").addEventListener("click", () => {
        ui.toast.hidden = true;
    });
    ui.indexLink.addEventListener("click", (event) => {
        if (!isDirty()) return;
        if (!window.confirm("you have unsaved changes.")) event.preventDefault();
    });
    ui.editDetails.addEventListener("click", (event) => {
        event.preventDefault();
        openDetails(ui.editDetails);
    });
    ui.description.addEventListener("input", () => {
        description = ui.description.value;
        paint();
    });
    ui.date.addEventListener("input", () => {
        date = ui.date.value;
        paint();
    });
    ui.title.addEventListener("input", () => {
        growTitle();
        paint();
    });
    ui.linkForm.addEventListener("submit", applyLink);
    ui.imageFile.addEventListener("change", () => {
        takeImages([...ui.imageFile.files || []]);
    });
    ui.altForm.addEventListener("submit", applyAlt);
    $("alt-skip").addEventListener("click", () => closePops());
    $("image-alt").addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const selection = editor.state.selection;
        if (selection.node?.type.name === "image") openAltDialog(selection.node.attrs.src, event.currentTarget);
    });
    $("image-remove").addEventListener("pointerdown", (event) => {
        event.preventDefault();
        removeSelectedImage();
    });
    document.addEventListener("image-upload-retry", (event) => retryUpload(event.detail.id));
    document.addEventListener("image-upload-remove", (event) => removeUpload(event.detail.id));
    document.addEventListener("paste", (event) => {
        const files = imageFilesFrom(event.clipboardData);
        if (!files.length || !ready) return;
        event.preventDefault();
        takeImages(files);
    }, true);
    document.addEventListener("dragenter", (event) => {
        if (!fileDrag(event)) return;
        dragDepth += 1;
        setDropping(true);
    });
    document.addEventListener("dragover", (event) => {
        if (!fileDrag(event)) return;
        event.preventDefault();
    }, true);
    document.addEventListener("dragleave", (event) => {
        if (!fileDrag(event)) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (!event.relatedTarget) dragDepth = 0;
        if (dragDepth === 0) setDropping(false);
    });
    document.addEventListener("drop", (event) => {
        if (!fileDrag(event)) return;
        event.preventDefault();
        dragDepth = 0;
        setDropping(false);
        const files = imageFilesFrom(event.dataTransfer);
        if (!files.length || !ready) return;
        const coords = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
        takeImages(files, coords ? coords.pos : null);
    }, true);
    $("link-remove").addEventListener("click", () => {
        editor.chain().focus().extendMarkRange("link").unsetLink().run();
        closePops();
    });
    const tableCommands = {
        "row-above": "addRowBefore",
        "row-below": "addRowAfter",
        "col-left": "addColumnBefore",
        "col-right": "addColumnAfter",
        "del-row": "deleteRow",
        "del-col": "deleteColumn",
        "del-table": "deleteTable",
    };
    for (const [id, name] of Object.entries(tableCommands)) {
        $(id).addEventListener("pointerdown", (event) => {
            event.preventDefault();
            editor.chain().focus()[name]().run();
        });
    }
    editor.on("selectionUpdate", () => {
        updateSlash();
        paintToolbar();
        placeFloaters();
    });
    editor.on("update", () => {
        if (!ready) return;
        if (holdError) {
            holdError = false;
            saveState = "";
            hideNotice();
        }
        updateSlash();
        paint();
    });
    const trapTab = (event, container) => {
        const items = focusables(container);
        event.preventDefault();
        if (!items.length) return;
        const index = items.indexOf(document.activeElement);
        const next = event.shiftKey
            ? items[(index <= 0 ? items.length : index) - 1]
            : items[(index + 1) % items.length];
        next.focus();
    };
    document.addEventListener("keydown", (event) => {
        if (dialogOpen()) {
            const dialog = ui.deleteDialog.hidden ? ui.conflictDialog : ui.deleteDialog;
            if (event.key === "Escape") {
                event.preventDefault();
                closeDialogs();
                return;
            }
            if (event.key === "Enter" || event.key === " ") return;
            if (event.key === "Tab") trapTab(event, dialog);
            else event.preventDefault();
            return;
        }
        const mod = event.metaKey || event.ctrlKey;
        if (mod && event.key.toLowerCase() === "s") {
            event.preventDefault();
            commitAction("save");
            return;
        }
        if (mod && event.key.toLowerCase() === "k" && event.target !== ui.linkUrl) {
            event.preventDefault();
            openLink();
            return;
        }
        if (!ui.slash.hidden) {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                event.stopPropagation();
                moveSlash(1);
            } else if (event.key === "ArrowUp") {
                event.preventDefault();
                event.stopPropagation();
                moveSlash(-1);
            } else if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                if (slashOptions[slashIndex]) insertSlash(slashOptions[slashIndex]);
            } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeSlash(true, true);
            } else if (event.key === "Tab") {
                trapTab(event, ui.slash);
            }
            return;
        }
        if (openEl) {
            if (event.key === "Escape") {
                event.preventDefault();
                closePops();
                return;
            }
            if (event.key === "Tab") trapTab(event, openEl);
            return;
        }
        if (event.key === "Escape") closePops();
    }, true);
    document.addEventListener("pointerdown", (event) => {
        if (!ui.slash.hidden && !ui.slash.contains(event.target) && event.target !== ui.insertButton) {
            closeSlash(true, true);
        }
        if (openEl && !openEl.contains(event.target) && event.target !== openAnchor && !openAnchor?.contains(event.target)) {
            closePops();
        }
    });
    window.addEventListener("scroll", () => {
        updateSlash();
        placeFloaters();
    }, true);
    window.addEventListener("resize", () => {
        updateSlash();
        placeFloaters();
        syncChrome();
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", () => {
            syncChrome();
            placeFloaters();
        });
        window.visualViewport.addEventListener("scroll", () => {
            syncChrome();
            placeFloaters();
        });
    }
    window.matchMedia("(max-width: 600px)").addEventListener("change", syncChrome);
    document.addEventListener("selectionchange", () => {
        if (editor) placeFloaters();
    });
    window.addEventListener("beforeunload", (event) => {
        if (isDirty()) {
            event.preventDefault();
            event.returnValue = "";
        }
    });
    window.setInterval(rememberBackup, 5000);
    const topbar = document.querySelector(".topbar");
    const toolbar = document.querySelector(".toolbar");
    new ResizeObserver(syncChrome).observe(topbar);
    new ResizeObserver(syncChrome).observe(toolbar);
    new ResizeObserver(syncChrome).observe(ui.notice);
    new ResizeObserver(syncChrome).observe(ui.banner);
    syncChrome();
}

async function boot() {
    const auth = getAuth();
    if (!auth) {
        location.replace("/admin/");
        return;
    }
    const requested = new URLSearchParams(location.search).get("path") || "";
    const match = requested.match(/^blog\/(_drafts\/)?([^/]+)\.md$/);
    if (!match || match[2].includes("..")) {
        showNotice((notice) => {
            notice.textContent = "that path isn't a blog post.";
        });
        return;
    }
    slug = match[2];
    draftPath = `blog/_drafts/${slug}.md`;
    publishedPath = `blog/${slug}.md`;
    ui.fileName.textContent = match[1] ? `_drafts/${slug}.md` : `${slug}.md`;
    github = new GitHub(auth);
    editor = createEditor($("editor"));
    bind();
    try {
        const [published, draft] = await Promise.all([
            github.getFile(publishedPath),
            github.getFile(draftPath),
        ]);
        if (!published && !draft) {
            ui.status.textContent = "couldn't save";
            ui.status.className = "file-status status-dirty";
            showNotice((notice) => {
                notice.textContent = "that post isn't on github.";
            });
            return;
        }
        const editing = draft || published;
        publishedSha = published ? published.sha : null;
        draftSha = draft ? draft.sha : null;
        if (published) {
            publishedText = published.text;
            const publishedMeta = loadIntoEditor(published);
            publishedSnapshot = composeMarkdown(publishedMeta, editor.getMarkdown());
        }
        const editingMeta = loadIntoEditor(editing);
        ui.title.value = editingMeta.title || "";
        description = editingMeta.description || "";
        date = editingMeta.date || "";
        ui.description.value = description;
        ui.date.value = date;
        growTitle();
        baseline = currentMarkdown();
        const backup = getBackup(slug);
        backupAt = backup ? backup.savedAt : null;
        githubAt = await github.latestCommit(draft ? draftPath : publishedPath);
        ready = true;
        saveState = "";
        if (backup && backup.markdown !== baseline) showBackupBanner(backup.savedAt);
        paint();
        updateSlash();
    } catch (error) {
        if (error instanceof AuthError) {
            clearAuth();
            location.replace("/admin/");
            return;
        }
        ui.status.textContent = "couldn't save";
        ui.status.className = "file-status status-dirty";
        if (error instanceof RateLimitError) {
            const when = error.reset ? formatStamp(error.reset) : "later";
            showNotice((notice) => {
                notice.textContent = `github rate limit resets ${when}.`;
            });
        } else if (error instanceof NetworkError) {
            showNotice((notice) => {
                notice.textContent = "network problem.";
            });
        } else {
            showNotice((notice) => {
                notice.textContent = "couldn't load this post.";
            });
        }
    }
}

boot();
