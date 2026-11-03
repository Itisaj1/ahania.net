import {
    GitHub,
    AuthError,
    RateLimitError,
    NetworkError,
    ConflictError,
} from "./github.js";
import { getAuth, setAuth, clearAuth } from "./store.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const signIn = document.querySelector("#sign-in");
const listing = document.querySelector("#listing");
const signInForm = document.querySelector("#sign-in-form");
const signInButton = signInForm.querySelector("button.primary");
const signInError = document.querySelector("#sign-in-error");
const tokenInput = document.querySelector("#token");
const ownerInput = document.querySelector("#owner-repo");
const branchInput = document.querySelector("#branch");
const signedInAs = document.querySelector("#signed-in-as");
const signOutButton = document.querySelector("#sign-out");
const newPostLink = document.querySelector("#new-post-link");
const listError = document.querySelector("#list-error");
const draftRows = document.querySelector("#draft-rows");
const publishedRows = document.querySelector("#published-rows");
const newPostDialog = document.querySelector("#new-post");
const newPostForm = document.querySelector("#new-post-form");
const titleInput = document.querySelector("#post-title");
const slugPreview = document.querySelector("#slug-preview");
const newPostError = document.querySelector("#new-post-error");
const createButton = document.querySelector("#create-draft");
const cancelButton = document.querySelector("#cancel-new");

let github = null;
let knownNames = new Set();
let listReady = false;
let loadGeneration = 0;

