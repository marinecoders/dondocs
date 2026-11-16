import { describe, expect, it } from 'vitest';
import { availableReviewParagraphMoveDestinations, captureReviewParagraphMove, deriveReviewParagraphMove } from '@/lib/reviewParagraphMoves';
import type { Paragraph } from '@/types/document';
const paragraphs: Paragraph[] = [
  { id:'a',text:'**A** {{unit}}',level:0,portionMarking:'CUI' },
  { id:'aa',text:'Child',level:1,header:'Keep heading' },
  { id:'aaa',text:'Grandchild',level:2,referenceId:'reference' },
  { id:'b',text:'B',level:0 }, { id:'bb',text:'B child',level:1 },
  { id:'c',text:'C',level:0 }, { id:'d',text:'D',level:0 },
];
describe('paragraph move derivation', () => {
  it('moves complete nested subtrees using stable IDs without changing native objects', () => {
    const result=deriveReviewParagraphMove(paragraphs,{paragraphId:'a',destinationId:'b',placement:'after'});
    expect(result.map(p=>p.id)).toEqual(['b','bb','a','aa','aaa','c','d']);
    for(const node of result) expect(node).toBe(paragraphs.find(p=>p.id===node.id));
    expect(paragraphs.map(p=>p.id)).toEqual(['a','aa','aaa','b','bb','c','d']);
  });
  it('captures only the exact complete affected corridor', () => {
    const target=captureReviewParagraphMove(paragraphs,{paragraphId:'c',destinationId:'b',placement:'before'});
    expect(target.start).toBe(3);expect(target.before.map(p=>p.id)).toEqual(['b','bb','c']);
    expect(target.after.map(p=>p.id)).toEqual(['c','b','bb']);expect(target.before[0]).not.toBe(paragraphs[3]);
  });
  it('moves siblings under the same nested parent without reparenting children', () => {
    const nodes=[{id:'parent',text:'Parent',level:0},...paragraphs.map(p=>({...p,level:p.level+1}))];
    expect(deriveReviewParagraphMove(nodes,{paragraphId:'a',destinationId:'c',placement:'after'}).map(p=>p.id)).toEqual(['parent','b','bb','c','a','aa','aaa','d']);
  });
  it.each([
    {paragraphId:'a',destinationId:'aa',placement:'after' as const},
    {paragraphId:'aa',destinationId:'bb',placement:'before' as const},
    {paragraphId:'a',destinationId:'a',placement:'before' as const},
    {paragraphId:'absent',destinationId:'c',placement:'after' as const},
    {paragraphId:'a',destinationId:'b',placement:'before' as const},
  ])('refuses cycles, reparenting, missing identities and no-op moves: %j',intent=>{
    expect(()=>deriveReviewParagraphMove(paragraphs,intent)).toThrow();
  });
  it('refuses identity collisions',()=>{
    expect(()=>deriveReviewParagraphMove([...paragraphs,{id:'a',text:'Collision',level:0}],{paragraphId:'a',destinationId:'c',placement:'after'})).toThrow(/identit/);
  });
  it('lists exactly the authoritative moves for every small valid outline',()=>{
    function verify(levels:number[]){
      const nodes=levels.map((level,index)=>({id:`p-${index}`,text:`Paragraph ${index}`,level}));
      for(const source of nodes)for(const placement of ['before','after'] as const){
        const expected=nodes.filter(destination=>{
          try{deriveReviewParagraphMove(nodes,{paragraphId:source.id,destinationId:destination.id,placement});return true;}catch{return false;}
        });
        expect(availableReviewParagraphMoveDestinations(nodes,source.id,placement)).toEqual(expected);
      }
      if(levels.length<6)for(let level=0;level<=Math.min(2,levels.at(-1)!+1);level++)verify([...levels,level]);
    }
    verify([0]);
  });
  it('does not offer destinations without unique stable source identities',()=>{
    for(const nodes of [paragraphs,[...paragraphs,{id:'a',text:'Collision',level:0}],[...paragraphs,{text:'Missing identity',level:0}]]){
      for(const source of ['', 'missing'])expect(availableReviewParagraphMoveDestinations(nodes,source,'after')).toEqual([]);
      if(nodes!==paragraphs)expect(availableReviewParagraphMoveDestinations(nodes,'a','after')).toEqual([]);
    }
  });
});
