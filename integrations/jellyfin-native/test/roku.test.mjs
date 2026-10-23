import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

test('actual BrightScript timeline/metadata functions execute against boundary and missing-field cases', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'mtv-brs-'));
    try {
        const logic = await readFile(new URL('../roku/mtvOverlayLogic.bs', import.meta.url), 'utf8');
        const controller = (await readFile(new URL('../roku/MtvOverlay.bs', import.meta.url), 'utf8')).replace(/^import .*\r?\n/m, '');
        const source = logic + '\n' + controller;
        const cases = `
sub main()
    check(mtvWindow(0,100), true)
    check(mtvWindow(5.999,100), true)
    check(mtvWindow(6,100), false)
    check(mtvWindow(93.999,100), false)
    check(mtvWindow(94,100), true)
    check(mtvWindow(100,100), false)
    check(mtvWindow(-1,100), false)
    check(mtvWindow(7,10), true)
    check(mtvWindow(6,12), true)
    check(mtvWindow(3,4), true)
    check(mtvWindow(0,0), true)
    check(mtvWindow(6,0), false)
    check(mtvMetadata(invalid).eligible, false)
    check(mtvMetadata({ Type: "Movie" }).eligible, false)
    meta = mtvMetadata({ Type: "MusicVideo", Name: "Song", Artists: ["A", "B"], Album: "Album", ProductionYear: 1992, RunTimeTicks: 1000000000 })
    check(meta.eligible, true)
    check(meta.artist, "A, B")
    check(meta.title, chr(34) + "Song" + chr(34))
    check(meta.details, "Album / 1992")
    check(meta.duration, 100)
    meta = mtvMetadata({ Type: "MusicVideo", ArtistItems: [{Name: "Credited artist"}], AlbumArtist: "Fallback" })
    check(meta.artist, "Credited artist")
    check(meta.title, "")
    check(meta.details, "")
    meta = mtvMetadata({ Type: "MusicVideo", Artists: [invalid, {}], AlbumArtist: "Fallback", RunTimeTicks: "wrong" })
    check(meta.artist, "Fallback")
    check(meta.duration, 0)
    m.panel = { visible: false }
    m.metadata = { eligible: true, duration: 100 }
    m.top = { enabled: true, state: "buffering", position: 0, duration: 100 }
    m.started = false
    updateOverlay()
    check(m.panel.visible, false)
    m.top.state = "playing"
    updateOverlay()
    check(m.panel.visible, true)
    m.top.state = "paused"
    updateOverlay()
    check(m.panel.visible, true)
    m.top.state = "buffering"
    updateOverlay()
    check(m.panel.visible, true)
    m.top.position = 6
    updateOverlay()
    check(m.panel.visible, false)
    m.top.position = 94
    updateOverlay()
    check(m.panel.visible, true)
    m.top.state = "stopped"
    updateOverlay()
    check(m.panel.visible, false)
    m.top.state = "buffering"
    updateOverlay()
    check(m.panel.visible, false)
    m.top.state = "playing"
    m.top.enabled = false
    updateOverlay()
    check(m.panel.visible, false)
    m.top.enabled = true
    m.top.findNode = function(id as string) as object
        return { text: "" }
    end function
    m.top.item = {}
    setItem()
    updateOverlay()
    check(m.panel.visible, false)
    m.top.state = "buffering"
    m.top.item = { Type: "MusicVideo", Name: "Next" }
    setItem()
    check(m.panel.visible, false)
    check(m.metadata.title, chr(34) + "Next" + chr(34))
    m.top.state = "playing"
    updateOverlay()
    check(m.panel.visible, true)
    print "MTV BRIGHTSCRIPT PASS"
end sub
sub check(actual as dynamic, expected as dynamic)
    if actual <> expected
        print "MTV CHECK FAILED"; actual; expected
        stop
    end if
end sub
`;
        const path = join(temp, 'test.brs');
        await writeFile(path, source + cases);
        const require = createRequire(import.meta.url);
        const entry = require.resolve('brs/package.json');
        const cli = join(entry, '..', 'bin', 'cli.js');
        const result = spawnSync(process.execPath, [cli, '--root', temp, path], { encoding: 'utf8', timeout: 30000 });
        assert.equal(result.status, 0, result.stderr + result.stdout);
        assert.match(result.stdout, /MTV BRIGHTSCRIPT PASS/);
        assert.doesNotMatch(result.stdout + result.stderr, /FAILED|error/i);
    } finally { await rm(temp, { recursive: true, force: true }); }
});
