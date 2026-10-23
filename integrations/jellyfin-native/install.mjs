import { readFile, writeFile, mkdir, unlink, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const normalize = value => value.replace(/\r\n/g, '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const stateName = '.vidarr-native-overlay.json';

function replaceOnce(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error(`Expected one integration anchor: ${anchor.slice(0, 80)}`);
    return source.replace(anchor, replacement);
}

export async function planInstall(client, root) {
    const bases = JSON.parse(await readFile(join(here, 'bases.json'), 'utf8'));
    const base = bases[client];
    if (!base) throw new Error('Choose roku or web');
    const files = new Map();
    for (const [path, expected] of Object.entries(base.files)) {
        const full = join(root, path);
        if ((await lstat(full)).isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`);
        const original = await readFile(full, 'utf8');
        if (hash(normalize(original)) !== expected) throw new Error(`Unsupported or edited ${client} source: ${path}. Use revision ${base.revision}. No files changed.`);
        files.set(path, { path, original, content: normalize(original) });
    }
    const edit = (path, anchor, replacement) => {
        const file = files.get(path);
        file.content = replaceOnce(file.content, anchor, replacement);
    };
    const add = async (path, payload) => {
        try { await lstat(join(root, path)); throw new Error(`Destination already exists: ${path}`); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        files.set(path, { path, original: null, content: await readFile(join(here, payload), 'utf8') });
    };
    if (client === 'web') {
        const plugin = 'src/plugins/htmlVideoPlayer/plugin.js';
        edit(plugin, "import DOMPurify from 'dompurify';", "import DOMPurify from 'dompurify';\nimport { mountMtvOverlay, MTV_SETTING } from './mtvOverlay.js';");
        edit(plugin, '    async play(options) {', '    async play(options) {\n        this._disposeMtvOverlay?.();');
        edit(plugin, '        this._currentPlayOptions = options;', '        this._currentPlayOptions = options;\n        this._disposeMtvOverlay?.();\n        this._disposeMtvOverlay = mountMtvOverlay(elem, options, appSettings.get(MTV_SETTING) === \'true\');');
        edit(plugin, '    destroy() {', '    destroy() {\n        this._disposeMtvOverlay?.();\n        this._disposeMtvOverlay = null;');
        edit(plugin, '    stop(destroyPlayer) {', '    stop(destroyPlayer) {\n        this._disposeMtvOverlay?.();\n        this._disposeMtvOverlay = null;');
        const settings = 'src/components/playbackSettings/playbackSettings.js';
        edit(settings, "    context.querySelector('.chkEnableNextVideoOverlay').checked = userSettings.enableNextVideoInfoOverlay();", "    context.querySelector('.chkEnableNextVideoOverlay').checked = userSettings.enableNextVideoInfoOverlay();\n    context.querySelector('.chkVidarrMtvOverlay').checked = appSettings.get('vidarrMtvOverlay') === 'true';");
        edit(settings, "    userSettingsInstance.enableNextVideoInfoOverlay(context.querySelector('.chkEnableNextVideoOverlay').checked);", "    userSettingsInstance.enableNextVideoInfoOverlay(context.querySelector('.chkEnableNextVideoOverlay').checked);\n    appSettings.set('vidarrMtvOverlay', context.querySelector('.chkVidarrMtvOverlay').checked ? 'true' : 'false');");
        edit('src/components/playbackSettings/playbackSettings.template.html', '        <div class="checkboxContainer checkboxContainer-withDescription fldEnableNextVideoOverlay">', '        <div class="checkboxContainer checkboxContainer-withDescription">\n            <label>\n                <input type="checkbox" is="emby-checkbox" class="chkVidarrMtvOverlay" />\n                <span>MTV music video overlay</span>\n            </label>\n            <div class="fieldDescription checkboxFieldDescription">Show MTV and song metadata during the first and last six seconds. Applies to this web client.</div>\n        </div>\n\n        <div class="checkboxContainer checkboxContainer-withDescription fldEnableNextVideoOverlay">');
        await add('src/plugins/htmlVideoPlayer/mtvOverlay.js', 'web/mtvOverlay.js');
    } else {
        const player = 'components/video/VideoPlayerView.bs';
        edit(player, 'sub init()\n', 'sub init()\n    m.mtvOverlay = m.top.findNode("mtvOverlay")\n    m.mtvOverlay.enabled = chainLookupReturn(m.global.session, "user.settings.`playback.mtvOverlay`", false)\n');
        edit(player, '    m.top.content = videoContent[0].content', '    m.mtvOverlay.state = "buffering"\n    m.mtvOverlay.item = {}\n    m.top.content = videoContent[0].content\n    m.mtvOverlay.item = videoContent[0].mtvItem');
        edit(player, 'sub onPositionChanged()\n', 'sub onPositionChanged()\n    updateMtvOverlay()\n');
        edit(player, 'sub onState(msg)\n', 'sub onState(msg)\n    updateMtvOverlay()\n');
        files.get(player).content += '\n\n\' Forward scalar playback fields only; no child-to-parent node reference cycle.\nsub updateMtvOverlay()\n    m.mtvOverlay.setFields({ position: m.top.position, duration: m.top.duration, state: m.top.state })\nend sub\n';
        edit('components/video/VideoPlayerView.xml', '    <Group id="captionGroup" translation="[0,0]" />', '    <MtvOverlay id="mtvOverlay" />\n    <Group id="captionGroup" translation="[0,0]" />');
        edit('components/ItemGrid/LoadVideoContentTask.bs', '    video.runtimeticks = meta.json.RunTimeTicks', '    video.mtvItem = { Type: meta.json.Type, Name: meta.json.Name, Artists: meta.json.Artists, ArtistItems: meta.json.ArtistItems, AlbumArtist: meta.json.AlbumArtist, Album: meta.json.Album, ProductionYear: meta.json.ProductionYear, RunTimeTicks: meta.json.RunTimeTicks }\n    video.runtimeticks = meta.json.RunTimeTicks');
        const settings = files.get('settings/settings.json');
        const tree = JSON.parse(settings.content);
        const playback = tree.find(section => section.title === 'Playback');
        if (!playback) throw new Error('Playback settings group missing');
        playback.children.unshift({ title: 'MTV music video overlay', description: 'Show MTV and song metadata during the first and last six seconds of music videos.', settingName: 'playback.mtvOverlay', type: 'bool', default: 'false' });
        settings.content = JSON.stringify(tree, null, 2) + '\n';
        await add('components/video/MtvOverlay.xml', 'roku/MtvOverlay.xml');
        await add('components/video/MtvOverlay.bs', 'roku/MtvOverlay.bs');
        await add('source/utils/mtvOverlayLogic.bs', 'roku/mtvOverlayLogic.bs');
    }
    return [...files.values()];
}

async function existingState(root) {
    try { return JSON.parse(await readFile(join(root, stateName), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function install(client, root, dryRun = false) {
    root = resolve(root);
    const existing = await existingState(root);
    if (existing) {
        if (existing.client !== client) throw new Error('Another client integration is installed here');
        await verifyInstalled(root, existing);
        return 'Already installed';
    }
    const plan = await planInstall(client, root);
    if (dryRun) return `Compatible: ${plan.length} files would change`;
    const state = { client, files: plan.map(file => ({ path: file.path, original: file.original, installedHash: hash(file.content) })) };
    // Keep recovery information before mutation. Restore the exact original bytes on removal.
    await writeFile(join(root, stateName), JSON.stringify(state, null, 2), { flag: 'wx' });
    try {
        for (const file of plan) {
            await mkdir(dirname(join(root, file.path)), { recursive: true });
            await writeFile(join(root, file.path), file.content);
        }
    } catch (error) {
        for (const file of plan) {
            if (file.original !== null) await writeFile(join(root, file.path), file.original);
            else await unlink(join(root, file.path)).catch(e => { if (e.code !== 'ENOENT') throw e; });
        }
        await unlink(join(root, stateName));
        throw error;
    }
    return `Installed ${client}: ${plan.length} files. Build this Jellyfin client before deploying.`;
}

async function verifyInstalled(root, state, recovery = false) {
    for (const file of state.files) {
        if (resolve(root, file.path) !== join(root, file.path) || file.path.includes('..')) throw new Error('Invalid recovery path');
        let current;
        try {
            if ((await lstat(join(root, file.path))).isSymbolicLink()) throw new Error(`Refusing symbolic link: ${file.path}`);
            current = hash(await readFile(join(root, file.path), 'utf8'));
        } catch (error) {
            if (recovery && error.code === 'ENOENT' && file.original === null) continue;
            throw error;
        }
        if (recovery && file.original !== null && current === hash(file.original)) continue;
        if (current !== file.installedHash) throw new Error(`Edited installed file: ${file.path}. Preserve/reconcile changes before removing.`);
    }
}

export async function remove(root) {
    root = resolve(root);
    const state = await existingState(root);
    if (!state) return 'No installation found';
    await verifyInstalled(root, state, true);
    for (const file of state.files) {
        if (file.original === null) await unlink(join(root, file.path)).catch(error => { if (error.code !== 'ENOENT') throw error; });
        else await writeFile(join(root, file.path), file.original);
    }
    await unlink(join(root, stateName));
    return 'Removed; rebuild the Jellyfin client to deploy the restored version';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const [action, client, root, flag] = process.argv.slice(2);
    try {
        if (action === 'install' && client && root) console.log(await install(client, root, flag === '--check'));
        else if (action === 'remove' && client && !root) console.log(await remove(client));
        else throw new Error('Usage: node install.mjs install <roku|web> <source-directory> [--check] | remove <source-directory>');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
