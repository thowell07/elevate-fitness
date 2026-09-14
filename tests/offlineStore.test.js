import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineStore, isTerminalWriteError } from '../src/lib/offlineStore.js';
const memory = () => { const items = new Map(); return { getItem:key=>items.get(key)||null, setItem:(key,value)=>items.set(key,value), removeItem:key=>items.delete(key) }; };
const bundle = () => ({workoutSessions:[],plannedWorkouts:[],customExercises:[],metricScans:[],habitLogs:[],exerciseNotes:{}});
const fixture = () => {
 const data = bundle(), writes=[];
 return {data,writes,remote:{mode:'test',loadBundle:async()=>structuredClone(data),saveSession:async(_u,s)=>{ writes.push(structuredClone(s));data.workoutSessions=[s,...data.workoutSessions.filter(x=>x.id!==s.id)];},savePlannedWorkout:async(_u,p)=>{data.plannedWorkouts=[p];},saveExerciseNote:async()=>{},saveHabitLog:async()=>{}}};
};
test('offline sets survive a reload and synchronize on reconnect', async () => {
 const storage=memory(), f=fixture(); let online=true;
 const store=createOfflineStore(f.remote,{storage,online:()=>online});
 await store.loadBundle('u');online=false;
 await store.saveSession('u',{id:'s',status:'active',value:1});
 await store.saveSession('u',{id:'s',status:'completed',value:2});
 await store.flush('u');
 assert.equal(store.pending('u'),1);
 const reopened=createOfflineStore(f.remote,{storage,online:()=>online});
 assert.equal((await reopened.loadBundle('u')).workoutSessions[0].value,2);
 online=true;await reopened.flush('u');
 assert.equal(reopened.pending('u'),0);
 assert.equal(f.data.workoutSessions[0].status,'completed');
 assert.equal(f.writes.length,1);
});
test('in-flight save cannot erase a later edit or completed status', async () => {
 const storage=memory(), f=fixture();let release;let block=true;
 f.remote.saveSession=async(_u,s)=>{if(block){block=false;await new Promise(resolve=>{release=resolve;});}f.writes.push(structuredClone(s));};
 const store=createOfflineStore(f.remote,{storage,online:()=>true});
 await store.loadBundle('u');
 await store.saveSession('u',{id:'s',value:1,status:'active'});
 await store.saveSession('u',{id:'s',value:2,status:'active'});
 await store.saveSession('u',{id:'s',value:3,status:'completed'});
 release();await store.flush('u');
 assert.deepEqual(f.writes.map(s=>s.value),[1,3]);
 assert.equal(store.pending('u'),0);
});
test('failed remote writes remain pending with honest status until retry succeeds', async () => {
 const storage=memory(), f=fixture();let fail=true;const original=f.remote.saveSession;
 f.remote.saveSession=async(...args)=>{if(fail)throw new Error('network unavailable');return original(...args);};
 const store=createOfflineStore(f.remote,{storage,online:()=>true});let status;
 store.subscribe(value=>{status=value;});await store.loadBundle('u');
 await store.saveSession('u',{id:'s',value:4});await store.flush('u');
 assert.equal(store.pending('u'),1);assert.equal(status.state,'pending');
 fail=false;await store.flush('u');assert.equal(status.state,'saved');assert.equal(store.pending('u'),0);
});
test('plans synchronize before sessions that reference them', async () => {
 const storage=memory(), f=fixture();let online=false;const order=[];
 f.remote.savePlannedWorkout=async()=>order.push('plan');f.remote.saveSession=async()=>order.push('session');
 const store=createOfflineStore(f.remote,{storage,online:()=>online});
 await store.savePlannedWorkout('u',{id:'p'});await store.saveSession('u',{id:'s',plannedWorkoutId:'p'});await store.flush('u');
 online=true;await store.flush('u');assert.deepEqual(order,['plan','session']);
});
test('cache remains isolated by user and quota failure is not a successful save', async () => {
 const storage=memory(), f=fixture();const store=createOfflineStore(f.remote,{storage,online:()=>false});
 await store.saveSession('one',{id:'s'});await store.flush('one');
 assert.equal(store.pending('two'),0);
 const broken=createOfflineStore(f.remote,{storage:{getItem:()=>null,setItem:()=>{throw new Error('quota');}},online:()=>false});
 await assert.rejects(broken.saveSession('one',{id:'s'}),/Could not save on this device/);
});
test('failed first load stays unavailable until an actual read succeeds', async () => {
 const storage=memory(), f=fixture();let fail=true,status;
 f.data.workoutSessions=[{id:'existing-session'}];f.data.metricScans=[{id:'existing-scan'}];
 f.remote.loadBundle=async()=>{if(fail)throw new TypeError('Load failed');return structuredClone(f.data);};
 const store=createOfflineStore(f.remote,{storage,online:()=>true});store.subscribe(s=>status=s);
 await assert.rejects(store.loadBundle('u'),/Load failed/);
 assert.equal(store.needsRefresh(),true);assert.equal(status.readState,'error');
 await store.flush('u');
 assert.equal(status.readState,'error');assert.equal(store.needsRefresh(),true);
 fail=false;const restored=await store.loadBundle('u');
 assert.equal(restored.workoutSessions.length,1);assert.equal(restored.metricScans.length,1);
 assert.equal(status.readState,'ready');assert.equal(store.needsRefresh(),false);
});
test('cached history remains visible but stale after failed refresh and empty save retry', async () => {
 const storage=memory(), f=fixture();f.data.metricScans=[{id:'scan'}];
 const initial=createOfflineStore(f.remote,{storage,online:()=>true});await initial.loadBundle('u');
 f.remote.loadBundle=async()=>{throw new TypeError('Load failed');};
 const reopened=createOfflineStore(f.remote,{storage,online:()=>true});let status;reopened.subscribe(s=>status=s);
 const data=await reopened.loadBundle('u');assert.equal(data.metricScans.length,1);assert.equal(status.readState,'stale');
 await reopened.flush('u');assert.equal(status.readState,'stale');assert.equal(reopened.needsRefresh(),true);
});
test('a rejected write moves aside so later writes still sync', async () => {
 const storage=memory(), f=fixture();let status;
 f.remote.saveMetricScan=async()=>{throw Object.assign(new Error('invalid input syntax for type numeric: "185 lbs"'),{code:'22P02'});};
 const store=createOfflineStore(f.remote,{storage,online:()=>true});store.subscribe(s=>status=s);
 await store.loadBundle('u');
 await store.saveMetricScan('u',{id:'scan',date:'2026-09-14',weight:'185 lbs'});
 await store.saveSession('u',{id:'s',value:1});
 await store.flush('u');
 assert.equal(store.pending('u'),0);assert.equal(f.writes.length,1);
 assert.equal(store.failed('u').length,1);assert.equal(status.dead,1);assert.match(status.error,/185 lbs/);
 store.clear('u');assert.equal(store.failed('u').length,1);
 store.discardFailed('u');assert.equal(store.failed('u').length,0);assert.equal(status.dead,0);
});
test('network, auth, and row-security failures keep retrying', async () => {
 const storage=memory(), f=fixture();
 const errors=[new TypeError('Failed to fetch'),Object.assign(new Error('new row violates row-level security policy'),{code:'42501'}),Object.assign(new Error('JWT expired'),{code:'PGRST301'}),Object.assign(new Error('Service Unavailable'),{status:503})];
 let calls=0;f.remote.saveSession=async()=>{throw errors[calls++%errors.length];};
 const store=createOfflineStore(f.remote,{storage,online:()=>true});
 await store.saveSession('u',{id:'s',value:1});
 for (let i=0;i<4;i+=1) { await store.flush('u');assert.equal(store.pending('u'),1);assert.equal(store.failed('u').length,0); }
});
test('write errors are terminal only for bad data', () => {
 assert.equal(isTerminalWriteError({code:'22P02'}),true);assert.equal(isTerminalWriteError({code:'23502'}),true);assert.equal(isTerminalWriteError({code:'PGRST102'}),true);assert.equal(isTerminalWriteError({status:400}),true);
 for (const error of [{code:'42501'},{code:'42703'},{code:'42P01'},{code:'PGRST204'},{code:'PGRST301'},{status:401},{status:408},{status:429},{status:500},new TypeError('Failed to fetch'),{message:'JWT expired'}]) assert.equal(isTerminalWriteError(error),false);
});
test('repeated failures for one record keep one entry and discard removes one change', async () => {
 const storage=memory(), f=fixture();
 f.remote.saveSession=async()=>{throw Object.assign(new Error('null value in column "status"'),{code:'23502'});};
 f.remote.saveMetricScan=async()=>{throw Object.assign(new Error('bad scan'),{code:'22P02'});};
 const store=createOfflineStore(f.remote,{storage,online:()=>true});
 await store.saveSession('u',{id:'s',value:1});await store.flush('u');
 await store.saveSession('u',{id:'s',value:2});await store.flush('u');
 await store.saveMetricScan('u',{id:'scan'});await store.flush('u');
 assert.deepEqual(store.failed('u').map(op=>op.target),['s','scan']);assert.equal(store.failed('u')[0].args[0].value,2);
 store.discardFailed('u');assert.deepEqual(store.failed('u').map(op=>op.target),['s']);
});
test('a save during an in-flight account read survives in the bundle and the device cache', async () => {
 const storage=memory(), f=fixture();let started,release;
 const readStarted=new Promise(resolve=>{started=resolve;});
 f.remote.loadBundle=async()=>{const snapshot=structuredClone(f.data);started();await new Promise(resolve=>{release=resolve;});return snapshot;};
 const store=createOfflineStore(f.remote,{storage,online:()=>true});
 const loading=store.loadBundle('u');await readStarted;
 await store.saveSession('u',{id:'s',value:1,status:'active'});await store.flush('u');
 assert.equal(store.pending('u'),0);
 release();const bundle=await loading;
 assert.equal(bundle.workoutSessions[0]?.value,1);
 const cached=await createOfflineStore(f.remote,{storage,online:()=>false}).loadBundle('u');
 assert.equal(cached.workoutSessions[0]?.value,1);
});
test('a save in the lock-release window still reaches the remote', async () => {
 const storage=memory(), f=fixture();const sent=[];let store;
 f.remote.saveHabitLog=async(_u,log)=>{sent.push(log.habitId);if(sent.length===1)setTimeout(()=>{void store.saveHabitLog('u',{date:'2026-09-14',habitId:'b',completed:true});},0);};
 const withLock=async(_key,work)=>{const result=await work();await new Promise(resolve=>setTimeout(resolve,0));return result;};
 store=createOfflineStore(f.remote,{storage,online:()=>true,withLock});
 await store.saveHabitLog('u',{date:'2026-09-14',habitId:'a',completed:true});
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.deepEqual(sent,['a','b']);assert.equal(store.pending('u'),0);
});
test('an unreadable device cache is rebuilt from the account', async () => {
 const storage=memory(), f=fixture();f.data.metricScans=[{id:'scan'}];
 storage.setItem('elevate-offline-v1:u','{"bundle":{"workoutSe');
 const store=createOfflineStore(f.remote,{storage,online:()=>true});
 const data=await store.loadBundle('u');
 assert.equal(data.metricScans.length,1);assert.equal(store.pending('u'),0);
});
