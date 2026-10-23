// Optional Jellyfin HTML video player component. No media URLs or reporting hooks are changed.
export const MTV_SETTING = 'vidarrMtvOverlay';

export function overlayVisible(position, duration) {
    return Number.isFinite(position) && position >= 0
        && (!Number.isFinite(duration) || duration <= 0 || position < duration)
        && (position < 6 || (Number.isFinite(duration) && duration > 0 && position >= duration - 6));
}

const text = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 240) : '';

export function metadataLines(item) {
    if (item?.Type !== 'MusicVideo') return [];
    const artists = Array.isArray(item.Artists) ? item.Artists.slice(0, 12).map(text).filter(Boolean).join(', ').slice(0, 240) : '';
    const artistItems = Array.isArray(item.ArtistItems) ? item.ArtistItems.slice(0, 12).map(a => text(a?.Name)).filter(Boolean).join(', ').slice(0, 240) : '';
    const title = text(item.Name);
    const year = Number.isInteger(item.ProductionYear) && item.ProductionYear > 0 ? String(item.ProductionYear) : '';
    return ['MTV', artists || artistItems || text(item.AlbumArtist), title ? `“${title}”` : '', [text(item.Album), year].filter(Boolean).join(' · ')].filter(Boolean);
}

export function mountMtvOverlay(video, options, enabled) {
    const lines = metadataLines(options.item);
    if (!enabled || !lines.length || !video.parentElement) return () => {};
    const doc = video.ownerDocument;
    const panel = doc.createElement('div');
    panel.className = 'vidarrMtvOverlay';
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    // Inline styles keep the optional component independent of the client's theme pipeline.
    panel.style.cssText = 'position:absolute;left:5%;bottom:8%;max-width:75%;padding:12px 18px;color:white;background:rgba(0,0,0,.62);border-left:4px solid white;font:clamp(14px,2.2vw,32px)/1.25 sans-serif;text-shadow:1px 1px 2px black;pointer-events:none;z-index:5;box-sizing:border-box;overflow:hidden;';
    lines.forEach((line, index) => {
        const row = doc.createElement('div');
        row.textContent = line;
        row.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        if (index === 0) row.style.fontWeight = '900';
        panel.appendChild(row);
    });
    video.parentElement.appendChild(panel);
    let started = false;
    let stopped = false;
    const update = event => {
        if (event?.type === 'playing') { started = true; stopped = false; }
        if (['ended', 'error', 'emptied', 'loadstart'].includes(event?.type)) { started = false; stopped = true; }
        const offset = Number.isFinite(options.transcodingOffsetTicks) ? options.transcodingOffsetTicks / 10000000 : 0;
        const position = video.currentTime + offset;
        const ticks = options.mediaSource?.RunTimeTicks || options.item?.RunTimeTicks;
        const duration = Number.isFinite(ticks) && ticks > 0 ? ticks / 10000000 : (offset === 0 ? video.duration : NaN);
        panel.hidden = !started || stopped || !overlayVisible(position, duration);
    };
    const events = ['playing', 'pause', 'waiting', 'seeking', 'seeked', 'timeupdate', 'durationchange', 'ended', 'error', 'emptied', 'loadstart'];
    events.forEach(name => video.addEventListener(name, update));
    return () => {
        events.forEach(name => video.removeEventListener(name, update));
        panel.remove();
    };
}
