const assert=require('node:assert/strict');const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const BASE=process.env.TEST_BASE_URL||'http://localhost:3124';
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true});const errors=[];
for(const [name,width,height] of [['desktop',1440,900],['mobile',390,844]]){
 const page=await browser.newPage({viewport:{width,height},colorScheme:'dark'});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(BASE+'/#harvard',{waitUntil:'networkidle'});await page.getByRole('heading',{name:'Funding & research initiatives',exact:true}).waitFor();await page.getByRole('heading',{name:'New grant commitments',exact:true}).waitFor();
 assert.equal(await page.locator('html').getAttribute('data-skin'),'b');assert.equal(await page.getByLabel('Color mode').count(),0);
 assert.equal(await page.locator('html').getAttribute('data-color-mode'),'dark');assert.equal(await page.locator('#skins').count(),0);
 await page.getByRole('heading',{name:'Grant-linked research activity',exact:true}).waitFor();await page.getByRole('button',{name:/Initiatives ·/}).click();await page.getByLabel('Multiple institutions listed').check();assert(await page.locator('.initiative-partners').count()>0);await page.getByLabel('Search initiatives').fill('zzzz-no-such-project');await page.getByText('No matching indexed initiatives.',{exact:false}).waitFor();await page.getByLabel('Search initiatives').fill('');await page.screenshot({path:`/tmp/evidence-${name}.png`});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.goto(BASE+'/#us',{waitUntil:'networkidle'});await page.getByRole('heading',{name:'Research strengths',exact:true}).waitFor();await page.locator('.strength-list button').first().waitFor();await page.getByRole('button',{name:'Subfields',exact:true}).click();await page.getByLabel('Rank country strengths').selectOption('rate');assert((await page.locator('.strength-list button strong').first().textContent()).includes('%'));await page.locator('.strength-list button').first().click();await page.waitForTimeout(1000);assert(/#s\d+:/.test(page.url()));
 await page.close();console.log(name+': single Midnight style, funding, initiatives, partnerships, country ranking/navigation PASS');
}
const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('**/institutions/*.json',r=>r.fulfill({status:503,body:'unavailable'}));await page.goto(BASE+'/#harvard',{waitUntil:'networkidle'});await page.getByRole('button',{name:'Retry',exact:true}).waitFor();await page.unroute('**/institutions/*.json');await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByRole('heading',{name:'New grant commitments',exact:true}).waitFor();
await browser.close();assert.deepEqual(errors,[]);console.log('Evidence error/retry; no runtime errors: PASS');})();
