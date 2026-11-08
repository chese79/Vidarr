import {expect,it} from 'vitest';
import {BoundedWorkQueue} from '../src/pipeline/boundedWork.js';
it('bounds source work, preserves FIFO, and releases slots after success and failure', async()=>{
 const queue=new BoundedWorkQueue(2);let active=0,max=0;const started:number[]=[];const releases:Array<()=>void>=[];
 const tasks=Array.from({length:5},(_,id)=>queue.run(async()=>{
  active++;max=Math.max(max,active);started.push(id);await new Promise<void>(resolve=>releases.push(resolve));active--;
  if(id===1)throw Error('Source failed');return id;
 }));
 const finished=Promise.allSettled(tasks);
 await new Promise(resolve=>setImmediate(resolve));expect(started).toEqual([0,1]);
 releases.shift()!();await new Promise(resolve=>setImmediate(resolve));expect(started).toEqual([0,1,2]);
 releases.shift()!();await new Promise(resolve=>setImmediate(resolve));expect(started).toEqual([0,1,2,3]);
 while(started.length<5||releases.length){releases.shift()?.();await new Promise(resolve=>setImmediate(resolve));}
 const results=await finished;expect(max).toBe(2);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(4);expect(results[1].status).toBe('rejected');
});
