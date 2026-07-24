import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function readLocalWorkspaceList(env) {
    const registryPath = resolveWorkspaceRegistryPath(env);
    if (!registryPath || !fs.existsSync(registryPath)) {
        return null;
    }
    try {
        const registry = normalizeWorkspaceRegistry(JSON.parse(fs.readFileSync(registryPath, 'utf8')));
        const items = Object.values(registry.workspaces)
            .map((workspace) => ({
            id: workspace.id,
            lastOpenedAt: workspace.lastOpenedAt,
            latestError: workspace.latestError ?? null,
            name: workspace.name,
            open: workspace.open || workspace.id === registry.lastOpenedWorkspaceId,
            path: workspace.path,
            source: 'local',
        }))
            .sort((left, right) => (right.lastOpenedAt ?? '').localeCompare(left.lastOpenedAt ?? ''));
        return { items };
    }
    catch {
        return null;
    }
}
export function isLocalApiUrl(rawApiUrl) {
    try {
        const hostname = new URL(rawApiUrl).hostname.toLowerCase();
        return (hostname === 'localhost' ||
            hostname === '0.0.0.0' ||
            hostname === '127.0.0.1' ||
            hostname === '[::1]' ||
            hostname === '::1');
    }
    catch {
        return false;
    }
}
export function inferLastOpenWorkspace(items) {
    const openWorkspaces = items.filter((workspace) => workspace.open);
    if (openWorkspaces.length === 1) {
        return openWorkspaces[0];
    }
    return undefined;
}
function resolveWorkspaceRegistryPath(env) {
    if (env.VALEDICTORIAN_WORKSPACE_REGISTRY_PATH) {
        return env.VALEDICTORIAN_WORKSPACE_REGISTRY_PATH;
    }
    const home = os.homedir();
    if (!home) {
        return undefined;
    }
    if (process.platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Valedictorian', 'workspaces.json');
    }
    if (process.platform === 'win32') {
        return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Valedictorian', 'workspaces.json');
    }
    return path.join(env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), 'valedictorian', 'workspaces.json');
}
function normalizeWorkspaceRegistry(value) {
    if (!value || typeof value !== 'object') {
        return { lastOpenedWorkspaceId: null, workspaces: {} };
    }
    const candidate = value;
    const candidateWorkspaces = candidate.workspaces && typeof candidate.workspaces === 'object'
        ? candidate.workspaces
        : {};
    const workspaces = Object.fromEntries(Object.entries(candidateWorkspaces)
        .map(([workspaceId, workspace]) => [workspaceId, normalizeWorkspaceRecord(workspace)])
        .filter((entry) => entry[1] !== null));
    const lastOpenedWorkspaceId = typeof candidate.lastOpenedWorkspaceId === 'string' &&
        candidate.lastOpenedWorkspaceId in workspaces
        ? candidate.lastOpenedWorkspaceId
        : null;
    return { lastOpenedWorkspaceId, workspaces };
}
function normalizeWorkspaceRecord(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const candidate = value;
    if (typeof candidate.id !== 'string' ||
        typeof candidate.name !== 'string' ||
        typeof candidate.path !== 'string' ||
        typeof candidate.lastOpenedAt !== 'string') {
        return null;
    }
    return {
        id: candidate.id,
        lastOpenedAt: candidate.lastOpenedAt,
        latestError: normalizeLatestError(candidate.latestError),
        name: candidate.name,
        open: candidate.open === true,
        path: candidate.path,
    };
}
function normalizeLatestError(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const candidate = value;
    if (typeof candidate.at !== 'string' || typeof candidate.message !== 'string') {
        return null;
    }
    return {
        at: candidate.at,
        message: candidate.message,
    };
}
