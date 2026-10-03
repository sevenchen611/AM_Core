import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createBindingStore} from '../core/line-io/binding-store.js';
import {createBindings} from '../core/line-io/bindings.js';
import {createLineIo} from '../core/line-io/index.js';

const group=`C${'a'.repeat(32)}`,user=`U${'a'.repeat(32)}`;
const id='11111111-1111-1111-1111-111111111111';
const event=(type='postback')=>({type,webhookEventId:'synthetic-event',timestamp:Date.now(),
  source:{type:'group',groupId:group,userId:user},postback:{data:'uof.list.0'}});
function deferred() {
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {promise,resolve};
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));

function mocks() {
  const row={id,status:'bound',group_id:group,user_id:user,tenant_key:'sample',client_id:'io',external_user_id:'synthetic'};
  const stats={all:0,get:0,checked:0,proof:0,suspend:0,candidate:0};
  let allHook,suspendHook,checkedHook;
  const store={
    all:async()=>{stats.all++;if(allHook)await allHook(stats.all);return row.group_id?[{...row}]:[];},
    get:async()=>{stats.get++;return {...row};},
    checked:async()=>{stats.checked++;if(checkedHook)await checkedHook();},
    suspend:async()=>{stats.suspend++;if(suspendHook)await suspendHook();row.status='suspended';},
    findCode:async()=>true,
    candidate:async()=>{stats.candidate++;row.status='pending_confirmation';row.group_id=group;},
  };
  const line={configured:true,
    lineGet:async path=>{stats.proof++;return path.endsWith('/count')?{count:1}:{groupName:'Synthetic'};},
    resolveGroupMemberName:async()=>{stats.proof++;return 'Synthetic';},
  };
  return {row,stats,store,line,setAllHook:hook=>allHook=hook,setSuspendHook:hook=>suspendHook=hook,setCheckedHook:hook=>checkedHook=hook};
}

async function binding(h) {
  return createBindings({env:{},clients:[],router:{resolveGroupBinding:async()=>({})},store:h.store,line:h.line});
}
async function gateway(h,{observe=async()=>{}}={}) {
  const appended=[];
  const clients=[{id:'io',tenantKey:'sample',tokenEnv:'TOKEN',groupIds:[],
    scopes:['groups:read','events:read','messages:write'],transportOnly:true,allowPersonalBindings:true}];
  const io=await createLineIo({env:{AMCORE_LINE_IO_ENABLED:'1',AMCORE_LINE_BINDINGS_ENABLED:'1',AMCORE_LINE_DIRECTORY_ENABLED:'1',
    TOKEN:'synthetic-token'.padEnd(40,'x'),AMCORE_LINE_IO_CLIENTS_JSON:JSON.stringify(clients)},
    tenants:[{key:'sample'}],router:{},line:h.line,bindingStore:h.store,directoryStore:{observe},
    store:{append:async records=>appended.push(...records)}});
  return {io,appended};
}

test('ordinary capture refreshes once, but member and binding mutations refresh again',async()=>{
  const h=mocks(),b=await binding(h);
  const initial=h.stats.all;
  await b.capture([event()]);
  assert.equal(h.stats.all-initial,1);
  assert.equal(h.stats.proof,0,'capture binding discovery does not replace the later fresh authorization');
  for(const type of ['memberJoined','memberLeft','leave']) {
    h.row.status='bound';
    const beforeMember=h.stats.all;
    await b.capture([event(type)]);
    assert.equal(h.stats.all-beforeMember,2);
    assert.equal(b.lookup(group).status,'suspended');
  }
  h.row.status='pending_line';h.row.group_id=null;
  const beforeCandidate=h.stats.all;
  await b.capture([{...event('message'),message:{type:'text',text:`綁定 UOF ${'a'.repeat(22)}`}}]);
  assert.equal(h.stats.all-beforeCandidate,2);
  assert.equal(h.stats.candidate,1);
  assert.equal(b.lookup(group).status,'pending_confirmation');
});

test('personal and directory capture overlap, and both must finish before fresh proof or append',{timeout:3000},async()=>{
  const h=mocks(),personalGate=deferred(),directoryGate=deferred(),personalStarted=deferred(),directoryStarted=deferred();
  const {io,appended}=await gateway(h,{observe:async()=>{directoryStarted.resolve();await directoryGate.promise;}});
  h.setAllHook(async()=>{personalStarted.resolve();await personalGate.promise;});
  const capturing=io.capture([event()]);
  await Promise.all([personalStarted.promise,directoryStarted.promise]);
  assert.equal(h.stats.proof,0);assert.equal(appended.length,0);
  personalGate.resolve();await turn();
  assert.equal(h.stats.proof,0,'directory persistence remains a barrier');
  directoryGate.resolve();await capturing;
  assert.equal(h.stats.proof,3,'incoming capture still starts all fresh LINE identity checks');
  assert.equal(h.stats.get,2,'database binding state is freshly read before and after proof');
  assert.equal(appended.length,1);
});

