export class AuthError extends Error {
    constructor(message = "unauthorized") {
        super(message);
        this.name = "AuthError";
    }
}

export class RateLimitError extends Error {
    constructor(message, reset) {
        super(message);
        this.name = "RateLimitError";
        this.reset = reset;
    }
}

export class NetworkError extends Error {
    constructor(message = "network failure") {
        super(message);
        this.name = "NetworkError";
    }
}

export class ConflictError extends Error {
    constructor(path) {
        super(path ? `conflict at ${path}` : "conflict");
        this.name = "ConflictError";
        this.path = path;
    }
}

function encodeGitPath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
}

function decodeBase64Utf8(content) {
    const binary = atob(String(content).replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
}

function toBase64(content) {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    let binary = "";
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
}

function redactSecrets(text) {
    return String(text || "")
        .replace(/github_pat_[A-Za-z0-9_]+/g, "[token]")
        .replace(/\bgh[pousr]_[A-Za-z0-9_]+/g, "[token]")
        .replace(/Bearer\s+\S+/gi, "Bearer [token]");
}

function messageFrom(raw) {
    try {
        const body = JSON.parse(raw);
        if (body && typeof body.message === "string" && body.message) return redactSecrets(body.message);
    } catch {
        /* response was not JSON */
    }
    const text = redactSecrets(String(raw || "")).trim();
    return text ? text.slice(0, 200) : "github error";
}

async function failure(response) {
    const raw = await response.text().catch(() => "");
    const error = new Error(messageFrom(raw) || `github error ${response.status}`);
    error.status = response.status;
    throw error;
}

export class GitHub {
    constructor({ token, owner, repo, branch }) {
        this.token = token;
        this.owner = owner;
        this.repo = repo;
        this.branch = branch;
        this.base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    }

    async request(urlPath, options = {}) {
        const headers = {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            ...(options.headers || {}),
            Authorization: `Bearer ${this.token}`,
        };
        let response;
        try {
            response = await fetch(`https://api.github.com${urlPath}`, {
                method: options.method || "GET",
                headers,
                body: options.body,
                cache: "no-store",
            });
        } catch {
            throw new NetworkError("network failure");
        }
        if (response.status === 401) throw new AuthError("unauthorized");
        if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
            const seconds = Number(response.headers.get("x-ratelimit-reset"));
            const reset = Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
            const when = reset ? reset.toISOString() : "later";
            throw new RateLimitError(`rate limit exceeded; resets ${when}`, reset);
        }
        return response;
    }

    async getFile(path) {
        const response = await this.request(
            `${this.base}/contents/${encodeGitPath(path)}?ref=${encodeURIComponent(this.branch)}`
        );
        if (response.status === 404) return null;
        if (!response.ok) throw await failure(response);
        const data = await response.json();
        if (Array.isArray(data) || data.type !== "file" || typeof data.content !== "string") {
            throw new Error("not a file");
        }
        return { text: decodeBase64Utf8(data.content), sha: data.sha };
    }

    async listDir(path) {
        const response = await this.request(
            `${this.base}/contents/${encodeGitPath(path)}?ref=${encodeURIComponent(this.branch)}`
        );
        if (response.status === 404) return [];
        if (!response.ok) throw await failure(response);
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error("not a directory");
        return data;
    }

    async headCommit() {
        const ref = await this.request(
            `${this.base}/git/ref/heads/${encodeURIComponent(this.branch)}`
        );
        if (!ref.ok) throw await failure(ref);
        const refData = await ref.json();
        const commitSha = refData.object.sha;
        const commit = await this.request(`${this.base}/git/commits/${commitSha}`);
        if (!commit.ok) throw await failure(commit);
        const commitData = await commit.json();
        return { commitSha, treeSha: commitData.tree.sha };
    }

    async latestCommit(path) {
        const params = new URLSearchParams({
            path,
            per_page: "1",
            sha: this.branch,
        });
        const response = await this.request(`${this.base}/commits?${params}`);
        if (response.status === 404 || response.status === 409) return null;
        if (!response.ok) throw await failure(response);
        const data = await response.json();
        return data[0]?.commit?.committer?.date || null;
    }

    async #blobShas(treeSha, paths) {
        const response = await this.request(`${this.base}/git/trees/${treeSha}?recursive=1`);
        if (!response.ok) throw await failure(response);
        const data = await response.json();
        const map = new Map(paths.map((path) => [path, null]));
        if (!data.truncated) {
            const wanted = new Set(paths);
            for (const item of data.tree || []) {
                if (wanted.has(item.path) && item.type === "blob") map.set(item.path, item.sha);
            }
            return map;
        }
        for (const path of paths) {
            const file = await this.getFile(path);
            map.set(path, file ? file.sha : null);
        }
        return map;
    }

    async commitFiles({ message, changes, expect }) {
        const { commitSha, treeSha } = await this.headCommit();
        const expectations = expect || {};
        const paths = Object.keys(expectations);
        if (paths.length) {
            const found = await this.#blobShas(treeSha, paths);
            for (const path of paths) {
                if (found.get(path) !== expectations[path]) throw new ConflictError(path);
            }
        }

        const tree = [];
        for (const change of changes) {
            if (change.delete) {
                tree.push({ path: change.path, mode: "100644", type: "blob", sha: null });
                continue;
            }
            const blob = await this.request(`${this.base}/git/blobs`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: toBase64(change.content), encoding: "base64" }),
            });
            if (!blob.ok) throw await failure(blob);
            const blobData = await blob.json();
            tree.push({
                path: change.path,
                mode: "100644",
                type: "blob",
                sha: blobData.sha,
            });
        }

        const treeResponse = await this.request(`${this.base}/git/trees`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ base_tree: treeSha, tree }),
        });
        if (!treeResponse.ok) throw await failure(treeResponse);
        const treeData = await treeResponse.json();

        const commitResponse = await this.request(`${this.base}/git/commits`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message,
                tree: treeData.sha,
                parents: [commitSha],
            }),
        });
        if (!commitResponse.ok) throw await failure(commitResponse);
        const commitData = await commitResponse.json();

        const refResponse = await this.request(
            `${this.base}/git/refs/heads/${encodeURIComponent(this.branch)}`,
            {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sha: commitData.sha, force: false }),
            }
        );
        if (refResponse.status === 422) {
            const raw = await refResponse.text();
            if (raw.toLowerCase().includes("fast forward")) {
                throw new ConflictError(paths[0] || changes[0]?.path || "");
            }
            throw new Error(messageFrom(raw));
        }
        if (!refResponse.ok) throw await failure(refResponse);
        return { commitSha: commitData.sha };
    }
}
