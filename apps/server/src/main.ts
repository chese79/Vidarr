import './loadEnv.js';
import { buildApp } from './app.js';
import { ensureApiKey } from './pipeline/auth.js';
import { startScheduler } from './scheduler/index.js';

const app = await buildApp();

await ensureApiKey();

const port = Number(process.env.PORT ?? 3434);
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

await startScheduler();
