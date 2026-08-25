export default function VideoThumb({ url }: { url: string | null }) {
  return (
    <div className="video-thumb">
      {url ? <img src={url} alt="" /> : <div className="video-thumb-placeholder" />}
    </div>
  );
}
