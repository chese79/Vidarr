import { expect, it, vi } from 'vitest';
import { confirmEligibleSearch } from '../../web/src/utils/confirmEligibleSearch.js';

it('shows the search count and submits exactly the previewed videos only after confirmation', async () => {
  const confirm = vi.fn().mockReturnValue(true);
  const search = vi.fn().mockResolvedValue({ grabbed: 1 });
  expect(await confirmEligibleSearch(async () => ({ searches: 2, videoIds: [7, 9] }), confirm, search)).toEqual({ grabbed: 1 });
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Start 2 eligible video searches'));
  expect(search).toHaveBeenCalledExactlyOnceWith([7, 9]);
});

it('does not submit searches after cancel, an empty preview, or a preview failure', async () => {
  const search = vi.fn();
  await confirmEligibleSearch(async () => ({ searches: 1, videoIds: [7] }), () => false, search);
  await confirmEligibleSearch(async () => ({ searches: 0, videoIds: [] }), () => true, search);
  const confirm = vi.fn();
  await expect(confirmEligibleSearch(async () => { throw new Error('Offline'); }, confirm, search)).rejects.toThrow('Offline');
  expect(confirm).not.toHaveBeenCalled();
  expect(search).not.toHaveBeenCalled();
});
