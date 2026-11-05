using System.Text;

namespace Jellyfin.Plugin.Mtv;

public static class EmbeddedFont
{
 public const string ResourceName="Jellyfin.Plugin.Mtv.Fonts.kabel.ttf";
 private static readonly Lazy<string> encoded=new(()=>Encode(Bytes()));
 public static byte[] Bytes(){using var stream=typeof(EmbeddedFont).Assembly.GetManifestResourceStream(ResourceName)??throw new InvalidOperationException("Bundled Kabel font is missing");using var bytes=new MemoryStream();stream.CopyTo(bytes);return bytes.ToArray();}
 // ASS uses its own six-bit encoding (ASCII 33..96), not MIME base64 or Unix uuencode.
 public static string Encode(byte[] bytes)
 {
  var output=new StringBuilder("\n[Fonts]\nfontname: kabel.ttf\n");var column=0;
  for(var i=0;i<bytes.Length;i+=3){
   var count=Math.Min(3,bytes.Length-i);uint value=(uint)bytes[i]<<16;
   if(count>1)value|=(uint)bytes[i+1]<<8;if(count>2)value|=bytes[i+2];
   for(var j=0;j<count+1;j++){output.Append((char)(((value>>(18-j*6))&63)+33));if(++column==80){output.Append('\n');column=0;}}
  }
  if(column>0)output.Append('\n');return output.ToString();
 }
 public static string AssSection=>encoded.Value;
}
