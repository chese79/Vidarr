import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { metadataLines, overlayVisible, mountMtvOverlay } from '../web/mtvOverlay.js';

test('six-second windows use the media timeline with exact boundaries', () => {
    for (const [position, duration, expected] of [
        [-1, 100, false], [0, 100, true], [5.999, 100, true], [6, 100, false],
        [93.999, 100, false], [94, 100, true], [99.999, 100, true], [100, 100, false],
        [7, 10, true], [6, 12, true], [3, 4, true], [4, 4, false],
        [0, NaN, true], [6, NaN, false], [94, Infinity, false], [5, 0, true],
        [NaN, 100, false], [Infinity, 100, false]
    ]) assert.equal(overlayVisible(position, duration), expected, `${position}/${duration}`);
});

test('metadata is music-video scoped and omits missing or malformed values', () => {
    assert.deepEqual(metadataLines({ Type: 'Movie', Name: 'No' }), []);
    assert.deepEqual(metadataLines(null), []);
    assert.deepEqual(metadataLines({ Type: 'MusicVideo' }), ['MTV']);
    assert.deepEqual(metadataLines({ Type: 'MusicVideo', Name: 'Song', Artists: ['A', 'B'], Album: 'Album', ProductionYear: 1992 }), ['MTV', 'A, B', '“Song”', 'Album · 1992']);
    assert.deepEqual(metadataLines({ Type: 'MusicVideo', ArtistItems: [{ Name: 'Credited artist' }], AlbumArtist: 'Fallback', ProductionYear: 'wrong' }), ['MTV', 'Credited artist']);
    assert.deepEqual(metadataLines({ Type: 'MusicVideo', Artists: [null, {}], AlbumArtist: 'Fallback' }), ['MTV', 'Fallback']);
});

function player(options = {}) {
    const dom = new JSDOM('<div style="position:relative"><video src="original.mp4"></video></div>');
    const video = dom.window.document.querySelector('video');
    Object.defineProperty(video, 'duration', { value: 100, configurable: true });
    const source = { item: { Type: 'MusicVideo', Name: '<img src=x onerror=alert(1)>', Artists: ['Artist'], RunTimeTicks: 1000000000 }, ...options };
    const dispose = mountMtvOverlay(video, source, true);
    return { dom, video, dispose, panel: video.parentElement.querySelector('.vidarrMtvOverlay'), event: name => video.dispatchEvent(new dom.window.Event(name)) };
}

test('pause/buffer/seek/resume/stop/error follow position, without playback mutation', () => {
    const p = player();
    assert.equal(p.panel.hidden, true);
    p.event('waiting');
    assert.equal(p.panel.hidden, true);
    p.event('playing');
    assert.equal(p.panel.hidden, false);
    p.event('pause'); p.event('waiting');
    assert.equal(p.panel.hidden, false);
    p.video.currentTime = 20; p.event('seeking');
    assert.equal(p.panel.hidden, true);
    p.video.currentTime = 95; p.event('seeked');
    assert.equal(p.panel.hidden, false);
    p.video.currentTime = 30; p.event('timeupdate');
    assert.equal(p.panel.hidden, true);
    p.video.currentTime = 2; p.event('playing');
    assert.equal(p.panel.hidden, false);
    p.event('error');
    assert.equal(p.panel.hidden, true);
    p.event('timeupdate');
    assert.equal(p.panel.hidden, true);
    p.event('playing'); p.event('ended');
    assert.equal(p.panel.hidden, true);
    assert.equal(p.video.getAttribute('src'), 'original.mp4');
    assert.equal(p.panel.querySelector('img'), null);
    assert.match(p.panel.textContent, /<img src=x/);
    p.dispose();
    assert.equal(p.video.parentElement.querySelector('.vidarrMtvOverlay'), null);
    p.event('playing');
    p.dom.window.close();
});

test('transcode offsets and runtime are original item seconds; resumed middle has no intro', () => {
    const p = player({ transcodingOffsetTicks: 950000000 });
    p.event('playing');
    assert.equal(p.panel.hidden, false);
    p.video.currentTime = 5; p.event('timeupdate');
    assert.equal(p.panel.hidden, true);
    p.dispose(); p.dom.window.close();
    const resumed = player({ transcodingOffsetTicks: 500000000 });
    resumed.event('playing');
    assert.equal(resumed.panel.hidden, true);
    resumed.dispose(); resumed.dom.window.close();
});

test('item replacement clears old metadata and disabled/non-music items create no overlay', () => {
    const p = player();
    p.event('playing'); p.event('emptied');
    assert.equal(p.panel.hidden, true);
    p.dispose();
    const dispose = mountMtvOverlay(p.video, { item: { Type: 'MusicVideo', Name: 'Next' } }, true);
    p.event('playing');
    assert.equal(p.video.parentElement.querySelectorAll('.vidarrMtvOverlay').length, 1);
    assert.doesNotMatch(p.video.parentElement.textContent, /Artist/);
    dispose();
    mountMtvOverlay(p.video, { item: { Type: 'Movie' } }, true)();
    mountMtvOverlay(p.video, { item: { Type: 'MusicVideo' } }, false)();
    assert.equal(p.video.parentElement.querySelector('.vidarrMtvOverlay'), null);
    p.dom.window.close();
});

test('unknown duration has intro only and stop cleanup removes event effects', () => {
    const p = player({ item: { Type: 'MusicVideo' } });
    Object.defineProperty(p.video, 'duration', { value: Infinity });
    p.event('playing');
    assert.equal(p.panel.hidden, false);
    p.video.currentTime = 95; p.event('timeupdate');
    assert.equal(p.panel.hidden, true);
    p.dispose(); p.dom.window.close();
});
