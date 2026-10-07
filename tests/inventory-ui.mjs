// Synthetic browser acceptance test. Run after npm run build; no live backend calls.
import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
await mkdir('tmp',{recursive:true,mode:0o700})
import {setTimeout as delay} from 'node:timers/promises'
const server=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--local','--config','dist/bastet_console/wrangler.json','--persist-to','tmp/inventory-ui-browser','--env-file','tests/fixtures/worker.env','--ip','127.0.0.1','--port','5174','--inspector-port','0','--show-interactive-dev-session=false'],{stdio:'ignore'})
for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:5174')).ok)break}catch{}await delay(250)}
const browser=await chromium.launch({headless:true})
const page=await browser.newPage({viewport:{width:1440,height:1100}})
const errors=[];page.on('pageerror',e=>errors.push(e.message))
const time=new Date().toISOString()
const fixture={configured:true,campaigns:[{id:'c1',name:'Synthetic program',role:'owner'}],deployments:[{id:'d1',campaign_id:'c1',name:'Example web app',environment:'production'}],assets:[],fingerprints:[{id:'f1',deployment_id:'d1',campaign_id:'c1',component_id:'next',release_id:'r1',name:'next',ecosystem:'npm',version:'14.2.8',presence:'present',source_key:'manifest',confidence:1,method:'manifest',observed_at:time,evidence:{artifact:'synthetic'},configuration:{},recorded_by:'owner'}],cohorts:[{component_id:'next',name:'next',ecosystem:'npm',release_id:'r1',version:'14.2.8',deployments:12,campaigns:3,newest_observation:time}],assessments:[{id:'a1',campaign_id:'c1',deployment_id:'d1',component_id:'next',advisory_id:'TEST-2026-1',summary:'Synthetic version-range advisory',match_state:'affected_version',input_hash:'hash',rationale:[{version:'14.2.8',source_key:'manifest',confidence:1}],review:null}],tasks:[],alerts:[{id:'1',campaign_id:'c1',kind:'component.changed',created_at:time,data:{version:'14.2.8'}}],health:[{name:'osv',status:'healthy',last_success_at:time,detail:'3 package queries; 0 failures'}],truncated:[]}
const posts=[]
await page.addInitScript(()=>localStorage.setItem('auth_token','synthetic'))
await page.route('**/api/auth/verify',r=>r.fulfill({json:{valid:true,user:{id:'owner',name:'Test User',email:'test@example.test'}}}))
await page.route('**/api/inventory*',async r=>{if(r.request().method()==='POST'){posts.push(r.request().postDataJSON());await r.fulfill({json:{success:true,result:{id:'job1',state:'ready'}}})}else await r.fulfill({json:fixture})})
try{
 await page.goto('http://127.0.0.1:5174/inventory')
 await page.getByRole('button',{name:'Research release'}).waitFor()
 await page.screenshot({path:'tmp/inventory-desktop.png',fullPage:true})
 await page.getByRole('button',{name:'Research release'}).click()
 await page.getByLabel('Source repository').fill('https://github.com/example/synthetic')
 await page.getByLabel('Full source commit').fill('a'.repeat(40))
 await page.getByLabel('Research hypothesis').fill('Inspect synthetic parsing behavior')
 await page.getByRole('button',{name:'Queue research'}).click()
 await page.getByRole('heading',{name:'Research next 14.2.8'}).waitFor({state:'hidden'})
 assert.equal(posts[0].action,'research');assert.equal(posts[0].release_id,'r1')
 await page.setViewportSize({width:390,height:844})
 await page.evaluate(()=>window.scrollTo(0,0))
 await page.screenshot({path:'tmp/inventory-mobile.png',fullPage:true})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false)
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({browser:'passed',researchSubmission:'passed',mobileOverflow:false}))
}catch(error){console.log(JSON.stringify({errors,body:(await page.locator('body').innerText()).slice(0,4000)}));await page.screenshot({path:'tmp/inventory-failure.png',fullPage:true});throw error}finally{await browser.close();server.kill('SIGTERM')}
