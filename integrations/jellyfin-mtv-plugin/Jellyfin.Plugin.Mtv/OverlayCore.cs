using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Jellyfin.Plugin.Mtv;

public sealed record OverlayMetadata(string Artist,string Title,string Album,int? AlbumYear,string Director,string RecordLabel="");
public sealed record AlbumMetadata(string Name,string[] Artists,int? Year,string RecordLabel);
public sealed record OverlayStyle(double IntroSeconds=6,double OutroSeconds=6,int FontSize=28);
public static class OverlayCore
{
 public static AlbumMetadata? MatchAlbum(string name,IEnumerable<string> artists,IEnumerable<AlbumMetadata> albums)
 {
  static string Key(string text)=>Regex.Replace(text.Normalize(),@"\s+"," ").Trim().ToUpperInvariant();
  var title=Key(name);var credits=artists.Select(Key).Where(x=>x.Length>0).ToHashSet();
  if(title.Length==0||credits.Count==0)return null;
  var matches=albums.Where(x=>Key(x.Name)==title&&x.Artists.Any(a=>credits.Contains(Key(a)))).Take(2).ToArray();
  return matches.Length==1?matches[0]:null;
 }
 public static int NextStreamIndex(IEnumerable<int> indices){var all=indices.ToArray();if(all.Any(x=>x<0)||all.Distinct().Count()!=all.Length)throw new ArgumentException("Existing stream indices require review");return all.Length==0?0:checked(all.Max()+1);}
 public static bool Eligible(bool enabled,string itemType,bool inSelectedLibrary,bool hasOwnedTrack)=>enabled&&itemType=="MusicVideo"&&inSelectedLibrary&&hasOwnedTrack;
 public static string Literal(string? value) {
  var literal=Regex.Replace(new string((value??"").Normalize().Select(c=>char.IsControl(c)?' ':c=='\\'?'＼':c=='{'?'｛':c=='}'?'｝':c).ToArray()),@"\s+"," ").Trim();
  return literal[..Math.Min(180,literal.Length)];
 }
 public static List<(long Start,long End)> Windows(double duration,OverlayStyle style)
 {
  if(!double.IsFinite(duration)||duration<0.01)throw new ArgumentException("Known positive media duration required");
  if(!double.IsFinite(style.IntroSeconds)||!double.IsFinite(style.OutroSeconds)||style.IntroSeconds<0||style.OutroSeconds<0||style.IntroSeconds>60||style.OutroSeconds>60||style.FontSize<12||style.FontSize>64)throw new ArgumentException("Invalid overlay style");
  long end=(long)Math.Floor(duration*100),intro=Math.Min(end,(long)Math.Floor(style.IntroSeconds*100)),outro=Math.Max(0,end-(long)Math.Floor(style.OutroSeconds*100));
  if(intro>0&&outro<=intro)return [(0,end)];
  var windows=new List<(long,long)>();if(intro>0)windows.Add((0,intro));if(outro<end)windows.Add((outro,end));return windows;
 }
 public static string Time(long value)=>$"{value/360000}:{value/6000%60:00}:{value/100%60:00}.{value%100:00}";
 public static string Render(OverlayMetadata data,double duration,OverlayStyle style)
 {
  var album=Literal(data.Album);if(album.Length>0&&data.AlbumYear is >=1000 and <=9999)album+=" - "+data.AlbumYear.Value.ToString(CultureInfo.InvariantCulture);
  var title=Literal(data.Title).Trim('"');
  var lines=new[]{Literal(data.Artist),title.Length>0?"\""+title+"\"":"",album,Literal(data.RecordLabel),string.IsNullOrWhiteSpace(data.Director)?"":"Director/s: "+Literal(data.Director)}.Where(x=>x.Length>0);
  var header=$"[Script Info]\nTitle: MTV Music Video Info\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: MTV,Kabel,{style.FontSize},&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,1,64,64,54,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n";
  var text=string.Join(@"\N",lines);var output=new StringBuilder(header);
  foreach(var (start,end) in Windows(duration,style))output.AppendLine($"Dialogue: 0,{Time(start)},{Time(end)},MTV,,0,0,0,,{text}");
  return output.Append(EmbeddedFont.AssSection).ToString();
 }
}
