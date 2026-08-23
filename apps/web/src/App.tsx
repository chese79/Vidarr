import { NavLink, Route, Routes } from 'react-router-dom';
import LibraryPage from './pages/LibraryPage';
import ArtistDetailPage from './pages/ArtistDetailPage';
import QualityProfilesPage from './pages/QualityProfilesPage';
import RootFoldersPage from './pages/RootFoldersPage';
import SettingsPage from './pages/SettingsPage';

const NAV_ITEMS = [
  { to: '/', label: 'Library', end: true },
  { to: '/quality-profiles', label: 'Quality Profiles' },
  { to: '/root-folders', label: 'Root Folders' },
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
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
