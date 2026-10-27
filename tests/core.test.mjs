import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, updateHistory, referencedKeys, bytes, makeBackup, parseBackup, restorationPlan, commitChange, same } from '../core.js';

test('UTF-8 accounting counts Chinese and sorts large entries first', () => {
    assert.equal(bytes('你好'), 8);
    const rows = analyze({ tiny: 1, large: '中'.repeat(100), ignored: undefined }, []);
    assert.deepEqual(rows.map(x => x.key), ['large', 'tiny']);
});
test('builtins, installed and disabled extensions are protected, unknown is never called orphan', () => {
    const rows = analyze({ regex: [], variables: {}, live: {}, sleeping: {}, mystery: {}, disabledExtensions: ['third-party/sleep'] }, [
        { name: 'third-party/active', keys: ['live'] }, { name: 'third-party/sleep', keys: ['sleeping'] },
    ]);
    for (const key of ['regex', 'variables', 'live', 'sleeping', 'disabledExtensions']) assert.equal(rows.find(x => x.key === key).removable, false);
    assert.equal(rows.find(x => x.key === 'sleeping').status, 'disabled');
    assert.equal(rows.find(x => x.key === 'mystery').status, 'unknown');
});
test('history only yields suspected uninstall; existing historic references remain protected', () => {
    const settings = { example: {} }, extensions = [{ name: 'third-party/Example', keys: ['example'] }];
    const history = updateHistory({}, settings, extensions);
    assert.equal(analyze(settings, [], history)[0].status, 'suspected');
    assert.equal(analyze(settings, [{ name: 'third-party/Example', keys: [] }], history)[0].removable, false);
    assert.deepEqual(Object.keys(updateHistory(history, {}, [])), []);
});
test('references are parsed without executing source including literal constants', () => {
    const source = `const MODULE_NAME = 'example'; extension_settings[MODULE_NAME]; ctx.extensionSettings.foo; extension_settings['中文']; throw new Error('never execute');`;
    assert.deepEqual(new Set(referencedKeys(source)), new Set(['foo', '中文', 'example']));
    assert.deepEqual(referencedKeys('extension_settings[calculateKey()]'), []);
});
test('backup round trip preserves full extension data but limits restore to selected keys', () => {
    const settings = { regex: [{ foo: 1 }], old: { nested: '你好' }, other: [1, 2] };
    const backup = parseBackup(JSON.stringify(makeBackup(settings, ['old'], 'me')));
    settings.old.nested = 'changed';
    assert.equal(backup.extensionSettings.old.nested, '你好');
    assert.equal(backup.extensionSettings.regex[0].foo, 1);
    assert.deepEqual(restorationPlan({}, backup).map(x => x.key), ['old']);
});
test('rejects foreign backup formats, protected keys and prototype keys', () => {
    assert.throws(() => parseBackup('{"extension_settings":{}}'));
    for (const key of ['regex', '__proto__', 'constructor']) {
        const malicious = { format: 'st-settings-cleaner-backup', version: 1, account: 'me', removedKeys: [key], extensionSettings: JSON.parse(`{"${key}":{}}`) };
        assert.throws(() => parseBackup(JSON.stringify(malicious)));
    }
    assert.equal({}.polluted, undefined);
});
test('restore reports conflicts instead of replacing newer values', () => {
    const backup = makeBackup({ a: 1, b: 2, c: 3 }, ['a', 'b', 'c'], 'me');
    assert.deepEqual(restorationPlan({ b: 2, c: 4 }, backup).map(x => x.state), ['missing', 'same', 'conflict']);
});
test('commits only selected keys and verifies server state', async () => {
    const settings = { old: 1, keep: 2 }; let disk = structuredClone(settings);
    await commitChange({ settings, changes: [{ key: 'old', had: true, before: 1, remove: true }],
        save: async () => { disk = structuredClone(settings); }, read: async () => disk });
    assert.deepEqual(settings, { keep: 2 }); assert.deepEqual(disk, settings);
});
test('stale plans and mixed protected selections cause no mutation or save', async () => {
    const settings = { old: 2, regex: [] }; let saves = 0;
    const opts = { settings, save: async () => saves++, read: async () => ({}) };
    await assert.rejects(commitChange({ ...opts, changes: [{ key: 'old', had: true, before: 1, remove: true }] }), /变化/);
    await assert.rejects(commitChange({ ...opts, changes: [{ key: 'old', had: true, before: 2, remove: true }, { key: 'regex', had: true, before: [], remove: true }] }), /保护/);
    assert.equal(settings.old, 2); assert.equal(saves, 0);
});
test('read-back mismatch triggers verified compensating save', async () => {
    const settings = { old: { n: 1 }, keep: true }; let disk = structuredClone(settings), saves = 0;
    await assert.rejects(commitChange({ settings, changes: [{ key: 'old', had: true, before: { n: 1 }, remove: true }],
        save: async () => { saves++; if (saves > 1) disk = structuredClone(settings); }, read: async () => disk }), /已恢复操作前/);
    assert.deepEqual(settings.old, { n: 1 }); assert.equal(saves, 2);
});
test('offline rollback does not falsely claim server success', async () => {
    const settings = { old: 1 };
    await assert.rejects(commitChange({ settings, changes: [{ key: 'old', had: true, before: 1, remove: true }],
        save: async () => { throw new Error('offline'); }, read: async () => { throw new Error('offline'); } }), /无法确认服务器最终状态/);
    assert.equal(settings.old, 1);
});
test('concurrent extension rewrite is not overwritten during failure compensation', async () => {
    const settings = { old: 1 }; let saves = 0;
    await assert.rejects(commitChange({ settings, changes: [{ key: 'old', had: true, before: 1, remove: true }],
        save: async () => { if (++saves === 1) settings.old = 99; }, read: async () => ({ old: 99 }) }), /无法确认/);
    assert.equal(settings.old, 99);
});
test('restore can add a missing key, but cannot overwrite a key created since review', async () => {
    const settings = {}; let disk = {};
    const opts = { settings, changes: [{ key: 'old', had: false, after: { saved: true }, remove: false }],
        save: async () => { disk = structuredClone(settings); }, read: async () => disk };
    await commitChange(opts); assert.deepEqual(settings.old, { saved: true });
    await assert.rejects(commitChange(opts), /变化/);
});
test('non-configurable data is rejected before any mutation', async () => {
    const settings = { normal: 1 }; Object.defineProperty(settings, 'locked', { value: 2, configurable: false });
    await assert.rejects(commitChange({ settings, changes: [{ key: 'normal', had: true, before: 1, remove: true }, { key: 'locked', had: true, before: 2, remove: true }], save() {}, read() {} }), /不可直接/);
    assert.equal(settings.normal, 1);
});
test('host-side key reordering and dropped undefined fields are not conflicts', () => {
    assert.equal(same({ a: 1, b: { x: 2, y: 3, omitted: undefined } }, { b: { y: 3, x: 2 }, a: 1 }), true);
    assert.equal(same([1, 2], [2, 1]), false);
    assert.equal(same({ x: null }, {}), false);
    assert.equal(same([1, 2], { 0: 1, 1: 2 }), false);
});
test('an extension recreating data after save prevents a false cleanup success', async () => {
    const settings = { old: 1 }; let disk = { old: 1 }, saves = 0;
    await assert.rejects(commitChange({ settings, changes: [{ key: 'old', had: true, before: 1, remove: true }],
        save: async () => { disk = structuredClone(settings); if (++saves === 1) settings.old = 99; }, read: async () => disk }), /无法确认/);
    assert.equal(settings.old, 99); assert.equal(disk.old, 99);
});
