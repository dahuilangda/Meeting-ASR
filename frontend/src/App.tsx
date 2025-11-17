import React, { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { JobDetailPage } from './pages/JobDetailPage';
import { UserSettingsPage } from './pages/UserSettingsPage';
import { AdminPage } from './pages/AdminPage';
import NetworkStatus from './components/NetworkStatus';
import { setupGlobalErrorHandlers, logEnvironmentInfo } from './utils/globalErrorHandlers';
import SharePage from './pages/SharePage';

const shouldLogEnvironmentInfo = process.env.REACT_APP_LOG_ENV_INFO === 'true';

// A simple component to check for auth token
function PrivateRoute({ children }: React.PropsWithChildren) {
  const isAuthenticated = localStorage.getItem('token') !== null;
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

function App() {
  const hasLoggedEnvInfoRef = useRef(false);

  useEffect(() => {
    // Setup global error handlers
    const cleanup = setupGlobalErrorHandlers();

    // Optional environment info logging for diagnostics only when explicitly enabled
    if (shouldLogEnvironmentInfo && !hasLoggedEnvInfoRef.current) {
      logEnvironmentInfo();
      hasLoggedEnvInfoRef.current = true;
    }

    return cleanup;
  }, []);

  return (
    <NetworkStatus>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/share/:shareToken" element={<SharePage />} />
          <Route
            path="/"
            element={
              <PrivateRoute>
                <DashboardPage />
              </PrivateRoute>
            }
          />
          <Route
            path="/jobs/:jobId"
            element={
              <PrivateRoute>
                <JobDetailPage />
              </PrivateRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <PrivateRoute>
                <UserSettingsPage />
              </PrivateRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <PrivateRoute>
                <AdminPage />
              </PrivateRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </NetworkStatus>
  );
}

export default App;
