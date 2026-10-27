import { analyze, bytes, clone, formatBytes, makeBackup, parseBackup, restorationPlan, commitChange, same, own } from './core.js';

const labels = { protected: '内置 · 保留', installed: '已安装 · 保留', disabled: '已停用 · 保留', suspected: '疑似卸载', unknown: '归属不明' };
function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
}
function button(text, handler, className = '') {
    const node = element('button', text, `menu_button sc-button ${className}`);
    node.type = 'button'; node.addEventListener('click', handler); return node;
}
function checkbox(text, checked, changed) {
    const label = element('label', null, 'sc-check');
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked;
    input.addEventListener('change', () => changed(input.checked));
    label.append(input, element('span', text));
    return { label, input };
}

export function openCleaner(host) {
    const existing = document.querySelector('#st-settings-cleaner-dialog');
    if (existing) { existing.focus(); return existing; }
    const dialog = document.createElement('dialog'); dialog.id = 'st-settings-cleaner-dialog';
    dialog.className = 'sc-dialog'; dialog.setAttribute('aria-labelledby', 'sc-title');
    const header = element('header', null, 'sc-header');
    const heading = element('div'); const title = element('h2', '酒馆设置清理'); title.id = 'sc-title';
    heading.append(title, element('p', '查看占用 · 备份后清理 · 随时恢复', 'sc-muted'));
    const close = button('×', () => { if (!busy) dialog.close(); }, 'sc-close'); close.setAttribute('aria-label', '关闭');
    header.append(heading, close);
    const status = element('p', '', 'sc-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const content = element('div', null, 'sc-content');
    const footer = element('footer', null, 'sc-footer');
    dialog.append(header, status, content, footer); document.body.append(dialog);
    let busy = false, rows = [], inventory = [], selected = new Set(), query = '', filter = 'all';
    const say = (text, error = false) => { status.textContent = text; status.classList.toggle('sc-error', error); };
    const lock = value => {
        busy = value; dialog.setAttribute('aria-busy', String(value));
        content.inert = value; footer.inert = value; close.disabled = value;
    };
    const attempt = async callback => {
        if (busy) return;
        lock(true);
        try { await callback(); } catch (error) { say(error.message, true); }
        finally { lock(false); }
    };
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();

    async function scan() {
        say('正在读取插件列表…');
        inventory = await host.inventory((done, total) => say(`正在检查设置归属 ${done} / ${total}…`));
        host.remember(inventory);
        rows = analyze(host.settings, inventory, host.history());
        selected.clear();
        renderList();
        const incomplete = inventory.filter(item => item.incomplete).length;
        say(incomplete ? `扫描完成。${incomplete} 个插件的代码未完整读取；归属不明的项目需要自行确认。` : '扫描完成。所有项目默认不勾选；归属不明不代表已卸载。');
    }
    function visibleRows() {
        return rows.filter(row => (filter === 'all' || (filter === 'suspected' ? row.status === 'suspected' : filter === 'unknown' ? row.status === 'unknown' : !row.removable)) &&
            `${row.key} ${row.reason}`.toLowerCase().includes(query.toLowerCase()));
    }
    function updateFooter() {
        footer.replaceChildren();
        const sum = rows.filter(row => selected.has(row.key)).reduce((total, row) => total + row.size, 0);
        footer.append(element('span', `已选 ${selected.size} 项 · 约 ${formatBytes(sum)}`, 'sc-count'));
        const review = button('查看清理清单', () => reviewClean(), 'sc-primary');
        review.disabled = !selected.size || !host.account;
        footer.append(review);
    }
    function renderList() {
        content.replaceChildren();
        const total = bytes(host.settings);
        const summary = element('section', null, 'sc-summary');
        summary.append(element('span', '插件设置占用', 'sc-muted'), element('strong', formatBytes(total)),
            element('span', `${rows.length} 项 · 按大小排列`, 'sc-muted'));
        const tools = element('div', null, 'sc-tools');
        tools.append(button('重新扫描', () => attempt(scan)), button('从备份恢复', chooseBackup));
        content.append(summary, tools);
        if (!host.account) content.append(element('p', '无法识别当前酒馆账户，暂时仅查看，不允许清理或恢复。', 'sc-error'));
        const controls = element('div', null, 'sc-tools');
        const search = element('input', null, 'text_pole sc-search'); search.type = 'search'; search.placeholder = '搜索设置名或插件名'; search.value = query;
        search.setAttribute('aria-label', '搜索设置');
        const select = document.createElement('select'); select.className = 'text_pole'; select.setAttribute('aria-label', '筛选状态');
        for (const [value, name] of [['all', '全部'], ['suspected', '疑似卸载'], ['unknown', '归属不明'], ['protected', '保留项目']]) {
            const option = element('option', name); option.value = value; select.append(option);
        }
        select.value = filter; controls.append(search, select); content.append(controls);
        const explanation = element('p', '只处理插件设置，不清理聊天、角色卡、预设文件或世界书文件。插件保存在设置里的收藏、脚本等数据会随该项一起删除。', 'sc-muted sc-help');
        content.append(explanation);
        const list = element('div', null, 'sc-list'); content.append(list);
        function fill() {
            // Hidden selections never participate in bulk operations.
            const visible = visibleRows(); const keys = new Set(visible.map(row => row.key));
            for (const key of selected) if (!keys.has(key)) selected.delete(key);
            list.replaceChildren();
            if (!visible.length) list.append(element('p', '没有符合条件的设置。', 'sc-empty'));
            for (const row of visible) {
                const item = element('article', null, 'sc-row'); item.dataset.key = row.key;
                const top = element('div', null, 'sc-row-top');
                const check = checkbox(row.key, selected.has(row.key), checked => {
                    if (checked) selected.add(row.key); else selected.delete(row.key);
                    updateFooter();
                });
                check.input.disabled = !row.removable || !host.account;
                check.input.setAttribute('aria-label', `选择 ${row.key}`);
                top.append(check.label, element('strong', formatBytes(row.size), 'sc-size'));
                const line = element('div', null, 'sc-row-meta');
                line.append(element('span', labels[row.status], `sc-badge sc-${row.status}`));
                const details = document.createElement('details');
                details.append(element('summary', '查看说明'), element('p', row.reason));
                const value = row.value;
                const shape = Array.isArray(value) ? `列表：${value.length} 项` : value !== null && typeof value === 'object'
                    ? `包含字段：${Object.keys(value).slice(0, 16).join('、') || '空对象'}${Object.keys(value).length > 16 ? '…' : ''}`
                    : `数据类型：${value === null ? 'null' : typeof value}`;
                details.append(element('p', shape, 'sc-muted'));
                item.append(top, line, details); list.append(item);
            }
            updateFooter();
        }
        search.addEventListener('input', () => { query = search.value; fill(); });
        select.addEventListener('change', () => { filter = select.value; fill(); });
        fill();
    }
    function reviewClean() {
        const chosen = rows.filter(row => selected.has(row.key) && row.removable);
        if (!chosen.length) return;
        const backup = makeBackup(host.settings, chosen.map(row => row.key), host.account);
        content.replaceChildren(element('h3', '确认这次要清理的内容'),
            element('p', '以下每一项都会整项删除。确认是已卸载插件的残留，或确定不再需要这些数据后再继续。', 'sc-help'));
        const list = element('ul', null, 'sc-review-list');
        for (const row of chosen) list.append(element('li', `${row.key} · ${formatBytes(row.size)} · ${labels[row.status]}`));
        content.append(list, element('p', '备份包含当前插件设置，可能含插件私有信息，请保存在自己的设备上。恢复只补回本次删除且当前不存在的项目。', 'sc-muted sc-help'));
        let downloaded = false;
        const confirm = checkbox('备份文件已保存，我确认这些项目不再需要', false, checked => { execute.disabled = !downloaded || !checked; });
        confirm.input.disabled = true;
        const download = button('1. 下载清理前备份', () => {
            try {
                host.download(backup); downloaded = true; confirm.input.disabled = false;
                say('已发起下载。请确认文件已保存，再勾选下方确认框。');
            } catch (error) { say(`备份下载失败：${error.message}`, true); }
        });
        content.append(download, confirm.label);
        const execute = button('2. 清理所选项目', () => attempt(async () => {
            say('正在重新检查插件列表和所选数据…');
            const fresh = await host.inventory();
            const eligible = analyze(host.settings, fresh, host.history());
            for (const key of backup.removedKeys) {
                if (!eligible.find(row => row.key === key)?.removable || !own(host.settings, key) || !same(host.settings[key], backup.extensionSettings[key])) {
                    throw new Error(`“${key}”的状态或内容已变化，请返回重新扫描并下载新备份。`);
                }
            }
            const server = await host.read();
            for (const key of backup.removedKeys) {
                if (!own(server, key) || !same(server[key], backup.extensionSettings[key])) throw new Error(`“${key}”的本地和服务器数据不同，请返回重新扫描，待酒馆保存完成后再试。`);
            }
            say('正在清理并核验保存结果…');
            await commitChange({ settings: host.settings,
                changes: backup.removedKeys.map(key => ({ key, had: true, before: backup.extensionSettings[key], remove: true })),
                save: host.save, read: host.read });
            rows = analyze(host.settings, fresh, host.history()); selected.clear(); renderList();
            say(`已清理 ${backup.removedKeys.length} 项，并核验服务器保存结果。需要撤销时，可从刚才的备份恢复。`);
        }), 'sc-primary');
        execute.disabled = true;
        footer.replaceChildren(button('返回', () => { renderList(); say('未执行清理。'); }), execute);
    }
    function chooseBackup() {
        if (busy || !host.account) return;
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
        input.addEventListener('change', () => attempt(async () => {
            const file = input.files?.[0]; if (!file) return;
            if (file.size > 100 * 1024 * 1024) throw new Error('备份超过 100 MB，请先在电脑上检查文件。');
            const backup = parseBackup(await file.text());
            if (backup.account !== host.account) throw new Error('备份属于另一个酒馆账户，不能恢复到当前账户。');
            showRestore(backup);
        }));
        input.click();
    }
    function showRestore(backup) {
        const plan = restorationPlan(host.settings, backup), picked = new Set();
        content.replaceChildren(element('h3', '从备份恢复'), element('p', '只补回当前不存在的项目；已经存在且内容不同的项目不会覆盖。', 'sc-help'));
        say(`备份时间：${backup.createdAt || '未知'}`);
        const list = element('div', null, 'sc-list');
        const apply = button('恢复所选（0）', () => attempt(async () => {
            const keys = [...picked]; const server = await host.read();
            for (const key of keys) if (own(host.settings, key) || own(server, key)) throw new Error(`“${key}”已存在，为避免覆盖请返回重新导入备份。`);
            await commitChange({ settings: host.settings,
                changes: keys.map(key => ({ key, had: false, remove: false, after: clone(backup.extensionSettings[key]) })),
                save: host.save, read: host.read });
            selected.clear(); rows = analyze(host.settings, inventory, host.history()); renderList();
            say(`已恢复 ${keys.length} 项，并核验服务器保存结果。相关插件可能需要刷新酒馆后重新读取设置。`);
        }), 'sc-primary'); apply.disabled = true;
        for (const item of plan) {
            const row = element('div', null, 'sc-row');
            const check = checkbox(`${item.key} · ${formatBytes(item.size)}`, false, value => {
                if (value) picked.add(item.key); else picked.delete(item.key);
                apply.textContent = `恢复所选（${picked.size}）`; apply.disabled = !picked.size;
            }); check.input.disabled = item.state !== 'missing';
            row.append(check.label, element('p', { missing: '可以补回', same: '已经存在且内容一致，无需恢复', conflict: '当前已有不同内容，跳过以免覆盖' }[item.state], 'sc-muted'));
            list.append(row);
        }
        content.append(list); footer.replaceChildren(button('返回', renderList), apply);
    }
    // Reads happen only while explicitly opening/scanning. There is no background polling.
    renderList();
    attempt(scan);
    return dialog;
}
