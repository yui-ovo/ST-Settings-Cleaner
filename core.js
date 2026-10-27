// No code from a scanned plugin is executed. Unknown ownership is never proof of abandonment.
export const FORMAT = 'st-settings-cleaner-backup';
export const PROTECTED = new Set([
    'apiUrl', 'apiKey', 'autoConnect', 'notifyUpdates', 'disabledExtensions',
    'expressionOverrides', 'memory', 'note', 'caption', 'expressions', 'connectionManager',
    'dice', 'regex', 'regex_presets', 'character_allowed_regex', 'preset_allowed_regex',
    'tts', 'sd', 'chromadb', 'translate', 'objective', 'quickReply', 'randomizer',
    'speech_recognition', 'rvc', 'hypebot', 'vectors', 'variables', 'attachments',
    'character_attachments', 'disabled_attachments', 'gallery',
]);
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);
export const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const clone = value => JSON.parse(JSON.stringify(value));
// Compare persisted JSON semantics, not property insertion order (some hosts reorder objects).
export function same(a, b) {
    const left = JSON.stringify(a), right = JSON.stringify(b);
    if (left === right) return true;
    if (left === undefined || right === undefined) return false;
    const pending = [[JSON.parse(left), JSON.parse(right)]];
    while (pending.length) {
        const [x, y] = pending.pop();
        if (x === y) continue;
        if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object' || Array.isArray(x) !== Array.isArray(y)) return false;
        const xKeys = Object.keys(x), yKeys = Object.keys(y);
        if (xKeys.length !== yKeys.length) return false;
        for (const key of xKeys) {
            if (!own(y, key)) return false;
            pending.push([x[key], y[key]]);
        }
    }
    return true;
}
export const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
export const safeKey = key => typeof key === 'string' && key.length > 0 && !UNSAFE.has(key);
export function formatBytes(size) {
    if (size < 1024) return `${size} B`;
    if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1024 ** 2).toFixed(2)} MB`;
}

// These are references, NOT guaranteed exclusive owners. False matches only protect more data.
export function referencedKeys(source) {
    const keys = new Set();
    for (const match of source.matchAll(/\b(?:extension_settings|extensionSettings)\s*(?:\.\s*([\w$]+)|\[\s*['"]([^'"\r\n]+)['"]\s*\])/g)) {
        if (safeKey(match[1] || match[2])) keys.add(match[1] || match[2]);
    }
    const constants = new Map();
    for (const match of source.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*['"]([^'"\r\n]+)['"]/g)) {
        if (!constants.has(match[1])) constants.set(match[1], new Set());
        constants.get(match[1]).add(match[2]);
    }
    for (const match of source.matchAll(/\b(?:extension_settings|extensionSettings)\s*\[\s*([\w$]+)\s*\]/g)) {
        for (const key of constants.get(match[1]) || []) if (safeKey(key)) keys.add(key);
    }
    return [...keys];
}

export function analyze(settings, inventory, history = {}) {
    if (!isRecord(settings) || !Array.isArray(inventory)) throw new Error('设置或插件列表格式不正确。');
    const disabled = new Set(settings.disabledExtensions || []);
    return Object.entries(settings).filter(([, value]) => value !== undefined).map(([key, value]) => {
        const current = inventory.filter(ext => ext.keys?.includes(key) || ext.name === key || ext.name.split('/').at(-1) === key);
        const historical = Array.isArray(history[key]) ? history[key].filter(x => typeof x === 'string') : [];
        // Protect historic associations even if a new bundle no longer exposes literal references.
        const associated = inventory.filter(ext => current.includes(ext) || historical.includes(ext.name));
        let status = 'unknown', reason = '未能确认归属，不代表可以删除；请先确认这项数据已不再需要。';
        if (PROTECTED.has(key) || !safeKey(key)) {
            status = 'protected'; reason = '酒馆公共或内置功能设置，本工具不清理。';
        } else if (associated.length) {
            status = associated.every(ext => disabled.has(ext.name)) ? 'disabled' : 'installed';
            reason = `检测到关联插件：${associated.map(ext => ext.label || ext.name).join('、')}。保留此项。`;
        } else if (historical.length) {
            status = 'suspected'; reason = `以前检测到关联：${historical.join('、')}；当前安装列表中未找到。仍需确认是否被其他插件使用。`;
        }
        return { key, size: bytes({ [key]: value }) - 2, status, reason,
            removable: status === 'unknown' || status === 'suspected', value: clone(value) };
    }).sort((a, b) => b.size - a.size || a.key.localeCompare(b.key));
}

export function updateHistory(history, settings, inventory) {
    const next = Object.create(null);
    for (const key of Object.keys(settings)) {
        if (!safeKey(key) || PROTECTED.has(key)) continue;
        const old = Array.isArray(history[key]) ? history[key].filter(x => typeof x === 'string') : [];
        const refs = inventory.filter(ext => ext.keys?.includes(key) || ext.name === key || ext.name.split('/').at(-1) === key).map(ext => ext.name);
        if (old.length || refs.length) next[key] = [...new Set([...old, ...refs])].slice(0, 100);
    }
    return next;
}

export function makeBackup(settings, keys, account) {
    const selected = [...new Set(keys)];
    if (!selected.length || selected.some(key => !safeKey(key) || PROTECTED.has(key) || !own(settings, key))) {
        throw new Error('清理列表为空，或包含受保护/已不存在的设置。');
    }
    return { format: FORMAT, version: 1, createdAt: new Date().toISOString(), account,
        removedKeys: selected, extensionSettings: clone(settings) };
}
export function parseBackup(text) {
    const value = JSON.parse(text);
    if (!isRecord(value) || value.format !== FORMAT || value.version !== 1 ||
        typeof value.account !== 'string' || !isRecord(value.extensionSettings) ||
        !Array.isArray(value.removedKeys) || !value.removedKeys.length ||
        new Set(value.removedKeys).size !== value.removedKeys.length ||
        value.removedKeys.some(key => !safeKey(key) || PROTECTED.has(key) || !own(value.extensionSettings, key))) {
        throw new Error('不是有效的“酒馆设置清理”备份。请使用清理前下载的原始文件。');
    }
    return value;
}
export function restorationPlan(settings, backup) {
    return backup.removedKeys.map(key => ({ key,
        state: !own(settings, key) ? 'missing' : same(settings[key], backup.extensionSettings[key]) ? 'same' : 'conflict',
        size: bytes({ [key]: backup.extensionSettings[key] }) - 2,
    }));
}

// Saves go through the host's own serializer. Read back from the server before reporting success.
// An ambiguous write is rolled back locally and a compensating save is attempted; never claim success.
export async function commitChange({ settings, changes, save, read }) {
    for (const change of changes) {
        if (!safeKey(change.key) || PROTECTED.has(change.key)) throw new Error('拒绝修改受保护的设置。');
        const descriptor = Object.getOwnPropertyDescriptor(settings, change.key);
        if (descriptor && (!descriptor.configurable || descriptor.get || descriptor.set)) throw new Error('所选设置不可直接修改，已停止操作。');
        if (own(settings, change.key) !== change.had || (change.had && !same(settings[change.key], change.before))) {
            throw new Error('所选设置刚刚发生变化，请重新扫描后再操作。');
        }
    }
    for (const change of changes) {
        if (change.remove) delete settings[change.key];
        else Object.defineProperty(settings, change.key, { value: clone(change.after), configurable: true, writable: true, enumerable: true });
    }
    try {
        await save();
        const persisted = await read();
        const differs = (data, change) => change.remove ? own(data, change.key) : !own(data, change.key) || !same(data[change.key], change.after);
        if (changes.some(change => differs(persisted, change) || differs(settings, change))) {
            throw new Error('服务器未保存预期结果，可能有插件重新写入了这些数据。');
        }
    } catch (error) {
        let concurrent = false;
        for (const change of changes) {
            const stillOurs = change.remove ? !own(settings, change.key) : own(settings, change.key) && same(settings[change.key], change.after);
            if (!stillOurs) { concurrent = true; continue; }
            if (change.had) Object.defineProperty(settings, change.key, { value: clone(change.before), configurable: true, writable: true, enumerable: true });
            else delete settings[change.key];
        }
        let verified = false;
        try {
            await save();
            const persisted = await read();
            verified = !concurrent && changes.every(change => own(persisted, change.key) === change.had && (!change.had || same(persisted[change.key], change.before)));
        } catch { /* The downloaded backup is the recovery path if the server is unavailable. */ }
        throw new Error(`${error.message} ${verified ? '已恢复操作前的数据并核验。' : '无法确认服务器最终状态，请保留备份，恢复连接后重新扫描核对；不要连续重试。'}`);
    }
}
