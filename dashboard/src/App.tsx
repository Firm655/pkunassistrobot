import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { Spinner } from '@/components/ui';
import AppLayout from '@/layouts/AppLayout';
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import NotProvisionedPage from '@/pages/NotProvisionedPage';
import DashboardPage from '@/pages/DashboardPage';
import PatientsPage from '@/pages/PatientsPage';
import PatientFormPage from '@/pages/PatientFormPage';
import PatientProfilePage from '@/pages/PatientProfilePage';
import AlertsPage from '@/pages/AlertsPage';
import HistoryPage from '@/pages/HistoryPage';
import CheckInsPage from '@/pages/CheckInsPage';
import DevicesPage from '@/pages/DevicesPage';
import SettingsPage from '@/pages/SettingsPage';
import CalendarPage from '@/pages/CalendarPage';


function RequireCaregiver({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <div className="center-screen"><Spinner /></div>;
  if (state.status === 'signed-out') return <Navigate to="/login" replace state={{ from: location }} />;
  if (state.status !== 'ready') return <NotProvisionedPage />;
  return <>{children}</>;
}

function LegacyMessagesRedirect() {
  const location = useLocation();
  return <Navigate to={`/check-ins${location.search}`} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route element={<RequireCaregiver><AppLayout /></RequireCaregiver>}>
              <Route index element={<DashboardPage />} />
              <Route path="patients" element={<PatientsPage />} />
              <Route path="patients/new" element={<PatientFormPage />} />
              <Route path="patients/:id" element={<PatientProfilePage />} />
              <Route path="patients/:id/edit" element={<PatientFormPage />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="alerts" element={<AlertsPage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="check-ins" element={<CheckInsPage />} />
              <Route path="messages" element={<LegacyMessagesRedirect />} />
              <Route path="devices" element={<DevicesPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
