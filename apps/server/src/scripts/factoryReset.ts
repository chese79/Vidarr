import { factoryReset } from '../pipeline/factoryReset.js';
import { prisma } from '../db/client.js';

// CLI-only recovery tool — run with container/host shell access
// (`docker exec vidarr node dist/scripts/factoryReset.js --yes`, or
// `npm run factory-reset` in local dev), never as an HTTP route. See
// pipeline/factoryReset.ts for why, and README.md's "Recovering a lost API
// key" section for when to reach for this.
async function main() {
  if (!process.argv.includes('--yes')) {
    console.error(
      'This wipes the API key, admin username/password, and Google Sign-On config, then\n' +
        'generates a brand-new API key. Every existing browser session and script using the\n' +
        'old key stops working immediately. Re-run with --yes to actually do this:\n\n' +
        '    node dist/scripts/factoryReset.js --yes\n',
    );
    process.exitCode = 1;
    return;
  }

  const apiKey = await factoryReset();

  // eslint-disable-next-line no-console
  console.log(
    '\n[vidarr] Factory reset complete. Username/password login and Google Sign-On have been\n' +
      'cleared, and this new API key has been generated:\n\n' +
      `    ${apiKey}\n\n` +
      'Paste it into the login screen now, or open the app fresh in a browser with no stored\n' +
      "key — the one-time reveal screen is re-armed too, so it'll show this same key there as\n" +
      'well until the first successful login.\n',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
