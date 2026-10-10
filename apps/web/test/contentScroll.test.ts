import { afterEach, expect, it, vi } from 'vitest';
import { contentScrollTop, scrollContentTo } from '../src/contentScroll';

afterEach(() => vi.unstubAllGlobals());
it('saves and restores the main panel position independently of the document', () => {
  const content = { scrollTop: 480, scrollTo: vi.fn() };
  const windowScroll = vi.fn();
  vi.stubGlobal('document', { getElementById: () => content });
  vi.stubGlobal('window', { scrollY: 0, scrollTo: windowScroll });
  expect(contentScrollTop()).toBe(480);
  scrollContentTo(480);
  expect(content.scrollTo).toHaveBeenCalledWith(0, 480);
  expect(windowScroll).not.toHaveBeenCalled();
});
