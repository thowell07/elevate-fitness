import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineStore } from '../src/lib/offlineStore.js';
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
