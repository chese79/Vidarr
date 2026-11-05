using Jellyfin.Plugin.Mtv;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
int passed=0;
void Check(bool condition,string name){if(!condition)throw new Exception("FAIL: "+name);passed++;Console.WriteLine("PASS: "+name);}
void Throws(Action action,string name){bool thrown=false;try{action();}catch{thrown=true;}Check(thrown,name);}
async Task ThrowsAsync(Func<Task> action,string name){bool thrown=false;try{await action();}catch{thrown=true;}Check(thrown,name);}
Check(OverlayCore.NextStreamIndex([0,1,4])==5,"append preserves existing sparse stream indices");
Check(OverlayCore.NextStreamIndex([])==0,"empty stream collection starts at zero");
Throws(()=>OverlayCore.NextStreamIndex([0,0]),"duplicate existing stream indices require review");
Throws(()=>OverlayCore.NextStreamIndex([-1,0]),"invalid existing stream indices require review");
Check(OverlayCore.Eligible(true,"MusicVideo",true,true),"generated music video is eligible");
foreach(var type in new[]{"Movie","Episode","Audio","Video"})Check(!OverlayCore.Eligible(true,type,true,true),type+" is never activated");
Check(!OverlayCore.Eligible(false,"MusicVideo",true,true),"disabled plugin does not activate");
Check(!OverlayCore.Eligible(true,"MusicVideo",false,true),"unselected libraries do not activate");
Check(!OverlayCore.Eligible(true,"MusicVideo",true,false),"unowned tracks do not activate");
var windows=OverlayCore.Windows(240,new());Check(windows.SequenceEqual(new[]{(0L,600L),(23400L,24000L)}),"six-second media-time windows");
Check(OverlayCore.Windows(8,new()).SequenceEqual(new[]{(0L,800L)}),"short-video windows merge");
Throws(()=>OverlayCore.Windows(double.NaN,new()),"unknown duration rejected");
Throws(()=>OverlayCore.Windows(30,new(double.NaN)),"non-finite style rejected");
Check(OverlayCore.Windows(30,new(0,0)).Count==0,"zero timings disable cues");
var ass=OverlayCore.Render(new("Artist","Song","",null,""),24,new());
Check(!ass.Contains("Unknown")&&!ass.Contains("Director:"),"missing metadata lines hidden");
Check(Regex.Matches(ass,"^Dialogue:",RegexOptions.Multiline).Count==2,"exactly two events");
var reference=OverlayCore.Render(new("Band Name Here","Song Title Here","Album Name Here",1997,"Here","Record Label Here"),24,new());
byte[] DecodeFont(string section){var payload=string.Concat(section.Split('\n').Skip(3)).Trim();var bytes=new List<byte>();for(var i=0;i<payload.Length;i+=4){var count=Math.Min(4,payload.Length-i);uint value=0;for(var j=0;j<count;j++)value|=(uint)(payload[i+j]-33)<<(18-j*6);bytes.Add((byte)(value>>16));if(count>=3)bytes.Add((byte)(value>>8));if(count>=4)bytes.Add((byte)value);}return bytes.ToArray();}
foreach(var length in new[]{1,2,3,59,60,61,62}){var bytes=Enumerable.Range(0,length).Select(x=>(byte)(x*17)).ToArray();Check(DecodeFont(EmbeddedFont.Encode(bytes)).SequenceEqual(bytes),"ASS font encoding round-trips "+length+" bytes");}
Check(DecodeFont(EmbeddedFont.AssSection).SequenceEqual(EmbeddedFont.Bytes()),"generated font payload preserves bundled font bytes");
Check(reference.Contains("[Fonts]\nfontname: kabel.ttf\n"),"sidecar carries the font independently of system installation");
Check(reference.Contains("Style: MTV,Kabel,28,"),"Kabel requested for reference typography");
Check(reference.Contains("Band Name Here\\N\"Song Title Here\"\\NAlbum Name Here - 1997\\NRecord Label Here\\NDirector/s: Here"),"reference line order, title quotes and inline album year");
Check(!Regex.IsMatch(reference,@"\\NMTV(?:\r?\n|$)"),"reference has no trailing MTV credit");
Check(!OverlayCore.Render(new("A","\"Song\"","",1997,""),24,new()).Contains("1997"),"album year never becomes a standalone line");
Check(OverlayCore.Render(new("A","\"Song\"","Album",null,""),24,new()).Contains("A\\N\"Song\"\\NAlbum")&&!OverlayCore.Render(new("A","Song","Album",null,""),24,new()).Contains("Album -"),"quotes are not doubled and missing album year leaves no suffix");
Check(!OverlayCore.Render(new("A","Song","Album",999,""),24,new()).Contains("Album -"),"invalid album year omitted");
var knownAlbum=new AlbumMetadata("Album",["Artist"],1997,"Label");
Check(OverlayCore.MatchAlbum(" album ",["ARTIST"],[knownAlbum])==knownAlbum,"album title and credited artist match ignoring case and whitespace");
Check(OverlayCore.MatchAlbum("Album",["Other"],[knownAlbum]) is null,"same-title album by another artist is excluded");
Check(OverlayCore.MatchAlbum("Album",["Artist"],[knownAlbum,knownAlbum with {Year=2000}]) is null,"ambiguous editions do not invent an album year or label");
Check(OverlayCore.MatchAlbum("Album",[],[knownAlbum]) is null&&OverlayCore.MatchAlbum("",["Artist"],[knownAlbum]) is null,"missing identity evidence cannot supply album metadata");
Check(!OverlayCore.Literal("{\\p1}\nDialog").Contains('\\')&&!OverlayCore.Literal("{\\p1}").Contains('{'),"metadata cannot inject ASS commands");
var root=Path.Combine(Path.GetTempPath(),"mtv-tests-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
var media=Path.Combine(root,"fixture.mp4");await File.WriteAllTextAsync(media,"original video bytes");
var before=Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(media)));
var store=new OwnedOverlayStore(Path.Combine(root,"plugin-data"));var id=Guid.NewGuid();
Check(await store.Write(id,media,ass,default)=="created","creates a separate ASS track");
Check(Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(media)))==before,"video bytes unchanged");
Check(await store.Write(id,media,ass,default)=="unchanged","repeat generation is idempotent");
Check(await store.Write(id,media,ass+"; metadata revision\n",default)=="updated","owned metadata revision supported");
Check(Directory.GetFiles(Path.Combine(root,"plugin-data","backups")).Length==1,"prior generated content backed up");
Check(new OwnedOverlayStore(Path.Combine(root,"plugin-data")).Valid(id),"ownership survives restart");
var track=store.Find(id)!.Path;await File.WriteAllTextAsync(track,"user edited subtitle");
await ThrowsAsync(()=>store.Write(id,media,ass,default),"edited subtitle is never overwritten");
Check(await File.ReadAllTextAsync(track)=="user edited subtitle","edited bytes retained after refusal");
await ThrowsAsync(()=>store.Write(Guid.NewGuid(),media,ass,default),"foreign same-name subtitle is protected");
Check(Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(media)))==before,"video bytes retained through all failures");
Console.WriteLine($"{passed} plugin core tests passed");
if(args.Length>0)await File.WriteAllTextAsync(args[0],reference);
