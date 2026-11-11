const assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const BASE=process.env.TEST_BASE_URL||'http://localhost:3124';
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true}),errors=[];
for(const [name,width,height] of [['desktop',1440,900],['mobile',390,844]]){
 const p=await b.newPage({viewport:{width,height}});p.on('pageerror',e=>errors.push(e.message));p.on('crash',()=>errors.push('Page crash'));
 await p.goto(BASE+'/#physics:cern/a3106',{waitUntil:'networkidle'});await p.locator('#panel h1').filter({hasText:'Nuclear'}).waitFor();
 // The original failure: deep zoom on the dense CERN area hid the campus entirely.
 const box=await p.locator('#map').boundingBox();await p.mouse.move(box.width*.5,name==='mobile'?350:420);
 for(let i=0;i<14;i++){await p.mouse.wheel(0,-400);await p.waitForTimeout(100)}await p.waitForTimeout(900);
 assert.match(await p.locator('#panel h1').textContent(),/Nuclear/);
 const colours=await p.locator('#map').evaluate(c=>{const x=c.getContext('2d'),values=new Set();for(let a=20;a<c.width;a+=37)for(let b=160;b<c.height*.6;b+=31){const d=x.getImageData(a,b,1,1).data;values.add([...d].join(','))}return values.size});console.log(name+' CERN sampled colours: '+colours);await p.screenshot({path:`/tmp/cern-regression-${name}.png`});assert(colours>8,'CERN canvas must retain visible content');
 await p.getByRole('button',{name:'Compare',exact:true}).click();await p.locator('.comparison-grid').waitFor();assert.match(await p.locator('.comparison-grid h3').first().textContent(),/Nuclear/);
 await p.getByRole('combobox',{name:'First entity',exact:true}).selectOption({label:'Harvard University'});assert.equal(await p.locator('.comparison-value').first().textContent(),'+9.8%');
 await p.getByLabel('Analysis measure').selectOption('funding');await p.getByLabel('Comparison currency').selectOption('JPY');assert.equal(await p.locator('.comparison-value').first().textContent(),'Not comparable');
 await p.getByLabel('Entity type').selectOption('countries');await p.getByLabel('Analysis research scope').selectOption('s3106');await p.getByRole('combobox',{name:'First entity',exact:true}).selectOption('US');await p.getByRole('combobox',{name:'Second entity',exact:true}).selectOption('CH');await p.getByLabel('Analysis measure').selectOption('impact');assert.match(await p.locator('.comparison-value').first().textContent(),/%/);
 await p.screenshot({path:`/tmp/comparison-${name}.png`});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await p.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth));
 await p.keyboard.press('Escape');await p.getByRole('button',{name:'Colour map',exact:true}).click();await p.getByRole('button',{name:'Apply colour map'}).click();await p.locator('#analysis-legend').waitFor();await p.waitForTimeout(2200);assert.match(await p.locator('#analysis-legend').textContent(),/Highly cited share/);await p.screenshot({path:`/tmp/colour-${name}.png`});
 if(name==='mobile'){await p.mouse.move(149,215);await p.waitForTimeout(100);const tip=await p.locator('#tip').innerText();assert.match(tip,/\d+\.\d+%/);await p.mouse.click(149,215);await p.waitForTimeout(2200);assert.equal(await p.locator('#panel h1').textContent(),tip.split('\n')[0])}
 await p.getByLabel('Close colour map').click();assert.equal(await p.locator('#analysis-legend').count(),0);await p.close();console.log(name+': dense CERN zoom, comparisons, missing currency, field map, responsive dialog PASS');
}
const p=await b.newPage();await p.route('**/analysis.json',r=>r.fulfill({status:503,body:'unavailable'}));await p.goto(BASE);await p.getByRole('button',{name:'Compare',exact:true}).click();await p.getByRole('button',{name:'Retry',exact:true}).waitFor();await p.unroute('**/analysis.json');await p.getByRole('button',{name:'Retry',exact:true}).click();await p.locator('.comparison-grid').waitFor();await b.close();assert.deepEqual(errors,[]);console.log('Analysis error recovery and no runtime errors PASS');})();
