import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const create = vm.runInNewContext(`(${source.slice(source.indexOf('function createLedgerStorage('), source.indexOf('// ── CATEGORY COLORS'))})`);
test('load failures are errors, not an empty ledger', async () => {
 const storage=create({rpc:async()=>({error:{message:'offline'}})});
 await assert.rejects(storage.load(),/offline/);await assert.rejects(storage.save({}),/Load the ledger/);
});
test('serialized writes use successive revisions and skip identical snapshots', async () => {
 const calls=[];let rev=3;
 const storage=create({rpc:async(name,args)=>{if(name==='kinkin_load_ledger')return {data:{value:{trips:[]},revision:rev}};calls.push(args);await new Promise(r=>setTimeout(r,5));assert.equal(args.p_expected_revision,rev);return {data:++rev};}});
 await storage.load();await storage.save({trips:[]});assert.equal(calls.length,0);
 await Promise.all([storage.save({trips:[1]}),storage.save({trips:[2]})]);assert.equal(calls.length,2);assert.equal(rev,5);
});
test('conflict blocks all queued and future writes', async () => {
 let writes=0;const storage=create({rpc:async(name)=>name==='kinkin_load_ledger'?{data:{value:{},revision:1}}:(writes++,{error:{code:'40001',message:'conflict'}})});
 await storage.load();const results=await Promise.allSettled([storage.save({x:1}),storage.save({x:2})]);assert.ok(results.every(r=>r.status==='rejected'));await assert.rejects(storage.save({x:3}),/Another session/);assert.equal(writes,1);
});
test('uncertain responses stop saves and never report success', async () => {
 const storage=create({rpc:async(name)=>name==='kinkin_load_ledger'?{data:{value:{},revision:1}}:{data:null}});
 await storage.load();await assert.rejects(storage.save({x:1}),/uncertain/);
});
test('database JSON key ordering does not create an unnecessary initial save', async () => {
 let writes=0;const storage=create({rpc:async(name)=>name==='kinkin_load_ledger'?{data:{value:{b:[{y:2,x:1}],a:1},revision:1}}:(writes++,{data:2})});
 await storage.load();await storage.save({a:1,b:[{x:1,y:2}]});assert.equal(writes,0);
});
test('ending a session cancels queued writes before another account can use them', async () => {
 let writes=0;
 const storage=create({rpc:async(name)=>name==='kinkin_load_ledger'?{data:{value:{},revision:1}}:(writes++,{data:2})});
 await storage.load();const pending=storage.save({x:1});storage.close();
 await assert.rejects(pending,/Session ended/);await assert.rejects(storage.save({x:2}),/Session ended/);
 await assert.rejects(storage.load(),/Session ended/);assert.equal(writes,0);
});
