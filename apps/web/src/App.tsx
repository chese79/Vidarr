import LiveClassificationPage from './pages/LiveClassificationPage';
import LiveRecordingPage from './pages/LiveRecordingPage';
import { LiveSettings } from './components/LiveControls';
import LivePage from './pages/LivePage';
import LivePerformancePage from './pages/LivePerformancePage';
import { NavLink, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { CatalogModeContext, CatalogModeSwitch, useCatalogMode } from './components/CatalogMode';
import { CATALOG_MODE_KEY, isUnfilteredScreen, parseCatalogMode, type CatalogMode } from './catalogMode';
import LibraryPage from './pages/LibraryPage';
import ArtistDetailPage from './pages/ArtistDetailPage';
import ValidationQualityPage from './pages/ValidationQualityPage';
import RootFoldersPage from './pages/RootFoldersPage';
import SettingsPage from './pages/SettingsPage';
import DiscoverPage from './pages/DiscoverPage';
import MatchReviewPage from './pages/MatchReviewPage';
import VideoReviewPage from './pages/VideoReviewPage';
import LibraryConnectorsPage from './pages/LibraryConnectorsPage';
import PlaylistsPage from './pages/PlaylistsPage';
import ImportPage from './pages/ImportPage';
import IndexersPage from './pages/IndexersPage';
import DownloadClientsPage from './pages/DownloadClientsPage';
import QueuePage from './pages/QueuePage';
import CalendarPage from './pages/CalendarPage';
import HistoryPage from './pages/HistoryPage';
import SystemTasksPage from './pages/SystemTasksPage';
import GenresPage from './pages/GenresPage';
import DownloadProgress from './components/DownloadProgress';
import { useEffect, useState } from 'react';
import { scrollContentTo } from './contentScroll';
import { QueueResultsPage } from './components/QueueResults';

const NAV_ITEMS = [
  { to: '/', label: 'Library', end: true },
  { to: '/playlists', label: 'Playlists' },
  { to: '/discover', label: 'Discover' },
  { to: '/match-review', label: 'Artist Review' },
  { to: '/video-review', label: 'Video Review' },
  { to: '/genres', label: 'Genres' },
  { to: '/queue', label: 'Queue' },
  { to: '/history', label: 'History' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/import', label: 'Import' },
];

const SETTINGS_NAV_ITEMS = [
  { to: '/settings', label: 'General' },
  { to: '/validation-quality', label: 'Validation/Quality' },
  { to: '/root-folders', label: 'Root Folders' },
  { to: '/connectors', label: 'Library Connectors' },
  { to: '/indexers', label: 'Indexers' },
  { to: '/download-clients', label: 'Download Clients' },
  { to: '/system', label: 'System / Tasks' },
];

export default function App() {
  const location = useLocation();
  const [mode, setMode] = useState<CatalogMode>(() => {
    try { return parseCatalogMode(localStorage.getItem(CATALOG_MODE_KEY) ?? (location.pathname.includes('/live') ? 'live' : null)); }
    catch { return 'musicVideos'; }
  });
  useEffect(() => { try { localStorage.setItem(CATALOG_MODE_KEY, mode); } catch { /* Session selection still works when storage is unavailable. */ } }, [mode]);
  const unfiltered = isUnfilteredScreen(location.pathname);
  useEffect(() => { scrollContentTo(0); }, [location.pathname]);
  return (
    <CatalogModeContext.Provider value={{ mode, setMode }}>
    <div className={`app-shell${mode === 'live' && !unfiltered ? ' catalog-live' : ''}`}>
      <aside className="sidebar">
        <h1 className="brand"><img src="/vidarr-rune-mark.png" alt="" /><span>VID<span className="brand-arr">ARR</span></span></h1>
        <nav aria-label="Primary">
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end}>
                  {item.label}
                </NavLink>
              </li>
            ))}
            <li>
              <details className="settings-nav" key={location.pathname} open={SETTINGS_NAV_ITEMS.some((item) => location.pathname === item.to)}>
                <summary>Settings</summary>
                <ul>
                  {SETTINGS_NAV_ITEMS.map((item) => <li key={item.to}>
                    <NavLink to={item.to}>{item.label}</NavLink>
                  </li>)}
                </ul>
              </details>
            </li>
          </ul>
        </nav>
        <DownloadProgress />
      </aside>
      <main className="content" id="main-content">
        <div className="global-catalog-bar"><CatalogModeSwitch /><HideEmptyArtists /></div>
        <Routes>
          <Route path="/" element={<CatalogLibrary />} />
          <Route path="/artist/:id" element={<ArtistCatalog />} />
          <Route path="/live" element={<CatalogLibrary />} />
          <Route path="/live/recording/:id" element={<LiveOnly><LiveRecordingPage /></LiveOnly>} />
          <Route path="/live/classification" element={<LiveOnly><LiveClassificationPage /></LiveOnly>} />
          <Route path="/live/settings" element={<LiveSettings />} />
          <Route path="/artist/:id/live" element={<ArtistCatalog />} />
          <Route path="/live/performance/:id" element={<LiveOnly><LivePerformancePage /></LiveOnly>} />
          <Route path="/genres" element={<GenresPage />} />
          <Route path="/quality-profiles" element={<Navigate to="/validation-quality" replace />} />
          <Route path="/validation-quality" element={<ValidationQualityPage />} />
          <Route path="/root-folders" element={<RootFoldersPage />} />
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/match-review" element={<MatchReviewPage />} />
          <Route path="/video-review" element={<CatalogWorkflow music={<VideoReviewPage />} />} />
          <Route path="/import" element={<CatalogWorkflow music={<ImportPage />} />} />
          <Route path="/playlists" element={<PlaylistsPage />} />
          <Route path="/connectors" element={<LibraryConnectorsPage />} />
          <Route path="/indexers" element={<IndexersPage />} />
          <Route path="/download-clients" element={<DownloadClientsPage />} />
          <Route path="/queue" element={<QueuePage />} />
          <Route path="/queue/completed" element={<QueueResultsPage section="completed" />} />
          <Route path="/queue/failures" element={<QueueResultsPage section="failures" />} />
          <Route path="/calendar" element={<CatalogWorkflow music={<CalendarPage />} />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/system" element={<SystemTasksPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
    </CatalogModeContext.Provider>
  );
}

