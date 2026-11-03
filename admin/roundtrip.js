import { createEditor, splitFrontMatter, markdownToEditorHtml, composeMarkdown } from "./markdown.js";

const editor = createEditor(document.getElementById("roundtrip-editor"));
const summary = document.getElementById("summary");
const results = document.getElementById("results");

const SAMPLES = [
    {
        name: "sample: panels, marks, tasks, table, html",
        markdown: [
            ":::info",
            "a note",
            ":::",
            "",
            ":::expand More detail",
            "inside",
            ":::",
            "",
            "this is <u>under</u> and <span style=\"color:#a8321f\">red</span>.",
            "",
            "- [ ] todo",
            "- [x] done",
            "",
            "| a | b |",
            "| --- | --- |",
            "| 1 | 2 |",
            "",
            "![a cat](/blog/images/cat.jpg)",
            "",
            "<div>",
            "<iframe src=\"https://example.com/?a=1&b=2\"></iframe>",
            "</div>",
            "",
        ].join("\n"),
    },
];

function normalize(markdown) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
    const out = [];
    let para = [];
    let fence = false;
    let front = false;
    const flush = () => {
        if (!para.length) return;
        out.push(para.join(" ").replace(/[ \t]+/g, " ").trim());
        para = [];
    };
    for (const line of lines) {
        const trimmed = line.trim();
        if (fence) {
            out.push(line.replace(/[ \t]+$/g, ""));
            if (trimmed.startsWith("```")) fence = false;
            continue;
        }
        if (!front && trimmed.startsWith("```")) {
            flush();
            fence = true;
            out.push(trimmed);
            continue;
        }
        if (trimmed === "---") {
            flush();
            if (out.length === 0 || front) front = !front;
            out.push("---");
            continue;
        }
        if (front) {
            out.push(trimmed);
            continue;
        }
        if (!trimmed) {
            flush();
            continue;
        }
        const structural = /^(#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s)/.test(trimmed)
            || trimmed.startsWith(":::")
            || trimmed.startsWith("|")
            || /^<\/?[A-Za-z!]/.test(trimmed);
        if (structural) {
            flush();
            out.push(trimmed.startsWith("<") || trimmed.startsWith(":::") ? trimmed : trimmed.replace(/[ \t]+/g, " "));
            continue;
        }
        para.push(trimmed);
    }
    flush();
    return out.join("\n");
}

function sameText(left, right) {
    const tidy = (value) => value.replace(/\r\n/g, "\n").replace(/\n+$/, "\n");
    return tidy(left) === tidy(right);
}

function lineDiff(before, after) {
    const left = before.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
    const right = after.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
    const scores = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
    for (let row = left.length - 1; row >= 0; row -= 1) {
        for (let column = right.length - 1; column >= 0; column -= 1) {
            scores[row][column] = left[row] === right[column]
                ? scores[row + 1][column + 1] + 1
                : Math.max(scores[row + 1][column], scores[row][column + 1]);
        }
    }
    const diff = [];
    let row = 0;
    let column = 0;
    while (row < left.length && column < right.length) {
        if (left[row] === right[column]) {
            diff.push([" ", left[row]]);
            row += 1;
            column += 1;
        } else if (scores[row + 1][column] >= scores[row][column + 1]) {
            diff.push(["-", left[row]]);
            row += 1;
        } else {
            diff.push(["+", right[column]]);
            column += 1;
        }
    }
    while (row < left.length) diff.push(["-", left[row++]]);
    while (column < right.length) diff.push(["+", right[column++]]);
    return diff;
}

function hunks(diff) {
    if (!diff.some(([kind]) => kind !== " ")) return [];
    const keep = new Set();
    diff.forEach((row, index) => {
        if (row[0] === " ") return;
        for (let cursor = Math.max(0, index - 2); cursor <= Math.min(diff.length - 1, index + 2); cursor += 1) {
            keep.add(cursor);
        }
    });
    const shown = [];
    let previous = -1;
    for (const index of [...keep].sort((a, b) => a - b)) {
        if (previous !== -1 && index > previous + 1) shown.push(["…", ""]);
        shown.push(diff[index]);
        previous = index;
    }
    return shown;
}

function convert(markdown) {
    const parsed = splitFrontMatter(markdown);
    editor.commands.setContent(markdownToEditorHtml(parsed.body), { emitUpdate: false, contentType: "html" });
    return composeMarkdown(parsed.meta, editor.getMarkdown());
}

function renderResult(name, before, after, error) {
    const exact = !error && sameText(before, after);
    const passed = !error && (exact || normalize(before) === normalize(after));
    const article = document.createElement("article");
    article.className = passed ? "pass" : "fail";
    const heading = document.createElement("h2");
    const badge = document.createElement("span");
    badge.textContent = error ? "error" : exact ? "exact" : passed ? "whitespace" : "fail";
    heading.append(document.createTextNode(name), badge);
    article.appendChild(heading);
    if (error) {
        const pre = document.createElement("pre");
        pre.textContent = error;
        article.appendChild(pre);
    } else if (!exact) {
        const pre = document.createElement("pre");
        for (const [kind, text] of hunks(lineDiff(before, after))) {
            const line = document.createElement("div");
            line.className = kind === "-" ? "del" : kind === "+" ? "add" : "same";
            line.textContent = `${kind} ${text}`;
            pre.appendChild(line);
        }
        article.appendChild(pre);
    }
    results.appendChild(article);
    return passed;
}

async function files() {
    const [posts, items] = await Promise.all([
        fetch("/blog/posts.json").then((response) => response.json()),
        fetch("/portfolio/items.json").then((response) => response.json()),
    ]);
    return [
        ...posts.map((item) => `blog/${item.filename}`),
        ...items.map((item) => `portfolio/${item.filename}`),
    ];
}

async function main() {
    const paths = await files();
    let passed = 0;
    let failed = 0;
    const tally = () => {
        summary.textContent = `${passed} passed · ${failed} failed · ${passed + failed} checked`;
    };
    tally();
    for (const path of paths) {
        const response = await fetch(`/${path}`);
        const markdown = await response.text();
        let ok = false;
        try {
            ok = renderResult(path, markdown, convert(markdown));
        } catch (error) {
            ok = renderResult(path, markdown, "", error.stack || error.message);
        }
        if (ok) passed += 1;
        else failed += 1;
        tally();
    }
    for (const sample of SAMPLES) {
        let ok = false;
        try {
            const after = convert(sample.markdown);
            ok = renderResult(sample.name, sample.markdown, after);
            if (!after.includes("a=1&b=2")) {
                ok = false;
                const note = document.createElement("p");
                note.textContent = "html block lost the raw &.";
                results.lastElementChild.appendChild(note);
                results.lastElementChild.className = "fail";
            }
        } catch (error) {
            ok = renderResult(sample.name, sample.markdown, "", error.stack || error.message);
        }
        if (ok) passed += 1;
        else failed += 1;
        tally();
    }
    summary.className = failed ? "fail" : "pass";
}

main().catch((error) => {
    summary.textContent = error.stack || error.message;
    summary.className = "fail";
});
