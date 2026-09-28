import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import LibraryPage from './pages/LibraryPage';
import ArtistDetailPage from './pages/ArtistDetailPage';
import QualityProfilesPage from './pages/QualityProfilesPage';
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

const NAV_ITEMS = [
  { to: '/', label: 'Library', end: true },
  { to: '/calendar', label: 'Calendar' },
  { to: '/discover', label: 'Discover' },
  { to: '/match-review', label: 'Match Review' },
  { to: '/video-review', label: 'Video Review' },
  { to: '/import', label: 'Import' },
  { to: '/playlists', label: 'Playlists' },
  { to: '/queue', label: 'Queue' },
  { to: '/history', label: 'History' },
];

const SETTINGS_NAV_ITEMS = [
  { to: '/settings', label: 'General' },
  { to: '/quality-profiles', label: 'Quality Profiles' },
  { to: '/root-folders', label: 'Root Folders' },
  { to: '/connectors', label: 'Library Connectors' },
  { to: '/indexers', label: 'Indexers' },
  { to: '/download-clients', label: 'Download Clients' },
  { to: '/system', label: 'System / Tasks' },
];

export default function App() {
  const location = useLocation();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>vidarr</h1>
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
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/artist/:id" element={<ArtistDetailPage />} />
          <Route path="/quality-profiles" element={<QualityProfilesPage />} />
          <Route path="/root-folders" element={<RootFoldersPage />} />
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/match-review" element={<MatchReviewPage />} />
          <Route path="/video-review" element={<VideoReviewPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/playlists" element={<PlaylistsPage />} />
          <Route path="/connectors" element={<LibraryConnectorsPage />} />
          <Route path="/indexers" element={<IndexersPage />} />
          <Route path="/download-clients" element={<DownloadClientsPage />} />
          <Route path="/queue" element={<QueuePage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/system" element={<SystemTasksPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
