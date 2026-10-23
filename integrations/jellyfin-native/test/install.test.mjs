import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { install, remove } from '../install.mjs';

test('unsupported source is rejected before creating recovery state or mutating files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mtv-install-'));
    try {
        await assert.rejects(install('bad', root), /Choose roku or web/);
        await mkdir(join(root, 'src/plugins/htmlVideoPlayer'), { recursive: true });
        const path = join(root, 'src/plugins/htmlVideoPlayer/plugin.js');
        await writeFile(path, 'custom client');
        await assert.rejects(install('web', root), /Unsupported or edited|ENOENT/);
        assert.equal(await readFile(path, 'utf8'), 'custom client');
        await assert.rejects(readFile(join(root, '.vidarr-native-overlay.json')), /ENOENT/);
    } finally { await rm(root, { recursive: true, force: true }); }
});

for (const client of ['roku', 'web']) {
    test(`${client} pinned upstream install/check/repeat/remove preserves edits and exact original bytes`, { skip: !process.env.MTV_UPSTREAM }, async () => {
        const source = resolve(process.env.MTV_UPSTREAM, client);
        const root = await mkdtemp(join(tmpdir(), `mtv-${client}-`));
        try {
            const bases = JSON.parse(await readFile(new URL('../bases.json', import.meta.url), 'utf8'));
            let state;
            try { state = JSON.parse(await readFile(join(source, '.vidarr-native-overlay.json'), 'utf8')); } catch {}
            const originals = new Map();
            for (const path of Object.keys(bases[client].files)) {
                const content = state?.files.find(file => file.path === path)?.original ?? await readFile(join(source, path), 'utf8');
                originals.set(path, content);
                await mkdir(dirname(join(root, path)), { recursive: true });
                await writeFile(join(root, path), content);
            }
            assert.match(await install(client, root, true), /Compatible/);
            await assert.rejects(readFile(join(root, '.vidarr-native-overlay.json')), /ENOENT/);
            assert.match(await install(client, root), /Installed/);
            assert.equal(await install(client, root), 'Already installed');
            const path = [...originals.keys()][0];
            const installed = await readFile(join(root, path), 'utf8');
            await writeFile(join(root, path), installed + '\nlocal edit');
            await assert.rejects(remove(root), /Edited installed file/);
            await writeFile(join(root, path), installed);
            // An interrupted install/removal may leave some originals already restored.
            await writeFile(join(root, path), originals.get(path));
            await remove(root);
            for (const [path, content] of originals) assert.equal(await readFile(join(root, path), 'utf8'), content);
            assert.equal(await remove(root), 'No installation found');
        } finally { await rm(root, { recursive: true, force: true }); }
    });
}
