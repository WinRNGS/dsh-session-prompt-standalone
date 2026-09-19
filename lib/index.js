import { joinContextSections, renderContextSections, renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, unwatchFile, watchFile, writeFileSync, } from 'node:fs';
import { DEFAULT_PROMPT } from './default-prompt.js';
export const name = 'dsh-session-prompt';
export const inject = ['systemPrompt', 'tools', 'agents'];
const GLOBAL_SYSTEM_NAME = 'session-prompt:persistent';
const GLOBAL_CONTEXT_NAME = 'session-prompt:global-context';
const WORKSPACE_SYSTEM_NAME = 'session-prompt:workspace';
const WORKSPACE_CONTEXT_NAME = 'session-prompt:workspace-context';
const MAX_PROMPT_BYTES = 256 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_SETTINGS_BYTES = 4 * 1024 * 1024;
const MAX_WORKSPACES = 512;
const MIN_ORDER = -1000;
const MAX_ORDER = 1000;
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const SETTINGS_FILE = join(DSH_HOME, 'dsh-session-prompt.json');
const SETTINGS_LOCK_FILE = `${SETTINGS_FILE}.lock`;
class PromptInputError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
class UnsupportedSettingsError extends Error {
}
function validatePrompt(value, enabled = true) {
    if (typeof value !== 'string')
        throw new PromptInputError(400, 'prompt must be a string');
    const prompt = value.trim();
    if (enabled && !prompt)
        throw new PromptInputError(400, 'enabled prompt cannot be empty');
    const bytes = Buffer.byteLength(prompt, 'utf8');
    if (bytes > MAX_PROMPT_BYTES)
        throw new PromptInputError(413, `prompt is too large (${bytes} bytes; limit ${MAX_PROMPT_BYTES})`);
    const open = prompt.indexOf('{{');
    if (open !== -1 && prompt.indexOf('}}', open + 2) !== -1) {
        throw new PromptInputError(400, 'DSH reserves {{...}} for prompt variables; literal double-brace templates are not supported');
    }
    return prompt;
}
function validateLayer(value, fallbackOrder) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new PromptInputError(400, 'layer must be an object');
    const input = value;
    const enabled = input.enabled === undefined ? true : input.enabled;
    if (typeof enabled !== 'boolean')
        throw new PromptInputError(400, 'enabled must be a boolean');
    const role = input.role ?? 'system';
    if (role !== 'system' && role !== 'user-context')
        throw new PromptInputError(400, 'role must be "system" or "user-context"');
    const order = input.order ?? fallbackOrder;
    if (typeof order !== 'number' || !Number.isInteger(order) || order < MIN_ORDER || order > MAX_ORDER) {
        throw new PromptInputError(400, `order must be an integer from ${MIN_ORDER} to ${MAX_ORDER}`);
    }
    return { enabled, role, order, prompt: validatePrompt(input.prompt ?? '', enabled) };
}
function defaultSettings(fallbackPrompt) {
    return { version: 2, global: { enabled: true, prompt: fallbackPrompt, role: 'system', order: 10 }, workspaces: {} };
}
function workspaceKey(path) {
    const canonical = normalize(resolve(path));
    return process.platform === 'win32' ? canonical.toLocaleLowerCase('en-US') : canonical;
}
/**
 * Keep a broken layer recoverable without ever activating unvalidated text.
 * The UI can still show/copy the original prompt, while valid sibling layers
 * continue to load normally.
 */