function CatalogLibrary() {
  const { mode } = useCatalogMode();
  return <>{mode !== 'live' && <LibraryPage />}{mode !== 'musicVideos' && <section className="catalog-live"><LivePage embedded={mode === 'both'} /></section>}</>;
}
function ArtistCatalog() {
  const { mode } = useCatalogMode();
  return <>{mode !== 'live' && <ArtistDetailPage />}{mode !== 'musicVideos' && <section className="catalog-live"><LivePage embedded={mode === 'both'} /></section>}</>;
}
function CatalogWorkflow({ music }: { music: React.ReactNode }) {
  const { mode } = useCatalogMode();
  return <>{mode !== 'live' && music}{mode !== 'musicVideos' && <section className="catalog-live"><LivePage embedded={mode === 'both'} /></section>}</>;
}
function LiveOnly({ children }: { children: React.ReactNode }) {
  const { mode } = useCatalogMode();
  return mode === 'musicVideos' ? <p role="status">This entry is in Live &amp; Concerts. Select Live &amp; Concerts or Both to view it.</p> : <>{children}</>;
}
function HideEmptyArtists() {
  const { mode } = useCatalogMode();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  if (mode === 'live' || !['/', '/live'].includes(location.pathname)) return null;
  const hidden = params.get('hideWithoutVideos') !== 'false';
  return <label className={`hide-empty-artists${hidden ? ' enabled' : ''}`} title="Hide artists with 0 available, 0 known and 0 unmatched music videos">
    <input type="checkbox" checked={hidden} onChange={event => { const next = new URLSearchParams(params); next.set('hideWithoutVideos', String(event.target.checked)); next.delete('page'); setParams(next, { replace: true }); }} />
    Hide Artists w/o Videos
  </label>;
}
