import { isRecord, referencedKeys, updateHistory } from './core.js';

async function request(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
        const response = await fetch(url, { cache: 'no-store', ...options, signal: controller.signal });
        if (!response.ok) throw new Error(`读取失败（${response.status}）：${url}`);
        return await response.json();
    } finally { clearTimeout(timer); }
}
async function sourceText(url, budget) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('源码无法读取');
        const reader = response.body.getReader();
        const chunks = []; let length = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                length += value.byteLength;
                if (length > budget) { await reader.cancel(); throw new Error('源码超过扫描限额'); }
                chunks.push(value);
            }
        } finally { reader.releaseLock(); }
        const combined = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
        return { text: new TextDecoder().decode(combined), length };
    } finally { clearTimeout(timer); }
}
function inside(url, directory) {
    return url.origin === directory.origin && url.pathname.startsWith(directory.pathname) && /\.(?:m?js)$/.test(url.pathname);
}
async function inspectExtension(extension) {
    if (typeof extension.name !== 'string' || extension.name.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'))) {
        throw new Error('插件目录名不合法。');
    }
    const directory = new URL(`/scripts/extensions/${extension.name.split('/').map(encodeURIComponent).join('/')}/`, location.origin);
    const result = { name: extension.name, label: extension.name, keys: [], incomplete: false };
    try {
        const manifest = await request(new URL('manifest.json', directory));
        if (typeof manifest.display_name === 'string') result.label = manifest.display_name;
        if (!manifest.js) return result;
        const entry = new URL(manifest.js, directory);
        if (!inside(entry, directory)) throw new Error('入口不在插件目录内');
        const queue = [entry], visited = new Set(), keys = new Set(); let remaining = 4 * 1024 * 1024;
        // Bounded, literal, relative imports only. Nothing is imported or evaluated for discovery.
        while (queue.length && visited.size < 12) {
            const url = queue.shift();
            if (visited.has(url.href)) continue;
            visited.add(url.href);
            try {
                const source = await sourceText(url, Math.min(remaining, 2 * 1024 * 1024));
                remaining -= source.length;
                for (const key of referencedKeys(source.text)) keys.add(key);
                for (const match of source.text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"\r\n]+)['"]/g)) {
                    const child = new URL(match[1], url);
                    if (inside(child, directory) && !visited.has(child.href)) queue.push(child);
                }
            } catch { result.incomplete = true; }
            if (remaining <= 0) break;
        }
        if (queue.length) result.incomplete = true;
        result.keys = [...keys];
    } catch { result.incomplete = true; }
    return result;
}

export async function createHost() {
    const context = globalThis.SillyTavern?.getContext?.();
    if (!isRecord(context?.extensionSettings)) throw new Error('当前酒馆没有提供插件设置接口。');
    const main = await import('/script.js');
    if (typeof main.saveSettings !== 'function') throw new Error('当前酒馆不支持直接保存设置，暂不能清理。');
    let account = null;
    try {
        const user = await import('/scripts/user.js');
        if (user.currentUser?.handle) account = user.currentUser.handle;
        else if (user.accountsEnabled === false) account = 'default-user';
    } catch { /* No cross-account history or writes without a known account. */ }
    const historyKey = account ? `st-settings-cleaner:references:v1:${account}` : null;
    let history = {};
    try {
        const parsed = historyKey ? JSON.parse(localStorage.getItem(historyKey) || '{}') : {};
        if (isRecord(parsed)) history = parsed;
    } catch { /* Scanning works without local storage. */ }
    return {
        settings: context.extensionSettings,
        account,
        async inventory(progress = () => {}) {
            const found = await request('/api/extensions/discover');
            if (!Array.isArray(found) || !found.length || found.some(ext => typeof ext?.name !== 'string')) {
                throw new Error('没有获取到完整的已安装插件列表，已停止扫描。');
            }
            const result = []; let next = 0, done = 0;
            await Promise.all(Array.from({ length: Math.min(3, found.length) }, async () => {
                while (next < found.length) {
                    const ext = found[next++];
                    result.push(await inspectExtension(ext));
                    progress(++done, found.length);
                }
            }));
            return result;
        },
        history: () => history,
        remember(inventory) {
            history = updateHistory(history, context.extensionSettings, inventory);
            try { if (historyKey) localStorage.setItem(historyKey, JSON.stringify(history)); } catch { /* optional */ }
        },
        async read() {
            const response = await request('/api/settings/get', { method: 'POST', headers: context.getRequestHeaders(), body: '{}' });
            const settings = typeof response.settings === 'string' ? JSON.parse(response.settings) : response.settings;
            if (!isRecord(settings?.extension_settings)) throw new Error('无法核验服务器上的插件设置，已停止操作。');
            return settings.extension_settings;
        },
        save: () => main.saveSettings(),
        download(backup) {
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `酒馆设置清理-备份-${backup.createdAt.replace(/[:.]/g, '-')}.json`;
            document.body.append(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        },
    };
}
