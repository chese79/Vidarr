import { ActionButton } from './ButtonFeedback';
import { createContext, useContext, type ComponentProps } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { isUnfilteredScreen } from '../catalogMode';
import { CATALOG_LABELS, type CatalogMode } from '../catalogMode';

export const CatalogModeContext = createContext<{ mode: CatalogMode; setMode: (mode: CatalogMode) => void; liveEnabled?: boolean }>({ mode: 'musicVideos', setMode: () => {} });
export const useCatalogMode = () => useContext(CatalogModeContext);

export function CatalogLink({ catalog, onClick, ...props }: ComponentProps<typeof Link> & { catalog: CatalogMode }) {
  const { mode, setMode } = useCatalogMode();
  return <Link {...props} onClick={event => { onClick?.(event); if (!event.defaultPrevented && mode !== 'both') setMode(catalog); }} />;
}

export function CatalogModeSwitch() {
  const { mode, setMode, liveEnabled = true } = useCatalogMode();
  const unfiltered = isUnfilteredScreen(useLocation().pathname);
  return <div className="catalog-mode-switch" role="group" aria-label="Global media filter">
    {(Object.keys(CATALOG_LABELS) as CatalogMode[]).map(value => <ActionButton type="button" key={value}
      disabled={unfiltered || (!liveEnabled && value !== 'musicVideos')} aria-pressed={!unfiltered && mode === value} className={!unfiltered && mode === value ? '' : 'secondary'} onClick={() => setMode(value)}>{CATALOG_LABELS[value]}</ActionButton>)}
    {unfiltered && <span role="status">All categories · filter does not apply here</span>}
    {!unfiltered && !liveEnabled && <span>Live is disabled or unavailable · <Link to="/settings">General settings</Link></span>}
  </div>;
}
