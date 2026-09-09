export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const MEDIA_TYPES: Record<string,string> = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4','video/webm':'webm'};
export function mediaMatchesType(bytes:Uint8Array,type:string):boolean {
  if(bytes.length<12)return false;
  const text=(a:number,b:number)=>String.fromCharCode(...bytes.slice(a,b));
  if(type==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(type==='image/png')return [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
  if(type==='image/webp')return text(0,4)==='RIFF'&&text(8,12)==='WEBP';
  if(type==='video/mp4')return text(4,8)==='ftyp';
  if(type==='video/webm')return [26,69,223,163].every((v,i)=>bytes[i]===v);
  return false;
}
