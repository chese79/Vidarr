import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { parsePort, createProxy } from './vidarr-lan-proxy.mjs';

test('only accepts a valid loopback binding', () => {
  assert.equal(parsePort('{"3434/tcp":[{"HostIp":"127.0.0.1","HostPort":"63931"}]}'), 63931);
  for (const ip of ['0.0.0.0', '192.168.0.8']) assert.throws(() => parsePort(JSON.stringify({'3434/tcp':[{HostIp:ip,HostPort:'3434'}]})));
  for (const port of ['', '0', '65536', 'abc']) assert.throws(() => parsePort(JSON.stringify({'3434/tcp':[{HostIp:'127.0.0.1',HostPort:port}]})));
});

async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; }
async function exchange(port, payload) {
  const client = net.createConnection({ host:'127.0.0.1', port });
  const chunks = []; client.on('data', data => chunks.push(data));
  client.end(payload); await once(client, 'close'); return Buffer.concat(chunks);
}
test('binary payload and half-close survive forwarding and target changes', {timeout:10000}, async t => {
  const first = net.createServer({allowHalfOpen:true}, socket => socket.pipe(socket));
  const second = net.createServer({allowHalfOpen:true}, socket => socket.pipe(socket));
  let target = await listen(first); const next = await listen(second);
  const proxy = createProxy(async () => target); const port = await listen(proxy);
  t.after(() => { proxy.close(); first.close(); second.close(); });
  const payload = Buffer.alloc(1024*1024); for(let i=0;i<payload.length;i++) payload[i]=i%256;
  assert.deepEqual(await exchange(port,payload),payload);
  target=next; assert.deepEqual(await exchange(port,Buffer.from('next port')),Buffer.from('next port'));
});
test('refreshes failed target before forwarding bytes exactly once', {timeout:10000}, async t => {
  let received=0, refreshed=0;
  const echo=net.createServer({allowHalfOpen:true}, socket => {socket.on('data', data => received+=data.length);socket.pipe(socket);});
  const target=await listen(echo);
  const unused=net.createServer(); const closed=await listen(unused); await new Promise(resolve=>unused.close(resolve));
  const proxy=createProxy(async refresh=>{if(refresh)refreshed++;return refresh?target:closed;});const port=await listen(proxy);
  t.after(()=>{proxy.close();echo.close();});
  assert.deepEqual(await exchange(port,Buffer.from('once')),Buffer.from('once'));assert.equal(received,4);assert.equal(refreshed,1);
});
test('resolver failure closes the client', {timeout:10000}, async t => {
  const proxy=createProxy(async()=>{throw Error('Docker unavailable');}); const port=await listen(proxy);t.after(()=>proxy.close());
  try { assert.equal((await exchange(port,Buffer.from('not sent'))).length,0); }
  catch(error) { assert.equal(error.code,'ECONNRESET'); }
});
