import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';

function ArtistHeaderImage({ artistId, name }: { artistId: number; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    api.artists.image(artistId).then(blob => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => undefined);
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [artistId]);
  return <div className="artist-image">{url ? <img src={url} alt={`${name} artwork`} /> : name.charAt(0)}</div>;
}

export default function ArtistHeading({ artistId, name, badge, children }: { artistId: number; name: string; badge?: ReactNode; children?: ReactNode }) {
  return <div className="artist-heading">
    <ArtistHeaderImage artistId={artistId} name={name} />
    <div><h2>{name}{badge && <> {badge}</>}</h2>{children}</div>
  </div>;
}
