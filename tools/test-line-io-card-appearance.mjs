import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewCards } from '../core/line-io/cards.js';

const uri = 'https://example.com/control';
const render = actions => buildReviewCards([{title:'Pending categories',actions}], 'Pending categories').contents;

test('one category card can end with a primary URI button matching category controls', () => {
  const bubble = render([{label:'Category',displayText:'Category · 2',data:'category.1'},
    {label:'Open control',uri,appearance:'primary'}]);
  assert.equal(bubble.type,'bubble');
  const [category,control] = bubble.footer.contents;
  assert.equal(control.style,'primary');
  assert.equal(control.color,category.backgroundColor);
  assert.equal(category.contents[0].color,'#FFFFFF');
  assert.deepEqual(control.action,{type:'uri',label:'Open control',uri});
});

test('wrapped URI actions honor the same palette without truncating the visible label', () => {
  const [action] = render([{label:'Open',displayText:'A complete resource name',uri,appearance:'primary'}]).footer.contents;
  assert.equal(action.backgroundColor,'#187566');
  assert.equal(action.contents[0].color,'#FFFFFF');
  assert.equal(action.contents[0].text,'A complete resource name');
  assert.deepEqual(action.action,{type:'uri',label:'Open',uri});
});

test('omitted appearance preserves existing URI, postback and disabled styles', () => {
  const actions = render([{label:'Link',uri},{label:'Action',data:'next'},
    {label:'Unavailable',disabled:true},{label:'Secondary',data:'back',appearance:'secondary'}]).footer.contents;
  assert.equal(actions[0].style,'secondary');
  assert.equal(actions[0].color,'#EAF2EF');
  assert.equal(actions[1].style,'primary');
  assert.equal(actions[1].color,'#187566');
  assert.equal(actions[2].backgroundColor,'#F0F2F4');
  assert.equal(actions[2].action,undefined);
  assert.equal(actions[3].style,'secondary');
  assert.equal(actions[3].action.type,'postback');
});

test('appearance cannot bypass bounded actions, URI validation or disabled rendering', () => {
  for (const bad of [null,true,0,{},[],'link','PRIMARY','#187566'])
    assert.throws(()=>render([{label:'Open',uri,appearance:bad}]),{code:'invalid_card_action'});
  for (const action of [
    {label:'Open',uri,style:'primary'}, {label:'Open',uri,color:'#187566'},
    {label:'Open',uri:'javascript:alert(1)',appearance:'primary'},
    {label:'Open',uri:'https://user:password@example.com',appearance:'primary'},
    {label:'Open',uri,data:'next',appearance:'primary'},
    {label:'Unavailable',disabled:true,appearance:'primary'},
    {label:'No destination',appearance:'primary'}
  ]) assert.throws(()=>render([action]),{code:'invalid_card_action'});
});
