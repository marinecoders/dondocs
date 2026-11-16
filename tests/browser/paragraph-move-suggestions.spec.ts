import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { replaceParagraphText } from '../_helpers/replaceParagraphText';

test.use({serviceWorkers:'block'});test.setTimeout(180_000);
async function action(page:Page,name:string){await page.getByRole('button',{name:['Undo','Redo'].includes(name)?'Document tools':'Document actions',exact:true}).click();await page.getByRole('menuitem',{name:['Undo','Redo'].includes(name)?new RegExp(`^${name}`):name,exact:true}).click();}
async function reviews(page:Page){await action(page,'Review rounds…');return page.getByRole('dialog',{name:'Review rounds',exact:true});}
async function download(page:Page,operation:()=>Promise<unknown>){const pending=page.waitForEvent('download');await operation();return readFile((await(await pending).path())!);}
for(const theme of ['light','dark','classic'])test(`paragraph move preserves native subtree identities and discussions through return, decisions and Undo in ${theme}`,async({page,browser,baseURL},info)=>{
 const init=(appearance:string)=>{localStorage.setItem('browser-test-visitor','returning');localStorage.setItem('dondocs_ui',JSON.stringify({version:1,state:{theme:appearance,editorLayout:'scroll'}}));};
 await page.addInitScript(init,theme);await page.goto('/');
 const discussion={version:3,threads:[{id:'00000000-0000-4000-8000-000000000001',anchor:{kind:'range',paragraphId:'move-child',docType:'naval_letter',context:'Child Équipe words.',start:6,end:12},resolved:false,messages:[{id:'00000000-0000-4000-8000-000000000002',author:'Synthetic reviewer',text:'Keep discussion on this child.',createdAt:'2026-11-15T00:00:00Z'}]}]};
 const source={documentMode:'custom',documentCategory:'correspondence',docType:'naval_letter',formData:{subject:'SYNTHETIC MOVEMENT REVIEW',to:'Training Office',classLevel:'unclassified'},paragraphs:[
  {id:'move-source',text:'**Source formatted words** {{UNIT}}',level:0}, {id:'move-child',text:'Child Équipe words.',level:1},
  {id:'move-destination',text:'Destination parent.',level:0}, {id:'move-destination-child',text:'Destination child.',level:1},
  {id:'move-tail',text:'Independent original tail.',level:0}],references:[],enclosures:[],copyTos:[],distributions:[],reviewComments:discussion};
 await page.getByLabel('Import draft file').setInputFiles({name:'movement.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});
 await page.getByRole('button',{name:'Open as new document',exact:true}).click();let modal=await reviews(page);
 await modal.getByLabel('Review name',{exact:true}).fill('Stable movement baseline');await modal.getByRole('button',{name:'Start review from current draft',exact:true}).click();
 await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.',{exact:true})).toBeVisible();
 await modal.getByRole('button',{name:'Prepare reviewer copy',exact:true}).click();const copy=await download(page,()=>modal.getByRole('button',{name:'Download reviewer copy',exact:true}).click());await page.keyboard.press('Escape');
 const context=await browser.newContext({viewport:page.viewportSize()!,userAgent:await page.evaluate(()=>navigator.userAgent),serviceWorkers:'block',isMobile:!!info.project.use.isMobile,hasTouch:!!info.project.use.hasTouch});
 try{
  await context.addInitScript(init,theme);const reviewer=await context.newPage();await reviewer.goto(baseURL!);let remote=await reviews(reviewer);
  await remote.getByLabel('Import reviewer copy',{exact:true}).setInputFiles({name:'review.json',mimeType:'application/json',buffer:copy});await remote.getByRole('button',{name:'Open as new review copy',exact:true}).click();await expect(remote).toBeHidden();
  remote=await reviews(reviewer);await remote.getByLabel('Review for suggested edits',{exact:true}).selectOption({label:'Stable movement baseline'});await remote.getByLabel('Reviewer name for suggestion',{exact:true}).fill('Synthetic reviewer');
  const movement=remote.getByRole('region',{name:'Paragraph movement',exact:true});await movement.getByLabel('Reviewed paragraph to move',{exact:true}).selectOption('move-source');await movement.getByLabel('Destination sibling',{exact:true}).selectOption('move-destination');
  await expect(movement.getByRole('status')).toContainText('after “Destination parent.” with all child paragraphs.');await movement.getByRole('button',{name:'Cancel move proposal',exact:true}).click();await expect(remote.getByRole('article',{name:/^Suggestion /})).toHaveCount(0);
  for(let index=0;index<2;index++){
   await movement.getByLabel('Reviewed paragraph to move',{exact:true}).selectOption('move-source');await movement.getByLabel('Destination sibling',{exact:true}).selectOption('move-destination');await movement.getByRole('button',{name:'Add move proposal',exact:true}).click();await expect(remote.getByRole('article',{name:`Suggestion ${index+1}: Move paragraph`,exact:true})).toBeVisible();
  }
  await expect(remote.getByRole('button',{name:'Accept suggestion',exact:true})).toHaveCount(0);await remote.getByRole('button',{name:'Prepare feedback return',exact:true}).click();
  const returned=await download(reviewer,()=>remote.getByRole('button',{name:'Download feedback return',exact:true}).click());await info.attach('movement-return.json',{body:returned,contentType:'application/json'});
  const payload=JSON.parse(returned.toString('utf8'));expect(payload.proposals[0].changes[0].target.operation).toMatchObject({kind:'move-paragraph',paragraphId:'move-source',destinationId:'move-destination',placement:'after'});expect(payload).not.toHaveProperty('ownerDocumentId');
  await replaceParagraphText(page.getByRole('textbox',{name:'Paragraph 5',exact:true}),'Newer independent tail.');modal=await reviews(page);
  await modal.getByLabel('Import feedback return',{exact:true}).setInputFiles({name:'returned.json',mimeType:'application/json',buffer:returned});await modal.getByRole('button',{name:'Import reviewed feedback',exact:true}).click();await expect(modal.getByText(/Feedback imported/)).toBeVisible();await modal.getByLabel('Review for suggested edits',{exact:true}).selectOption({label:'Stable movement baseline'});
  const first=modal.getByRole('article',{name:'Suggestion 1: Move paragraph',exact:true});await expect(first).toContainText('Numbering follows the new order automatically');await first.getByRole('button',{name:'Accept suggestion',exact:true}).click();await expect(first.getByText(/· Accepted$/)).toBeVisible();
  const competing=modal.getByRole('article',{name:'Suggestion 2: Move paragraph',exact:true});await expect(competing.getByRole('button',{name:'Accept suggestion',exact:true})).toBeDisabled();await competing.getByRole('button',{name:'Reject suggestion',exact:true}).click();await expect(competing.getByText(/· Rejected$/)).toBeVisible();
  expect((await new AxeBuilder({page}).include('[role="dialog"]').analyze()).violations).toEqual([]);expect(await modal.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);await page.screenshot({path:info.outputPath(`paragraph-move-${theme}.png`),scale:'css'});await page.keyboard.press('Escape');
  const exported=async()=>JSON.parse((await download(page,()=>action(page,'Export draft (.json)'))).toString('utf8'));
  const accepted=await exported();expect(accepted.paragraphs.map((p:{id:string})=>p.id)).toEqual(['move-destination','move-destination-child','move-source','move-child','move-tail']);expect(accepted.paragraphs[2]).toEqual(source.paragraphs[0]);expect(accepted.reviewComments).toEqual(discussion);expect(accepted.paragraphs[4].text).toBe('Newer independent tail.');
  await action(page,'Undo');expect((await exported()).paragraphs.slice(0,4)).toEqual(source.paragraphs.slice(0,4));await action(page,'Redo');await page.reload();const reloaded=await exported();expect(reloaded.paragraphs).toEqual(accepted.paragraphs);expect(reloaded.reviewComments).toEqual(discussion);
  modal=await reviews(page);await modal.getByLabel('Review for suggested edits',{exact:true}).selectOption({label:'Stable movement baseline'});await expect(modal.getByRole('article',{name:'Suggestion 1: Move paragraph',exact:true}).getByText(/· Accepted$/)).toBeVisible();await modal.getByLabel('Import feedback return',{exact:true}).setInputFiles({name:'repeated.json',mimeType:'application/json',buffer:returned});await expect(modal.getByText(/This return has already been imported/)).toBeVisible();
 }finally{await context.close();}
});
