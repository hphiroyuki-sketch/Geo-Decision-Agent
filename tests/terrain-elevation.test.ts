import {expect,it} from 'vitest';
import {terrainPixel,decodeTerrarium} from '../frontend/src/lib/terrainElevation';
it('locates terrain pixels in Web Mercator and wraps the antimeridian',()=>{
 expect(terrainPixel(0,0)).toEqual({x:2048,y:2048,px:0,py:0});
 expect(terrainPixel(0,180)).toEqual(terrainPixel(0,-180));
 const japan=terrainPixel(36.286967,137.033533);
 expect(japan.x).toBe(3607);expect(japan.y).toBe(1604);
 expect(japan.px).toBeGreaterThanOrEqual(0);expect(japan.px).toBeLessThan(512);
 expect(terrainPixel(90,0).y).toBe(0);
});
it('decodes Terrarium heights in metres including below sea level',()=>{
 expect(decodeTerrarium(128,0,0)).toBe(0);
 expect(decodeTerrarium(131,232,128)).toBe(1000.5);
 expect(decodeTerrarium(127,255,0)).toBe(-1);
});
