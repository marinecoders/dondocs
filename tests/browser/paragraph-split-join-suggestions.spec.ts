import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
test.use({serviceWorkers:'block',actionTimeout:15_000});test.setTimeout(180_000);
async function action(page:Page,name:string){await page.getByRole('button',{name:name==='Undo'||name==='Redo'?'Document tools':'Document actions',exact:true}).click();await page.getByRole('menuitem',{name:name==='Undo'||name==='Redo'?new RegExp(`^${name}`):name,exact:true}).click();}
async function reviews(page:Page){await action(page,'Review rounds…');return page.getByRole('dialog',{name:'Review rounds',exact:true});}
async function exported(page:Page){const waiting=page.waitForEvent('download');await action(page,'Export draft (.json)');return JSON.parse(await readFile((await(await waiting).path())!,'utf8'));}
for(const theme of ['light','dark','classic'])test(`paragraph split/join preserves formatting and discussion identities in ${theme}`,async({page},info)=>{
  await page.addInitScript(value=>{localStorage.setItem('browser-test-visitor','returning');localStorage.setItem('dondocs_ui',JSON.stringify({state:{theme:value,editorLayout:'scroll'},version:1}));},theme);await page.goto('/');
  const source={documentMode:'custom',documentCategory:'correspondence',docType:'naval_letter',formData:{subject:'FICTIONAL PARAGRAPH REVIEW',from:'Training Office',to:'Example Unit',date:'15 Nov 26',sigLast:'EXAMPLE'},
    paragraphs:[{id:'rich',text:'Before **marked words** after',level:0},{id:'middle',text:'Keep this paragraph.',level:0},{id:'join-left',text:'Équipe 😀 {{NAME}} ',level:0},{id:'join-right',text:'Second plain paragraph.',level:0}],references:[],enclosures:[],copyTos:[],distributions:[],
    reviewComments:{version:3,threads:[{id:'c84b9cb7-8a7d-4c9a-a82a-9f397a913baf',anchor:{kind:'range',paragraphId:'join-right',docType:'naval_letter',context:'Second plain paragraph.',start:0,end:6},resolved:false,messages:[{id:'c84b9cb7-8a7d-4c9a-a82a-9f397a913baa',author:'Synthetic reviewer',text:'Retain this discussion.',createdAt:'2026-11-15T00:00:00Z'}]}]}};
  // Keep the join destination plain so a known selected range remains supported.
  source.paragraphs[2].text='Équipe 😀 left ';
  await page.getByLabel('Import draft file').setInputFiles({name:'structural.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});await page.getByRole('button',{name:'Open as new document',exact:true}).click();
  let modal=await reviews(page);await modal.getByLabel('Review name',{exact:true}).fill('Structural review');await modal.getByRole('button',{name:'Start review from current draft',exact:true}).click();
  await expect(modal.getByText('Review baseline saved. Later source edits will not change this copy.',{exact:true})).toBeVisible();
  await modal.getByLabel('Review for suggested edits',{exact:true}).selectOption({label:'Structural review'});
  const panel=modal.getByRole('region',{name:'Paragraph split and join suggestions'});
  await panel.getByLabel('Reviewer name for paragraph split or join',{exact:true}).fill('Synthetic reviewer');
  await panel.getByLabel('Paragraph to split or first paragraph to join',{exact:true}).selectOption('rich');
  const caret=panel.getByLabel('Place the split in reviewed paragraph',{exact:true});await caret.focus();
  await caret.evaluate((element:HTMLTextAreaElement)=>{element.setSelectionRange(16,16);element.dispatchEvent(new Event('select',{bubbles:true}));});
  await caret.press('Shift');
  await expect(panel.getByRole('button',{name:'Add paragraph split or join suggestion',exact:true})).toBeEnabled();
  await panel.getByRole('button',{name:'Add paragraph split or join suggestion',exact:true}).click();
  const split=modal.getByRole('article',{name:'Suggestion 1: Split paragraph',exact:true});await expect(split).toBeVisible();
  await panel.getByLabel('Split or join operation',{exact:true}).selectOption('join-paragraphs');await panel.getByLabel('Paragraph to split or first paragraph to join',{exact:true}).selectOption('join-left');
  await expect(panel.getByText(/Second selected paragraph: Paragraph 4:/)).toBeVisible();await panel.getByRole('button',{name:'Add paragraph split or join suggestion',exact:true}).click();
  const join=modal.getByRole('article',{name:'Suggestion 2: Join paragraphs',exact:true});await expect(join).toBeVisible();
  await expect(modal.getByLabel('Review for suggested edits',{exact:true})).toBeEnabled();await page.keyboard.press('Escape');await expect(modal).toBeHidden();const unchanged=await exported(page);expect(unchanged.paragraphs).toEqual(source.paragraphs);
  modal=await reviews(page);await modal.getByLabel('Review for suggested edits',{exact:true}).selectOption({label:'Structural review'});
  await modal.getByRole('article',{name:'Suggestion 1: Split paragraph',exact:true}).getByRole('button',{name:'Accept suggestion',exact:true}).click();
  await modal.getByRole('article',{name:'Suggestion 2: Join paragraphs',exact:true}).getByRole('button',{name:'Accept suggestion',exact:true}).click();
  expect(await modal.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);expect((await new AxeBuilder({page}).include('[role="dialog"]').analyze()).violations).toEqual([]);
  await page.screenshot({path:info.outputPath(`paragraph-split-join-${theme}.png`),scale:'css'});await page.keyboard.press('Escape');
  const accepted=await exported(page);expect(accepted.paragraphs.map((paragraph:{text:string})=>paragraph.text)).toEqual(['Before **marked **','**words** after','Keep this paragraph.','Équipe 😀 left  Second plain paragraph.']);
  expect(accepted.paragraphs[0].id).toBe('rich');expect(accepted.paragraphs[1].id).not.toBe('rich');expect(accepted.reviewComments.threads[0].id).toBe(source.reviewComments.threads[0].id);expect(accepted.reviewComments.threads[0].anchor).toMatchObject({paragraphId:'join-right',tracking:{paragraphId:'join-left'}});expect(accepted.proposals).toBeUndefined();
  await action(page,'Undo');expect((await exported(page)).paragraphs).toHaveLength(5);await action(page,'Redo');expect((await exported(page)).paragraphs).toEqual(accepted.paragraphs);
  await page.reload();expect((await exported(page)).paragraphs).toEqual(accepted.paragraphs);await writeFile(info.outputPath(`paragraph-split-join-${theme}.json`),JSON.stringify(accepted,null,2));
});