function slugify(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function stemTitle(filename) {
    return filename.replace(/\.md$/i, "").replace(/[_-]/g, " ");
}

function titleFromMarkdown(text, filename) {
    const stem = stemTitle(filename);
    if (!text.startsWith("---\n")) return stem;
    const end = text.indexOf("\n---", 3);
    if (end === -1) return stem;
    for (const line of text.slice(4, end).split("\n")) {
        if (!line.startsWith("title:")) continue;
        let value = line.slice("title:".length).trim();
        if (value.length >= 2 && (value[0] === "\"" || value[0] === "'") && value[0] === value.at(-1)) {
            value = value.slice(1, -1);
        }
        return value || stem;
    }
    return stem;
}

function formatSize(size) {
    const bytes = Number(size) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCommitDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "-";
    const day = String(date.getDate()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${day}-${MONTHS[date.getMonth()]}-${date.getFullYear()} ${date.getHours()}:${minute}`;
}

function localDate() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
}

function errorText(error, owner, repo) {
    if (error instanceof RateLimitError) {
        const when = error.reset && !Number.isNaN(error.reset.getTime())
            ? error.reset.toLocaleString()
            : "later";
        return `github rate limit reached. try again at ${when}.`;
    }
    if (error instanceof NetworkError) return "could not reach github. check your connection.";
    return `that token can't read ${owner}/${repo}. check it has contents: read & write on this repo.`;
}

function setNewPostEnabled(enabled) {
    listReady = enabled;
    newPostLink.classList.toggle("is-disabled", !enabled);
    newPostLink.tabIndex = enabled ? 0 : -1;
    newPostLink.setAttribute("aria-disabled", enabled ? "false" : "true");
}

function showSignIn() {
    loadGeneration += 1;
    if (newPostDialog.open) newPostDialog.close();
    listing.hidden = true;
    signIn.hidden = false;
    tokenInput.value = "";
}

function markdownFiles(entries) {
    return entries.filter((entry) => (
        entry.type === "file"
        && entry.name.endsWith(".md")
        && entry.name !== "index.html"
    ));
}

function renderRows(container, files) {
    container.replaceChildren();
    const sorted = [...files].sort((a, b) => {
        const byTitle = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
        if (byTitle !== 0) return byTitle;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    for (const file of sorted) {
        const row = document.createElement("div");
        row.className = "file-row";

        const name = document.createElement("div");
        name.className = "file-name";
        const icon = document.createElement("span");
        icon.className = "file-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = "📄";
        const link = document.createElement("a");
        link.href = `edit.html?path=${encodeURIComponent(file.path)}`;
        link.textContent = file.name;
        link.title = file.title;
        name.append(icon, link);

        const status = document.createElement("div");
        status.className = `status ${file.statusClass}`;
        status.textContent = file.statusLabel;

        const size = document.createElement("div");
        size.className = "file-size col-size";
        size.textContent = formatSize(file.size);

        const date = document.createElement("div");
        date.className = "file-date col-date";
        date.textContent = "…";

        row.append(name, status, size, date);
        container.append(row);

        github.latestCommit(file.path).then((iso) => {
            if (!row.isConnected) return;
            date.textContent = iso ? formatCommitDate(iso) : "-";
        }).catch((error) => {
            if (!row.isConnected) return;
            date.textContent = "-";
            if (error instanceof AuthError) dropAuth(error);
        });
    }
}

async function describe(entry, statusLabel, statusClass) {
    let title = stemTitle(entry.name);
    try {
        const file = await github.getFile(entry.path);
        if (file) title = titleFromMarkdown(file.text, entry.name);
    } catch (error) {
        if (error instanceof AuthError || error instanceof RateLimitError) throw error;
    }
    return {
        name: entry.name,
        path: entry.path,
        size: entry.size,
        title,
        statusLabel,
        statusClass,
    };
}

async function loadFiles() {
    const generation = ++loadGeneration;
    setNewPostEnabled(false);
    listError.textContent = "";
    draftRows.replaceChildren();
    publishedRows.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "loading";
    loading.textContent = "loading…";
    draftRows.append(loading);

    try {
        const [blogEntries, draftEntries] = await Promise.all([
            github.listDir("blog"),
            github.listDir("blog/_drafts"),
        ]);
        if (generation !== loadGeneration) return;

        const published = markdownFiles(blogEntries);
        const drafts = markdownFiles(draftEntries);
        const publishedNames = new Set(published.map((entry) => entry.name));
        const draftsByName = new Map(drafts.map((entry) => [entry.name, entry]));
        knownNames = new Set([...published, ...drafts].map((entry) => entry.name.toLowerCase()));

        const draftJobs = drafts
            .filter((entry) => !publishedNames.has(entry.name))
            .map((entry) => describe(entry, "draft", "status-draft"));
        const publishedJobs = published.map((entry) => {
            const draft = draftsByName.get(entry.name);
            if (draft) {
                return describe(draft, "published · unpublished changes", "status-dirty");
            }
            return describe(entry, "published", "status-published");
        });

        const [draftFiles, publishedFiles] = await Promise.all([
            Promise.all(draftJobs),
            Promise.all(publishedJobs),
        ]);
        if (generation !== loadGeneration) return;

        renderRows(draftRows, draftFiles);
        renderRows(publishedRows, publishedFiles);
        setNewPostEnabled(true);
    } catch (error) {
        if (generation !== loadGeneration) return;
        draftRows.replaceChildren();
        if (error instanceof AuthError) {
            dropAuth(error);
            return;
        }
        listError.textContent = errorText(error, github.owner, github.repo);
    }
}

async function showListing(auth) {
    github = new GitHub(auth);
    signIn.hidden = true;
    listing.hidden = false;
    signedInAs.textContent = `signed in to ${auth.owner}/${auth.repo} · ${auth.branch}`;
    await loadFiles();
}

function dropAuth(error) {
    const owner = github ? github.owner : ownerInput.value.split("/")[0];
    const repo = github ? github.repo : "";
    clearAuth();
    github = null;
    showSignIn();
    signInError.textContent = errorText(error, owner, repo);
}

function refreshNewPost() {
    const slug = slugify(titleInput.value);
    slugPreview.textContent = `blog/_drafts/${slug || "…"}.md`;
    if (!slug) {
        newPostError.textContent = "";
        createButton.disabled = true;
        return;
    }
    if (knownNames.has(`${slug}.md`)) {
        newPostError.textContent = `a post called ${slug}.md already exists, pick another title.`;
        createButton.disabled = true;
        return;
    }
    newPostError.textContent = "";
    createButton.disabled = false;
}

function openNewPost(event) {
    event.preventDefault();
    if (!listReady || !github) return;
    titleInput.value = "";
    refreshNewPost();
    newPostDialog.showModal();
    titleInput.focus();
}

async function onCreate(event) {
    event.preventDefault();
    const title = titleInput.value.trim();
    const slug = slugify(titleInput.value);
    if (!slug || knownNames.has(`${slug}.md`) || !github) {
        refreshNewPost();
        return;
    }
    const path = `blog/_drafts/${slug}.md`;
    const content = `---\ntitle: ${title}\ndate: ${localDate()}\n---\n`;
    createButton.disabled = true;
    try {
        await github.commitFiles({
            message: `cms: new draft ${slug}.md [skip netlify]`,
            changes: [{ path, content }],
            expect: { [path]: null },
        });
        window.location.assign(`edit.html?path=${encodeURIComponent(path)}`);
    } catch (error) {
        if (!newPostDialog.open) return;
        createButton.disabled = false;
        if (error instanceof ConflictError) {
            newPostError.textContent = `a post called ${slug}.md already exists, pick another title.`;
            createButton.disabled = true;
            return;
        }
        if (error instanceof AuthError) {
            dropAuth(error);
            return;
        }
        newPostError.textContent = errorText(error, github.owner, github.repo);
    }
}

async function onSignIn(event) {
    event.preventDefault();
    signInError.textContent = "";
    const token = tokenInput.value.trim();
    const ownerRepo = ownerInput.value.trim();
    const branch = branchInput.value.trim();
    const parts = ownerRepo.split("/").map((part) => part.trim()).filter(Boolean);
    if (!token) {
        signInError.textContent = "enter a github token.";
        return;
    }
    if (parts.length !== 2) {
        signInError.textContent = "enter the repo as owner/repo.";
        return;
    }
    if (!branch) {
        signInError.textContent = "enter a branch.";
        return;
    }
    const [owner, repo] = parts;
    const client = new GitHub({ token, owner, repo, branch });
    signInButton.disabled = true;
    try {
        await client.listDir("blog");
        setAuth({ token, owner, repo, branch });
        tokenInput.value = "";
        await showListing({ token, owner, repo, branch });
    } catch (error) {
        signInError.textContent = errorText(error, owner, repo);
    } finally {
        signInButton.disabled = false;
    }
}

function onSignOut() {
    clearAuth();
    github = null;
    signInError.textContent = "";
    showSignIn();
}

signInForm.addEventListener("submit", onSignIn);
signOutButton.addEventListener("click", onSignOut);
newPostLink.addEventListener("click", openNewPost);
newPostForm.addEventListener("submit", onCreate);
titleInput.addEventListener("input", refreshNewPost);
cancelButton.addEventListener("click", () => newPostDialog.close());
newPostDialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && newPostDialog.open) newPostDialog.close();
});
newPostDialog.addEventListener("close", () => {
    if (!listing.hidden) newPostLink.focus();
});

const saved = getAuth();
if (saved) showListing(saved);
