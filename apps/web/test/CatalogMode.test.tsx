import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { CatalogModeContext, CatalogModeSwitch } from '../src/components/CatalogMode';

it('deselects every global category on Queue and History without changing the saved choice', () => {
  for (const path of ['/queue', '/queue/completed', '/queue/failures', '/history']) {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><CatalogModeContext.Provider value={{ mode: 'live', setMode: () => { throw new Error('Must preserve selection'); } }}><CatalogModeSwitch /></CatalogModeContext.Provider></MemoryRouter>);
    expect(html).not.toContain('aria-pressed="true"');
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(3);
    expect(html).toContain('All categories');
  }
});
