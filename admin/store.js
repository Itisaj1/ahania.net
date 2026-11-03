const AUTH_KEY = "cms.auth";

function backupKey(path) {
    return `cms.backup:${path}`;
}

export function getAuth() {
    try {
        const raw = localStorage.getItem(AUTH_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || typeof data !== "object") return null;
        const { token, owner, repo, branch } = data;
        if (![token, owner, repo, branch].every((value) => typeof value === "string" && value)) {
            return null;
        }
        return { token, owner, repo, branch };
    } catch {
        return null;
    }
}

export function setAuth(auth) {
    try {
        localStorage.setItem(AUTH_KEY, JSON.stringify({
            token: auth.token,
            owner: auth.owner,
            repo: auth.repo,
            branch: auth.branch,
        }));
    } catch {
        /* storage unavailable */
    }
}

export function clearAuth() {
    try {
        localStorage.removeItem(AUTH_KEY);
    } catch {
        /* storage unavailable */
    }
}

export function getBackup(path) {
    try {
        const raw = localStorage.getItem(backupKey(path));
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || typeof data.markdown !== "string") return null;
        return { markdown: data.markdown, savedAt: data.savedAt || null };
    } catch {
        return null;
    }
}

export function setBackup(path, markdown) {
    try {
        localStorage.setItem(backupKey(path), JSON.stringify({
            markdown,
            savedAt: new Date().toISOString(),
        }));
    } catch {
        /* storage unavailable */
    }
}

export function clearBackup(path) {
    try {
        localStorage.removeItem(backupKey(path));
    } catch {
        /* storage unavailable */
    }
}
