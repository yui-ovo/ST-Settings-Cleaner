import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = path.resolve(root, '../../outputs/settings-cleaner');
await fs.mkdir(output, { recursive: true });
const playwright = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const initial = {
    regex: [{ name: '保留正则', code: 'x'.repeat(400) }], variables: { global: { story: '保留' } },
    live_settings: { enabled: true, data: '活跃数据'.repeat(900) },
    sleeping_settings: { enabled: false, data: '停用数据'.repeat(120) },
    legacy_cache: { history: '旧插件数据'.repeat(5000) },
    unknown_plugin: { script: '<script>alert(1)</script>', value: '未知'.repeat(300) },
    '<img src=x onerror=alert(1)>': { value: 'untrusted name' },
    disabledExtensions: ['third-party/sleeping'],
};
let persisted = structuredClone(initial), saveCount = 0, rejectSave = false;
const extensionNames = ['third-party/ST-Settings-Cleaner', 'third-party/active', 'third-party/sleeping'];
const server = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    const js = text => { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(text); };
    try {
        if (pathname === '/api/extensions/discover') return json(extensionNames.map(name => ({ name, type: 'local' })));
        if (pathname === '/api/settings/get') return json({ settings: JSON.stringify({ extension_settings: persisted, unrelated: { preserved: true } }) });
        if (pathname === '/api/settings/save') {
            saveCount++;
            if (rejectSave) return json({ error: 'simulated failed save' }, 500);
            const chunks = []; for await (const chunk of req) chunks.push(chunk);
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); persisted = data.extension_settings;
            return json({ result: 'ok' });
        }
        if (pathname === '/script.js') return js(`export async function saveSettings() { await fetch('/api/settings/save', {method:'POST', headers:{'content-type':'application/json'},body:JSON.stringify({extension_settings:window.fixtureSettings})}); }`);
        if (pathname === '/scripts/user.js') return js(`export const currentUser={handle:'tester'}; export const accountsEnabled=true;`);
        if (pathname === '/scripts/extensions/third-party/active/manifest.json') return json({ display_name: '已安装示例插件', js: 'index.js' });
        if (pathname === '/scripts/extensions/third-party/active/index.js') return js(`import './settings.js';`);
        if (pathname === '/scripts/extensions/third-party/active/settings.js') return js(`const KEY='live_settings'; extension_settings[KEY]; throw Error('scanner must never execute this');`);
        if (pathname === '/scripts/extensions/third-party/sleeping/manifest.json') return json({ display_name: '已停用示例插件', js: 'index.js' });
        if (pathname === '/scripts/extensions/third-party/sleeping/index.js') return js(`extension_settings.sleeping_settings;`);
        if (pathname === '/') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            return res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>设置清理测试</title>
                <style>:root{--SmartThemeBodyColor:#ece8e4;--SmartThemeBlurTintColor:#222326;--SmartThemeQuoteColor:#ddbe80}body{background:#14151a;color:#eee;font:15px system-ui;margin:20px}button,input,select{font:inherit}.inline-drawer-header{display:flex;justify-content:space-between;padding:12px;background:#333}.menu_button{cursor:pointer;padding:8px}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #bda46c}</style>
                <link rel="stylesheet" href="/scripts/extensions/third-party/ST-Settings-Cleaner/style.css">
                <div id="extensions_settings2"></div>
                <script>window.fixtureSettings=${JSON.stringify(initial).replace(/</g, '\\u003c')};
                localStorage.setItem('st-settings-cleaner:references:v1:tester',JSON.stringify({legacy_cache:['third-party/OldPlugin']}));
                window.SillyTavern={getContext:()=>({extensionSettings:window.fixtureSettings,getRequestHeaders:()=>({'content-type':'application/json'})})};
                window.toastr={error:message=>{window.fixtureError=message}};</script>
                <script type="module" src="/scripts/extensions/third-party/ST-Settings-Cleaner/index.js"></script>`);
        }
        const prefix = '/scripts/extensions/third-party/ST-Settings-Cleaner/';
        if (pathname.startsWith(prefix)) {
            const relative = pathname.slice(prefix.length); const target = path.resolve(root, relative);
            if (!target.startsWith(root + path.sep) || relative.includes('..')) return json({}, 403);
            const body = await fs.readFile(target);
            res.writeHead(200, { 'content-type': target.endsWith('.css') ? 'text/css' : target.endsWith('.json') ? 'application/json' : 'text/javascript' });
            return res.end(body);
        }
        json({}, 404);
    } catch (error) { json({ error: error.message }, 500); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const engine = process.env.BROWSER_ENGINE || 'chromium';
let browser, debugPage;
try {
    browser = await playwright[engine].launch({ headless: true, ...(engine === 'chromium' && process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, acceptDownloads: true });
    const page = await context.newPage(); debugPage = page; const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button', { name: '打开设置清理', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '扫描完成' }).waitFor();
    const dialog = page.getByRole('dialog');
    assert.equal(await page.getByRole('checkbox', { name: '选择 live_settings', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('checkbox', { name: '选择 sleeping_settings', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('checkbox', { name: '选择 regex', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('.sc-suspected').count(), 1);
    assert.equal(await page.locator('.sc-check input:checked').count(), 0);
    assert.equal(await page.locator('img').count(), 0, 'untrusted key must be rendered as text');
    assert.equal(saveCount, 0, 'scan does not write settings');
    const bounds = await dialog.boundingBox(); assert(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 844);
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false, 'no horizontal overflow');
    await page.screenshot({ path: path.join(output, `${engine}-mobile-dark.png`) });

    await page.getByRole('checkbox', { name: '选择 legacy_cache', exact: true }).check();
    await page.getByRole('searchbox', { name: '搜索设置' }).fill('unknown_plugin');
    assert.match(await page.locator('.sc-count').innerText(), /已选 0 项/);
    await page.getByRole('searchbox', { name: '搜索设置' }).fill('');
    await page.getByRole('checkbox', { name: '选择 legacy_cache', exact: true }).check();
    await page.getByRole('button', { name: '查看清理清单' }).click();
    assert.equal(await page.getByRole('button', { name: '2. 清理所选项目' }).isDisabled(), true);
    await page.getByRole('button', { name: '返回', exact: true }).click();
    assert.equal(saveCount, 0, 'review/cancel does not write');

    async function downloadReview() {
        await page.getByRole('button', { name: '查看清理清单' }).click();
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: '1. 下载清理前备份' }).click();
        const download = await pending; const filename = path.join(output, `${engine}-backup.json`); await download.saveAs(filename);
        await page.getByRole('checkbox', { name: '备份文件已保存，我确认这些项目不再需要' }).check();
        return filename;
    }
    const backupPath = await downloadReview();
    const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
    assert.deepEqual(backup.extensionSettings, initial); assert.deepEqual(backup.removedKeys, ['legacy_cache']);
    await page.getByRole('button', { name: '2. 清理所选项目' }).click();
    await page.getByRole('status').filter({ hasText: '已清理 1 项' }).waitFor();
    assert.equal('legacy_cache' in persisted, false);
    assert.deepEqual(persisted.regex, initial.regex); assert.deepEqual(persisted.live_settings, initial.live_settings);
    assert.equal(await dialog.isVisible(), true);

    async function importBackup() {
        const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '从备份恢复' }).click();
        await (await chooser).setFiles(backupPath); await page.getByRole('heading', { name: '从备份恢复' }).waitFor();
    }
    await importBackup();
    await page.getByRole('checkbox', { name: /^legacy_cache/ }).check();
    await page.getByRole('button', { name: '恢复所选（1）' }).click();
    await page.getByRole('status').filter({ hasText: '已恢复 1 项' }).waitFor();
    assert.deepEqual(persisted, initial);

    await page.evaluate(() => { window.fixtureSettings.legacy_cache = { changed: 'newer data' }; });
    persisted.legacy_cache = { changed: 'newer data' };
    await importBackup();
    assert.equal(await page.getByRole('checkbox', { name: /^legacy_cache/ }).isDisabled(), true);
    assert.match(await page.locator('.sc-content').innerText(), /当前已有不同内容/);
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByRole('button', { name: '重新扫描' }).click();
    await page.getByRole('status').filter({ hasText: '扫描完成' }).waitFor();

    await page.getByRole('checkbox', { name: '选择 unknown_plugin', exact: true }).check();
    await downloadReview();
    await page.evaluate(() => { window.fixtureSettings.unknown_plugin.changed = true; });
    const beforeSaves = saveCount;
    await page.getByRole('button', { name: '2. 清理所选项目' }).click();
    await page.getByRole('status').filter({ hasText: '状态或内容已变化' }).waitFor();
    assert.equal(saveCount, beforeSaves);
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.evaluate(() => { delete window.fixtureSettings.unknown_plugin.changed; });
    await downloadReview(); rejectSave = true;
    await page.getByRole('button', { name: '2. 清理所选项目' }).click();
    await page.getByRole('status').filter({ hasText: '已恢复操作前的数据并核验' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fixtureSettings.unknown_plugin), initial.unknown_plugin);
    assert.deepEqual(persisted.unknown_plugin, initial.unknown_plugin); rejectSave = false;
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.evaluate(() => { document.documentElement.style.setProperty('--SmartThemeBodyColor', '#313237'); document.documentElement.style.setProperty('--SmartThemeBlurTintColor', '#fffdf8'); document.documentElement.style.setProperty('--SmartThemeQuoteColor', '#79642b'); });
    await page.screenshot({ path: path.join(output, `${engine}-mobile-light.png`) });
    assert.equal(await dialog.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 253, 248)');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(output, `${engine}-desktop.png`) });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ engine, passed: true, verified: ['read-only scan', 'installed/disabled/core protection', 'source import discovery without execution', 'mobile bounds', 'theme inheritance', 'hidden selection cleared', 'review cancellation', 'backup content', 'delete and server read-back', 'restore', 'restore conflict', 'stale plan blocked', 'failed save compensation', 'no page errors'], screenshots: output }, null, 2));
} catch (error) {
    if (debugPage) {
        console.error('UI status:', await debugPage.locator('.sc-status').textContent().catch(() => 'unavailable'));
        await debugPage.screenshot({ path: path.join(output, `${engine}-failure.png`) }).catch(() => {});
    }
    throw error;
} finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
}
