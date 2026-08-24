import { NavLink, Route, Routes } from 'react-router-dom';
import LibraryPage from './pages/LibraryPage';
import ArtistDetailPage from './pages/ArtistDetailPage';
import QualityProfilesPage from './pages/QualityProfilesPage';
import RootFoldersPage from './pages/RootFoldersPage';
import SettingsPage from './pages/SettingsPage';
import DiscoverPage from './pages/DiscoverPage';
import LibraryConnectorsPage from './pages/LibraryConnectorsPage';
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
  { to: '/queue', label: 'Queue' },
  { to: '/history', label: 'History' },
  { to: '/quality-profiles', label: 'Quality Profiles' },
  { to: '/root-folders', label: 'Root Folders' },
  { to: '/connectors', label: 'Library Connectors' },
  { to: '/indexers', label: 'Indexers' },
  { to: '/download-clients', label: 'Download Clients' },
  { to: '/system', label: 'System / Tasks' },
  { to: '/settings', label: 'Settings' },
];

export default function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>vidarr</h1>
        <nav>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/artist/:id" element={<ArtistDetailPage />} />
          <Route path="/quality-profiles" element={<QualityProfilesPage />} />
          <Route path="/root-folders" element={<RootFoldersPage />} />
          <Route path="/discover" element={<DiscoverPage />} />
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
