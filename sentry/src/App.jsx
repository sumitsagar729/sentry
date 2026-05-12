import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Header from './components/Header';
import IconSidebar from './components/IconSidebar';
import SecondaryNav from './components/SecondaryNav';
import Notification from './components/Notification';
import Dashboard from './pages/Dashboard';
import Configuration from './pages/Configuration';
import './styles/global.css';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <div className="app-layout">
          <Header />
          <div className="app-body">
            <IconSidebar />
            <SecondaryNav />
            <main className="main-content">
              <Routes>
                <Route path="/snlweb" element={<Dashboard />} />
                <Route path="/configuration" element={<Configuration />} />
                <Route path="*" element={<Navigate to="/snlweb" replace />} />
              </Routes>
            </main>
          </div>
          <Notification />
        </div>
      </AppProvider>
    </BrowserRouter>
  );
}
