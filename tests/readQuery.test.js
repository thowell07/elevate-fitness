import test from 'node:test';
import assert from 'node:assert/strict';
import { readQuery } from '../src/lib/readQuery.js';
test('Safari network failure retries a fresh read and returns recovered data',async()=>{
 let calls=0;const waits=[];
 const result=await readQuery(()=>({abortSignal:async()=>{calls++;return calls<3?{status:0,error:{message:'TypeError: Load failed'}}:{status:200,data:[{id:'record'}],error:null};}}),{wait:async ms=>waits.push(ms)});
 assert.equal(calls,3);assert.equal(result.data.length,1);assert.deepEqual(waits,[400,1200]);
});
test('permanent authorization errors are returned without network retries',async()=>{
 let calls=0;const result=await readQuery(()=>({abortSignal:async()=>{calls++;return {status:401,error:{message:'JWT expired'}};}}));
 assert.equal(calls,1);assert.equal(result.status,401);
});
test('hanging reads abort and stop after a bounded number of attempts',async()=>{
 let calls=0;const result=await readQuery(()=>({abortSignal:signal=>new Promise((resolve,reject)=>{calls++;signal.addEventListener('abort',()=>reject(new Error('aborted')));})}),{attempts:2,timeoutMs:5,wait:async()=>{}});
 assert.equal(calls,2);assert.match(result.error.message,/aborted/);
});