function recoverDisabledLayer(value, fallbackOrder) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    const input = value;
    if (typeof input.prompt !== 'string')
        return undefined;
    const role = input.role === 'user-context' ? 'user-context' : 'system';
    const order = typeof input.order === 'number'
        && Number.isInteger(input.order)
        && input.order >= MIN_ORDER
        && input.order <= MAX_ORDER
        ? input.order
        : fallbackOrder;
    return { enabled: false, prompt: input.prompt, role, order };
}
function parseStoredSettings(value, fallbackPrompt, warn) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new Error('settings root must be an object');
    const input = value;
    // v0.2 legacy files had no version and only one prompt field.
    if (typeof input.prompt === 'string') {
        const migrated = defaultSettings(fallbackPrompt);
        try {
            migrated.global.prompt = validatePrompt(input.prompt);
        }
        catch (error) {
            migrated.global = { enabled: false, prompt: input.prompt, role: 'system', order: 10 };
            warn(`legacy global prompt was preserved but disabled: ${error instanceof Error ? error.message : String(error)}`);
        }
        return migrated;
    }
    if (input.version !== 2) {
        throw new UnsupportedSettingsError(`unsupported settings version ${JSON.stringify(input.version)}; this plugin only writes version 2`);
    }
    const settings = defaultSettings(fallbackPrompt);
    try {
        settings.global = validateLayer(input.global, 10);
    }
    catch (error) {
        const recovered = recoverDisabledLayer(input.global, 10);
        if (recovered !== undefined)
            settings.global = recovered;
        warn(`invalid global layer ${recovered === undefined ? 'was replaced with the default' : 'was preserved but disabled'}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (input.workspaces !== undefined) {
        if (input.workspaces === null || typeof input.workspaces !== 'object' || Array.isArray(input.workspaces)) {
            warn('invalid workspaces map was ignored');
            return settings;
        }
        const workspaceEntries = Object.entries(input.workspaces);
        if (workspaceEntries.length > MAX_WORKSPACES) {
            throw new UnsupportedSettingsError(`settings contain ${workspaceEntries.length} workspaces; limit is ${MAX_WORKSPACES}`);
        }
        for (const [storedKey, raw] of workspaceEntries) {
            if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
                warn(`invalid workspace layer ${JSON.stringify(storedKey)} was ignored`);
                continue;
            }
            const path = raw.path;
            if (typeof path !== 'string' || !path.trim() || !isAbsolute(path)) {
                warn(`workspace layer ${JSON.stringify(storedKey)} has no valid absolute path and was ignored`);
                continue;
            }
            const resolvedPath = resolve(path);
            const key = workspaceKey(resolvedPath);
            try {
                settings.workspaces[key] = { ...validateLayer(raw, 20), path: resolvedPath };
            }
            catch (error) {
                const recovered = recoverDisabledLayer(raw, 20);
                if (recovered !== undefined)
                    settings.workspaces[key] = { ...recovered, path: resolvedPath };
                warn(`invalid workspace layer ${JSON.stringify(resolvedPath)} ${recovered === undefined ? 'was ignored' : 'was preserved but disabled'}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    return settings;
}
function revisionOf(content) {
    return createHash('sha256').update(content).digest('hex');
}
function readDiskSettings(fallbackPrompt, warn) {
    try {
        const stats = statSync(SETTINGS_FILE);
        if (stats.size > MAX_SETTINGS_BYTES) {
            return {
                kind: 'blocked',
                revision: `oversized-${stats.size}-${Math.trunc(stats.mtimeMs)}`,
                reason: `settings file is ${stats.size} bytes; limit is ${MAX_SETTINGS_BYTES}`,
            };
        }
        const content = readFileSync(SETTINGS_FILE);
        const revision = revisionOf(content);
        try {
            return {
                kind: 'valid',
                revision,
                settings: parseStoredSettings(JSON.parse(content.toString('utf8')), fallbackPrompt, warn),
            };
        }
        catch (error) {
            if (error instanceof UnsupportedSettingsError) {
                return { kind: 'blocked', revision, reason: error.message };
            }
            return { kind: 'invalid', revision, reason: error instanceof Error ? error.message : String(error) };
        }
    }
    catch (error) {
        if (error?.code === 'ENOENT') {
            return { kind: 'missing', revision: 'missing', settings: defaultSettings(fallbackPrompt) };
        }
        return { kind: 'blocked', revision: 'unreadable', reason: error instanceof Error ? error.message : String(error) };
    }
}
function serializeSettings(settings) {
    const workspaceCount = Object.keys(settings.workspaces).length;
    if (workspaceCount > MAX_WORKSPACES) {
        throw new PromptInputError(413, `settings contain ${workspaceCount} workspaces; limit is ${MAX_WORKSPACES}`);
    }
    const text = JSON.stringify(settings, null, 2) + '\n';
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > MAX_SETTINGS_BYTES) {
        throw new PromptInputError(413, `settings would be ${bytes} bytes; limit is ${MAX_SETTINGS_BYTES}`);
    }
    return { text, revision: revisionOf(text) };
}
function saveSettings(settings) {
    mkdirSync(DSH_HOME, { recursive: true, mode: 0o700 });
    const temporary = `${SETTINGS_FILE}.${process.pid}.${Date.now()}.tmp`;
    const serialized = serializeSettings(settings);
    try {
        writeFileSync(temporary, serialized.text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        renameSync(temporary, SETTINGS_FILE);
    }
    finally {
        rmSync(temporary, { force: true });
    }
    return serialized.revision;
}
function wait(milliseconds) {
    return new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
}
async function withSettingsLock(action) {
    mkdirSync(DSH_HOME, { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 40; attempt += 1) {
        let descriptor;
        try {
            descriptor = openSync(SETTINGS_LOCK_FILE, 'wx', 0o600);
            writeFileSync(descriptor, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
            try {
                return await action();
            }
            finally {
                closeSync(descriptor);
                descriptor = undefined;
                rmSync(SETTINGS_LOCK_FILE, { force: true });
            }
        }
        catch (error) {
            if (descriptor !== undefined) {
                closeSync(descriptor);
                rmSync(SETTINGS_LOCK_FILE, { force: true });
            }
            if (error?.code !== 'EEXIST')
                throw error;
            try {
                if (Date.now() - statSync(SETTINGS_LOCK_FILE).mtimeMs > 60_000) {
                    rmSync(SETTINGS_LOCK_FILE, { force: true });
                    continue;
                }
            }
            catch { /* the other process released it between checks */ }
            await wait(50);
        }
    }
    throw new PromptInputError(503, 'settings are busy in another DSH process; retry shortly');
}
function promptStats(prompt) {
    const utf8Bytes = Buffer.byteLength(prompt, 'utf8');
    return { chars: [...prompt].length, utf8Bytes, estimatedTokens: prompt ? Math.max(1, Math.ceil(utf8Bytes / 4)) : 0 };
}
function readBody(req) {
    return new Promise((resolveBody, reject) => {
        const chunks = [];
        let bytes = 0;
        let tooLarge = false;
        req.on('data', (value) => {
            const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
            bytes += chunk.length;
            if (bytes > MAX_REQUEST_BYTES)
                tooLarge = true;
            else
                chunks.push(chunk);
        });
        req.on('end', () => tooLarge
            ? reject(new PromptInputError(413, `request body exceeds ${MAX_REQUEST_BYTES} bytes`))
            : resolveBody(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}
function combineDisposers(disposers) {
    return () => { for (const dispose of [...disposers].reverse())
        dispose(); };
}
function classifySource(sectionName) {
    if (sectionName === GLOBAL_SYSTEM_NAME || sectionName === GLOBAL_CONTEXT_NAME)
        return '本插件 · 全局';
    if (sectionName === WORKSPACE_SYSTEM_NAME || sectionName === WORKSPACE_CONTEXT_NAME)
        return '本插件 · 工作区';
    if (sectionName === 'harness:identity')
        return 'DSH · Harness Identity';
    if (sectionName === 'deployment:persona')
        return 'DSH · Agent Preset / Persona';
    return `DSH / 其他插件 · ${sectionName}`;
}
function etag(revision) {
    return `"${revision.replace(/["\\]/g, '')}"`;
}
function expectedRevision(req) {
    const value = String(req.headers?.['if-match'] ?? '').trim();
    if (!value)
        throw new PromptInputError(428, 'If-Match revision is required; reload settings before saving');
    const normalized = value.startsWith('W/') ? value.slice(2).trim() : value;
    if (normalized === '*')
        throw new PromptInputError(400, 'wildcard If-Match is not supported');
    return normalized.startsWith('"') && normalized.endsWith('"')
        ? normalized.slice(1, -1)
        : normalized;
}
export function apply(ctx, config = {}) {
    let fallbackPrompt = DEFAULT_PROMPT.trim();
    if (config.prompt?.trim()) {
        try {
            fallbackPrompt = validatePrompt(config.prompt);
        }
        catch (error) {
            ctx.logger.warn(`dsh-session-prompt: ignoring invalid config.prompt: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    const warn = (message) => ctx.logger.warn(`dsh-session-prompt: ${message}`);
    const initialDisk = readDiskSettings(fallbackPrompt, warn);
    let current = initialDisk.settings ?? defaultSettings(fallbackPrompt);
    let currentRevision = initialDisk.revision;
    let unreadableSettingsFile = initialDisk.kind === 'invalid';
    let writeBlockedReason = initialDisk.kind === 'blocked' ? initialDisk.reason ?? 'settings are read-only' : undefined;
    if (initialDisk.kind === 'invalid')
        warn(`settings JSON is invalid; keeping defaults until a reviewed save: ${initialDisk.reason}`);
    if (writeBlockedReason !== undefined)
        warn(`settings writes are blocked: ${writeBlockedReason}`);
    let globalDispose = () => { };
    const agentDisposers = new Map();
    const workspaceFor = (agent) => {
        const cwd = agent.session.header?.cwd;
        return typeof cwd === 'string' && cwd ? current.workspaces[workspaceKey(cwd)] : undefined;
    };
    const workspacePathFor = (agent) => {
        const cwd = agent.session.header?.cwd;
        return typeof cwd === 'string' && cwd ? resolve(cwd) : undefined;
    };
    const layerText = (layer, role) => layer?.enabled === true && layer.role === role ? layer.prompt : '';
    const installGlobal = () => combineDisposers([
        ctx.systemPrompt.section({ name: GLOBAL_SYSTEM_NAME, order: current.global.order, text: () => layerText(current.global, 'system') }),
        ctx.systemPrompt.context({ name: GLOBAL_CONTEXT_NAME, order: current.global.order, text: () => layerText(current.global, 'user-context') }),
    ]);
    const installAgent = (agent) => {
        const order = workspaceFor(agent)?.order ?? 20;
        return combineDisposers([
            agent.ctx.systemPrompt.section({ name: WORKSPACE_SYSTEM_NAME, order, text: () => layerText(workspaceFor(agent), 'system') }),
            agent.ctx.systemPrompt.context({ name: WORKSPACE_CONTEXT_NAME, order, text: () => layerText(workspaceFor(agent), 'user-context') }),
        ]);
    };
    const rebuildRegistrations = (next) => {
        const previous = current;
        const agents = [...agentDisposers.keys()];
        const clear = () => {
            globalDispose();
            globalDispose = () => { };
            for (const dispose of agentDisposers.values())
                dispose();
            agentDisposers.clear();
        };
        const installAll = () => {
            globalDispose = installGlobal();
            for (const agent of agents)
                agentDisposers.set(agent, installAgent(agent));
        };
        clear();
        current = next;
        try {
            installAll();
        }
        catch (error) {
            clear();
            current = previous;
            installAll();
            throw error;
        }
    };
    const adoptDiskState = (disk, source) => {
        if (disk.revision === currentRevision)
            return;
        currentRevision = disk.revision;
        if (disk.kind === 'blocked') {
            writeBlockedReason = disk.reason ?? 'settings are read-only';
            warn(`${source}: settings change was not loaded because writes are blocked: ${writeBlockedReason}`);
            return;
        }
        writeBlockedReason = undefined;
        if (disk.kind === 'invalid') {
            unreadableSettingsFile = true;
            warn(`${source}: invalid settings JSON was not activated: ${disk.reason}`);
            return;
        }
        unreadableSettingsFile = false;
        rebuildRegistrations(disk.settings);
        warn(`${source}: settings reloaded (${disk.kind})`);
    };
    const refreshFromDisk = (source) => {
        adoptDiskState(readDiskSettings(fallbackPrompt, warn), source);
    };
    const commitSettings = async (expectedRevision, update) => withSettingsLock(async () => {
        const disk = readDiskSettings(fallbackPrompt, warn);
        if (disk.kind === 'blocked') {
            writeBlockedReason = disk.reason ?? 'settings are read-only';
            currentRevision = disk.revision;
            throw new PromptInputError(409, writeBlockedReason);
        }
        if (expectedRevision !== undefined && disk.revision !== expectedRevision) {
            adoptDiskState(disk, 'conflict refresh');
            throw new PromptInputError(409, 'settings changed in another window or DSH profile; reload before saving');
        }
        const latest = disk.settings ?? current;
        const next = update(latest);
        const previous = current;
        rebuildRegistrations(next);
        try {
            if (disk.kind === 'invalid' && existsSync(SETTINGS_FILE)) {
                const recoveryFile = `${SETTINGS_FILE}.invalid-${Date.now()}.bak`;
                copyFileSync(SETTINGS_FILE, recoveryFile);
                warn(`unreadable settings were backed up before saving: ${recoveryFile}`);
            }
            currentRevision = saveSettings(next);
            unreadableSettingsFile = false;
            writeBlockedReason = undefined;
            return next;
        }
        catch (error) {
            rebuildRegistrations(previous);
            throw error;
        }
    });
    ctx.effect(() => {
        globalDispose = installGlobal();
        for (const rawAgent of ctx.agents.list()) {
            const agent = rawAgent;
            agentDisposers.set(agent, installAgent(agent));
        }
        return () => { globalDispose(); for (const dispose of agentDisposers.values())
            dispose(); agentDisposers.clear(); };
    }, 'dsh-session-prompt: prompt layers');
    ctx.on('agent/created', ({ agent }) => { if (!agentDisposers.has(agent))
        agentDisposers.set(agent, installAgent(agent)); });
    ctx.on('agent/disposed', ({ agent }) => { agentDisposers.get(agent)?.(); agentDisposers.delete(agent); });
    ctx.effect(() => {
        let reloadTimer;
        const onWatch = () => {
            if (reloadTimer !== undefined)
                clearTimeout(reloadTimer);
            reloadTimer = setTimeout(() => {
                reloadTimer = undefined;
                try {
                    refreshFromDisk('file watcher');
                }
                catch (error) {
                    warn(`file watcher reload failed: ${error instanceof Error ? error.message : String(error)}`);
                }
            }, 100);
        };
        watchFile(SETTINGS_FILE, { interval: 500, persistent: false }, onWatch);
        return () => {
            if (reloadTimer !== undefined)
                clearTimeout(reloadTimer);
            unwatchFile(SETTINGS_FILE, onWatch);
        };
    }, 'dsh-session-prompt: settings watcher');
    ctx.on('tools/pre-execute', async (exec, next) => {
        const downstream = await next();
        if (downstream.kind !== 'allow' || exec.name !== 'dsh_session_prompt_set')
            return downstream;
        return { kind: 'ask', reason: '模型请求永久修改全局提示词，请在界面中人工确认。' };
    });
    ctx.effect(() => ctx.tools.register({
        name: 'dsh_session_prompt_set',
        description: 'Set the persistent global custom instruction text. This always requires human approval.',
        parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'New global instruction text' } }, required: ['prompt'], additionalProperties: false },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        async execute(args) {
            if (args === null || typeof args !== 'object' || Array.isArray(args))
                return 'ERROR: arguments must contain prompt';
            try {
                const prompt = validatePrompt(args.prompt);
                await commitSettings(undefined, latest => ({
                    ...latest,
                    global: { ...latest.global, enabled: true, prompt },
                }));
                const stats = promptStats(prompt);
                return `OK: 全局提示词已更新（${stats.chars} 字符，约 ${stats.estimatedTokens} tokens）`;
            }
            catch (error) {
                return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
            }
        },
    }), 'dsh-session-prompt: set tool');
    ctx.inject(['webServer'], (webCtx) => {
        webCtx.effect(() => webCtx.webServer.register({
            kind: 'exact', path: '/dsh-session-prompt/api',
            handler: async (req, res) => {
                const send = (status, body, responseRevision = currentRevision) => {
                    res.writeHead(status, {
                        'content-type': 'application/json; charset=utf-8',
                        'cache-control': 'no-store',
                        'x-content-type-options': 'nosniff',
                        etag: etag(responseRevision),
                    });
                    res.end(JSON.stringify(body));
                };
                try {
                    const fetchSite = String(req.headers?.['sec-fetch-site'] ?? '');
                    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none')
                        return send(403, { ok: false, error: 'cross-site requests are not allowed' });
                    const query = String(req.url ?? '').split('?', 2)[1] ?? '';
                    const searchParams = new URLSearchParams(query);
                    const sessionId = searchParams.get('sessionId');
                    const requestedScope = searchParams.get('scope');
                    if (requestedScope !== null && requestedScope !== 'global' && requestedScope !== 'workspace') {
                        throw new PromptInputError(400, 'scope must be "global" or "workspace"');
                    }
                    const scope = requestedScope === 'workspace' ? 'workspace' : 'global';
                    if (req.method === 'GET')
                        refreshFromDisk('API read');
                    const agent = sessionId ? ctx.agents.get(sessionId) : undefined;
                    if (scope === 'workspace' && agent === undefined)
                        return send(404, { ok: false, error: 'current session is not available; open or resume the session first' });
                    const workspace = agent ? workspacePathFor(agent) : undefined;
                    const emptyWorkspace = { enabled: false, prompt: '', role: 'system', order: 20 };
                    const selected = scope === 'global' ? current.global : (workspaceFor(agent) ?? emptyWorkspace);
                    const preview = async () => {
                        if (agent === undefined)
                            return null;
                        try {
                            const assembly = await ctx.systemPrompt.assemble({ agent, scope: agent });
                            const systemSections = assembly.sections.map((section, index) => ({
                                index: index + 1, name: section.name, source: classifySource(section.name),
                                text: renderPrompt({ ...assembly, sections: [section] }),
                            })).filter(section => section.text.length > 0);
                            const renderedContexts = renderContextSections(assembly);
                            const contexts = renderedContexts.map((section, index) => ({ index: index + 1, name: section.name, source: classifySource(section.name), text: section.text }));
                            return { finalSystemPrompt: renderPrompt(assembly), contextSnapshot: joinContextSections(renderedContexts), systemSections, contexts };
                        }
                        catch (error) {
                            warn(`preview unavailable for session ${JSON.stringify(sessionId)}: ${error instanceof Error ? error.message : String(error)}`);
                            return null;
                        }
                    };
                    if (req.method === 'GET') {
                        const responseRevision = currentRevision;
                        const responseReadOnlyReason = writeBlockedReason;
                        const responseRecoveryRequired = unreadableSettingsFile;
                        const previewResult = await preview();
                        return send(200, {
                            ok: true, scope, workspace, layer: selected,
                            inherited: scope === 'workspace' && workspaceFor(agent) === undefined,
                            stats: promptStats(selected.prompt), preview: previewResult, revision: responseRevision,
                            readOnlyReason: responseReadOnlyReason, recoveryRequired: responseRecoveryRequired,
                        }, responseRevision);
                    }
                    if (req.method === 'POST') {
                        const mediaType = String(req.headers?.['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase();
                        if (mediaType !== 'application/json')
                            return send(415, { ok: false, error: 'content type must be application/json' });
                        const declaredLength = Number(req.headers?.['content-length'] ?? 0);
                        if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES)
                            return send(413, { ok: false, error: `request body exceeds ${MAX_REQUEST_BYTES} bytes` });
                        const body = JSON.parse(await readBody(req));
                        const layer = validateLayer(body?.layer, scope === 'global' ? 10 : 20);
                        await commitSettings(expectedRevision(req), (latest) => {
                            const next = { ...latest, workspaces: { ...latest.workspaces } };
                            if (scope === 'global')
                                next.global = layer;
                            else
                                next.workspaces[workspaceKey(workspace)] = { ...layer, path: workspace };
                            return next;
                        });
                        return send(200, {
                            ok: true, scope, workspace, layer, stats: promptStats(layer.prompt), preview: await preview(),
                            revision: currentRevision, recoveryRequired: false,
                        });
                    }
                    if (req.method === 'DELETE') {
                        let layer;
                        await commitSettings(expectedRevision(req), (latest) => {
                            const next = { ...latest, workspaces: { ...latest.workspaces } };
                            if (scope === 'global') {
                                layer = defaultSettings(fallbackPrompt).global;
                                next.global = layer;
                            }
                            else {
                                delete next.workspaces[workspaceKey(workspace)];
                                layer = emptyWorkspace;
                            }
                            return next;
                        });
                        return send(200, {
                            ok: true, scope, workspace, layer: layer, inherited: scope === 'workspace',
                            stats: promptStats(layer.prompt), preview: await preview(), revision: currentRevision,
                            recoveryRequired: false,
                        });
                    }
                    res.setHeader('allow', 'GET, POST, DELETE');
                    return send(405, { ok: false, error: 'method not allowed' });
                }
                catch (error) {
                    if (error instanceof PromptInputError)
                        return send(error.status, { ok: false, error: error.message, revision: currentRevision });
                    if (error instanceof SyntaxError)
                        return send(400, { ok: false, error: 'request body must be valid JSON' });
                    webCtx.logger?.warn?.(error instanceof Error ? error : new Error(String(error)));
                    return send(500, { ok: false, error: 'internal error' });
                }
            },
        }), 'dsh-session-prompt: api');
    });
}
//# sourceMappingURL=index.js.map