test('either capture failure waits for the other branch and never starts proof or appends',{timeout:3000},async t=>{
  for(const failing of ['personal','directory']) await t.test(failing,async()=>{
    const h=mocks(),gate=deferred(),otherStarted=deferred();
    const {io,appended}=await gateway(h,{observe:async()=>{
      if(failing==='directory')throw new Error('synthetic directory failure');
      otherStarted.resolve();await gate.promise;
    }});
    h.setAllHook(async()=>{
      if(failing==='personal')throw new Error('synthetic binding failure');
      otherStarted.resolve();await gate.promise;
    });
    let settled=false;
    const capturing=io.capture([event()]).then(()=>assert.fail('capture must fail'),()=>{settled=true;});
    await otherStarted.promise;await turn();
    assert.equal(settled,false,'capture does not return while independent persistence remains in flight');
    assert.equal(h.stats.proof,0);assert.equal(appended.length,0);
    gate.resolve();await capturing;
    assert.equal(settled,true);assert.equal(h.stats.proof,0);assert.equal(appended.length,0);
  });
});

test('membership suspension completes before any same-batch input can authorize',{timeout:3000},async()=>{
  const h=mocks(),suspendGate=deferred(),suspendStarted=deferred(),refreshGate=deferred(),refreshStarted=deferred();
  const {io,appended}=await gateway(h);
  h.setSuspendHook(async()=>{suspendStarted.resolve();await suspendGate.promise;});
  h.setAllHook(async count=>{if(count===3){refreshStarted.resolve();await refreshGate.promise;}});
  const capturing=io.capture([event('memberLeft'),event()]);
  await suspendStarted.promise;await turn();
  assert.equal(h.stats.proof,0);assert.equal(appended.length,0);
  suspendGate.resolve();await refreshStarted.promise;await turn();
  assert.equal(h.stats.proof,0,'the post-mutation refresh also remains an authorization barrier');
  assert.equal(appended.length,0);
  refreshGate.resolve();await capturing;
  assert.equal(h.row.status,'suspended');assert.equal(h.stats.proof,0);assert.equal(appended.length,0);
});

test('directory failure still waits for pending membership suspension before rejecting',{timeout:3000},async()=>{
  const h=mocks(),suspendGate=deferred(),suspendStarted=deferred();
  const {io,appended}=await gateway(h,{observe:async()=>{throw new Error('synthetic directory failure');}});
  h.setSuspendHook(async()=>{suspendStarted.resolve();await suspendGate.promise;});
  let settled=false;
  const capturing=io.capture([event('memberJoined'),event()]).then(()=>assert.fail('capture must fail'),()=>{settled=true;});
  await suspendStarted.promise;await turn();
  assert.equal(settled,false);assert.equal(h.stats.proof,0);assert.equal(appended.length,0);
  suspendGate.resolve();await capturing;
  assert.equal(settled,true);assert.equal(h.row.status,'suspended');
  assert.equal(h.stats.proof,0);assert.equal(appended.length,0);
});

test('revocation after provider proof still fails the final database reread and blocks append',async()=>{
  const h=mocks(),{io,appended}=await gateway(h);
  h.setCheckedHook(()=>{h.row.status='revoked';});
  await io.capture([event()]);
  assert.equal(h.stats.proof,3);assert.equal(h.stats.get,2);assert.equal(h.stats.checked,1);
  assert.equal(appended.length,0);
});

test('single-statement get returns actual expired rows rather than the old PostgreSQL statement snapshot',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(await readFile(new URL('../versions/AM-IMP-2026.0929.04/schemas/line-bindings.sql',import.meta.url),'utf8'));
  const secondId='22222222-2222-2222-2222-222222222222',boundId='33333333-3333-3333-3333-333333333333',futureId='55555555-5555-5555-5555-555555555555';
  await db.query(`INSERT INTO line_bindings.bindings(id,tenant_key,client_id,external_user_id,display_name,status,code_hash,expires_at)
    VALUES($1,'sample','io','first','Synthetic','pending_line','first-code',now()-interval '1 minute'),
      ($2,'sample','io','second','Synthetic','pending_confirmation','second-code',now()-interval '1 minute'),
      ($3,'sample','io','bound','Synthetic','bound',NULL,now()-interval '1 minute'),
      ($4,'sample','io','future','Synthetic','pending_line','future-code',now()+interval '1 hour')`,[id,secondId,boundId,futureId]);
  let calls=0;
  const store=createBindingStore({query:async(...args)=>{calls++;return db.query(...args);}});
  const expired=await store.get(id);
  assert.equal(expired.status,'expired');assert.equal(expired.code_hash,null);assert.equal(calls,1);
  const allExpired=await db.query('SELECT status,code_hash FROM line_bindings.bindings WHERE id IN ($1,$2)',[id,secondId]);
  assert.ok(allExpired.rows.every(row=>row.status==='expired'&&row.code_hash===null),'the existing global expiry side effect is preserved');
  await db.query("UPDATE line_bindings.bindings SET status='pending_confirmation',code_hash='second-code' WHERE id=$1",[secondId]);
  const expiredConfirmation=await store.get(secondId);
  assert.equal(expiredConfirmation.status,'expired');assert.equal(expiredConfirmation.code_hash,null);
  const pending=await store.get(futureId);
  assert.equal(pending.status,'pending_line');assert.equal(pending.code_hash,'future-code');
  assert.equal((await store.get(boundId)).status,'bound','bound bindings are not expired by their old pending-code deadline');
  await db.query("UPDATE line_bindings.bindings SET status='revoked' WHERE id=$1",[boundId]);
  assert.equal((await store.get(boundId)).status,'revoked','every get reads current database state');
  assert.equal(await store.get('44444444-4444-4444-4444-444444444444'),undefined);
  assert.equal(calls,6,'each get uses one SQL round trip');
});
