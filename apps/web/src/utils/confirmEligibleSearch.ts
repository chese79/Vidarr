export async function confirmEligibleSearch<T>(
  preview: () => Promise<{ videoIds: number[]; searches: number }>,
  confirm: (message: string) => boolean,
  search: (videoIds: number[]) => Promise<T>,
): Promise<T | undefined> {
  const plan = await preview();
  if (!plan.searches) {
    confirm('There are 0 eligible video searches. No searches will run.');
    return;
  }
  if (!confirm(`Start ${plan.searches.toLocaleString()} eligible video searches across the entire library? Current Library filters do not limit this action. Each video may query multiple providers and matching results may download automatically. Continue?`)) return;
  return search(plan.videoIds);
}
