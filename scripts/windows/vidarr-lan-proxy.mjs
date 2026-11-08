import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
export function parsePort(output) {
  const bindings = JSON.parse(output)['3434/tcp'];
  const binding = bindings?.find(b => b.HostIp === '127.0.0.1');
  if (!binding || !/^\d+$/.test(binding.HostPort)) throw Error('No loopback Vidarr port');
  const port = Number(binding.HostPort);
  if (port < 1 || port > 65535) throw Error('Invalid Vidarr port');
  return port;
}

export function dockerResolver(docker) {
  let cached, expires = 0, pending;
  return async (refresh = false) => {
    if (!refresh && cached && Date.now() < expires) return cached;
    if (!pending) pending = exec(docker, ['--context', 'desktop-linux', 'inspect', '--format', '{{json .NetworkSettings.Ports}}', 'vidarr'], { timeout: 10000, windowsHide: true, maxBuffer: 65536 })
      .then(({ stdout }) => { cached = parsePort(stdout); expires = Date.now() + 3000; return cached; })
      .finally(() => { pending = undefined; });
    return pending;
  };
}

export function createProxy(resolve) {
  return net.createServer({ pauseOnConnect: true, allowHalfOpen: true }, client => {
    let upstream;
    client.on('error', () => upstream?.destroy());
    client.on('close', () => upstream?.destroy());
    const connect = port => new Promise((yes, no) => {
      const socket = net.createConnection({ host: '127.0.0.1', port, allowHalfOpen: true });
      upstream = socket;
      const timer = setTimeout(() => socket.destroy(Error('Connect timeout')), 5000);
      socket.once('connect', () => { clearTimeout(timer); socket.removeListener('error', failed); yes(socket); });
      const failed = error => { clearTimeout(timer); socket.destroy(); no(error); };
      socket.once('error', failed);
    });
    (async () => {
      let socket;
      try { socket = await connect(await resolve()); }
      catch { if (client.destroyed) return; socket = await connect(await resolve(true)); }
      if (client.destroyed) { socket.destroy(); return; }
      socket.on('error', () => client.destroy());
      socket.on('close', () => client.destroy());
      client.pipe(socket); socket.pipe(client);
      client.resume();
    })().catch(() => { upstream?.destroy(); client.destroy(); });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const docker = process.env.ProgramFiles + '\\Docker\\Docker\\resources\\bin\\docker.exe';
  const server = createProxy(dockerResolver(docker));
  server.on('error', error => {
    if (error.code === 'EADDRNOTAVAIL') setTimeout(() => server.listen(3434, '192.168.0.8'), 5000);
    else { console.error('Vidarr LAN listener:', error.code); process.exitCode = 1; }
  });
  server.listen(3434, '192.168.0.8');
}
