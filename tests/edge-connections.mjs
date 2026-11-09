// Exercise the actual canvas routing with a recording context, without a browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require = createRequire(import.meta.url);
const url = (s) => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
const d3 = JSON.stringify(pathToFileURL(require.resolve('d3-geo')).href);
const projectionURL = url(fs.readFileSync(new URL('../lib/projection.js', import.meta.url), 'utf8').replace("'d3-geo'", d3));
const utilURL = url(fs.readFileSync(new URL('../lib/util.js', import.meta.url), 'utf8'));
const source = fs.readFileSync(new URL('../lib/paint.js', import.meta.url), 'utf8')
  .replace("'d3-geo'", d3).replace("'./projection'", JSON.stringify(projectionURL)).replace("'./util'", JSON.stringify(utilURL));
const {P, arcPts, geoRoad, hitTest} = await import(url(source));
const {makeProjection} = await import(projectionURL);
P.projection = makeProjection().projection;
P.W = P.H = 100000; P.T = {k: .02, x: 500, y: 500};
P.ctx = {beginPath(){},moveTo(){},lineTo(){},stroke(){}};
const item = {kind:'netl'};
const a = {sx:100,sy:100}, b = {sx:900,sy:100};
const split = [[[100,100],[150,100],[200,100]], [[800,100],[850,100],[900,100]]];
P.T = {k:1,x:0,y:0};
geoRoad(split,a,3,b,3,2,'black',1,item);
assert.equal(P.roadHits.length,1);
assert.equal(P.roadHits[0].pts.length,2);
assert.equal(hitTest(175,100).item,item);
assert.equal(hitTest(825,100).item,item);
assert.equal(hitTest(825,100).edgeContinuation,true);
assert.equal(hitTest(500,100),null, 'No invisible bridge across the map');
P.roadHits=[];
geoRoad(split,a,150,b,3,2,'black',1,item);
assert.equal(P.roadHits[0].pts.length,1,'A covered segment must not hide the opposite continuation');
assert.equal(hitTest(825,100).item,item);
assert.deepEqual(split[0][0],[100,100],'Cached paths must not be mutated');
let crossings=0;
for(let lng=-170;lng<180;lng+=10){
 const segments=arcPts(lng,25,lng+30,40);
 if(segments.length>1)crossings++;
 for(const s of segments)assert(s.length>1 && s.flat().every(Number.isFinite));
}
assert(crossings>0);
console.log('PASS: seam splitting, both-half hit testing, no bridge, covered endpoint, immutable paths');
