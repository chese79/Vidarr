import '../loadEnv.js';
import { prisma } from '../db/client.js';
import { recoverOwnerLogin } from '../pipeline/recoverOwnerLogin.js';

async function main() {
  if (!process.argv.includes('--yes')) {
    console.error('This replaces the existing owner password and prints a generated recovery password. Library, API key and integrations are preserved. Run node dist/scripts/recoverOwnerLogin.js --yes to continue.');
    process.exitCode = 1; return;
  }
  const result = await recoverOwnerLogin();
  console.log(`Owner password reset.\nUsername: ${result.username}\nRecovery password: ${result.password}\nSign in and choose your own password under Settings → General → Owner account.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Owner recovery failed'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
