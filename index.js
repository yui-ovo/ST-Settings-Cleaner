import { createHost } from './host.js';
import { openCleaner } from './ui.js';

function install() {
    const container = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!container || document.querySelector('#st-settings-cleaner-settings')) return;
    const section = document.createElement('div');
    section.id = 'st-settings-cleaner-settings'; section.className = 'extension_container';
    section.innerHTML = '<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>酒馆设置清理</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><p>查看插件设置占用，备份后清理不再需要的数据。</p><button type="button" class="menu_button">打开设置清理</button><small>仅在打开时扫描，不在后台自动清理。</small></div></div>';
    section.querySelector('button').addEventListener('click', async event => {
        const button = event.currentTarget; button.disabled = true;
        try { openCleaner(await createHost()); }
        catch (error) { globalThis.toastr?.error?.(error.message, '酒馆设置清理'); }
        finally { button.disabled = false; }
    });
    container.append(section);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
const context = globalThis.SillyTavern?.getContext?.();
if (context?.eventTypes?.APP_READY) context.eventSource?.once?.(context.eventTypes.APP_READY, install);
