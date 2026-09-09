// Mapterhorn TileJSON specifies Terrarium-encoded 512px WebP tiles.
// Sample a coarse tile when the renderer cannot sample the ground beneath
// a camera that starts below the surface. Never treat it as a 10m survey DEM.
const cache = new Map<string, Promise<ImageData>>();
export function terrainPixel(lat: number, lng: number, zoom = 12) {
  const n = 2 ** zoom;
  const x = (((lng + 180) / 360) % 1 + 1) % 1 * n;
  const radians = Math.max(-85.0511287, Math.min(85.0511287, lat)) * Math.PI / 180;
  const y = Math.min(n - 1e-9, Math.max(0, (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * n));
  return {x:Math.floor(x), y:Math.floor(y), px:Math.floor((x-Math.floor(x))*512), py:Math.floor((y-Math.floor(y))*512)};
}
export function decodeTerrarium(r:number,g:number,b:number) { return r*256+g+b/256-32768; }
export async function sampleGroundElevation(lat:number,lng:number):Promise<number> {
  const p=terrainPixel(lat,lng);
  const url=`https://tiles.mapterhorn.com/12/${p.x}/${p.y}.webp`;
  let pending=cache.get(url);
  if(!pending){
    pending=(async()=>{
      const response=await fetch(url,{signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error('標高タイルを取得できませんでした。');
      const bitmap=await createImageBitmap(await response.blob(),{colorSpaceConversion:'none'});
      try {
        const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
        const context=canvas.getContext('2d',{willReadFrequently:true});
        if(!context)throw new Error('標高を読み取れませんでした。');
        context.drawImage(bitmap,0,0);return context.getImageData(0,0,canvas.width,canvas.height);
      } finally {bitmap.close();}
    })();
    cache.set(url,pending);
    if(cache.size>8)cache.delete(cache.keys().next().value!);
    pending.catch(()=>{cache.delete(url);});
  }
  const pixels=await pending;
  const x=Math.min(pixels.width-1,Math.floor(p.px*pixels.width/512));
  const y=Math.min(pixels.height-1,Math.floor(p.py*pixels.height/512));
  const i=(y*pixels.width+x)*4;
  if(pixels.data[i+3]===0)throw new Error('この場所の標高は未取得です。');
  return decodeTerrarium(pixels.data[i],pixels.data[i+1],pixels.data[i+2]);
}
