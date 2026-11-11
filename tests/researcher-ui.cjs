const {selectResearchFilters}=require('./ui-helpers.cjs');
const assert=require('node:assert/strict');const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE=process.env.TEST_BASE_URL || 'http://localhost:3124';
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true});const errors=[];
for(const [name,width,height] of [['desktop',1440,900],['mobile',390,844]]){
 const page=await browser.newPage({viewport:{width,height}});page.on('pageerror',e=>errors.push(e.message));let nets=0;page.on('request',r=>{if(/\/net\/s/.test(r.url()))nets++});
 await page.addInitScript(()=>{window.mapText=[];const p=CanvasRenderingContext2D.prototype,fill=p.fillText,rect=p.fillRect;p.fillText=function(s,...a){if(this.canvas.id==='map')window.mapText.push(s);return fill.call(this,s,...a)};p.fillRect=function(...a){if(this.canvas.id==='map'&&a[0]===0&&a[1]===0)window.mapText=[];return rect.apply(this,a)}});
 await page.goto(BASE+'/#s3105:world',{waitUntil:'networkidle'});await page.getByRole('button',{name:'Researchers',exact:true}).waitFor();assert.equal(await page.getByRole('checkbox').count(),0);assert.equal(nets,0,'Default must not fetch researcher networks');assert.equal(await page.getByRole('button',{name:'Institutions',exact:true}).getAttribute('aria-pressed'),'true');
 await selectResearchFilters(page,'career');await page.getByRole('heading',{name:'Career h-index',exact:true}).waitFor();await page.waitForTimeout(500);
 assert.equal(await page.getByRole('heading',{name:'Leading countries',exact:true}).count(),0);assert(!await page.evaluate(()=>window.mapText.includes('United States')));
 await page.screenshot({path:`/tmp/research-${name}-career.png`});
 await selectResearchFilters(page,'frontier');await page.getByRole('heading',{name:'Recent impact',exact:true}).waitFor();await page.waitForTimeout(500);assert(page.url().includes('~frontier'));await page.screenshot({path:`/tmp/research-${name}-frontier.png`});
 await page.locator('#panel .rows .rowb').first().click();await page.getByRole('button',{name:'Show all researchers'}).waitFor();await page.getByRole('button',{name:'Show all researchers'}).click();
 await page.reload({waitUntil:'networkidle'});await page.getByRole('heading',{name:'Recent impact',exact:true}).waitFor();
 await page.getByRole('button',{name:'Institutions',exact:true}).click();await page.getByRole('heading',{name:'Leading countries',exact:true}).waitFor();
 console.log(name,'default opt-in, clean layers, career/frontier, selection, deep link, return: PASS');await page.close();
}
const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));await p.route('**/frontier/s3105.json',r=>r.fulfill({status:503,body:'unavailable'}));await p.goto(BASE+'/#s3105:world',{waitUntil:'networkidle'});await selectResearchFilters(p,'frontier');await p.getByRole('button',{name:'Retry',exact:true}).waitFor();await p.unroute('**/frontier/s3105.json');await p.getByRole('button',{name:'Retry',exact:true}).click();await p.getByRole('heading',{name:'Recent impact',exact:true}).waitFor();console.log('error + retry: PASS');
await p.getByRole('button',{name:'Institutions',exact:true}).click();await p.goto(BASE+'/#s1702:world',{waitUntil:'networkidle'});await p.route('**/frontier/s1702.json',r=>r.fulfill({status:404,body:'missing'}));await selectResearchFilters(p,'frontier');await p.getByText('No eligible researchers are available', {exact:false}).waitFor();console.log('missing snapshot: PASS');
await browser.close();assert.deepEqual(errors,[]);console.log('No runtime errors');})();
