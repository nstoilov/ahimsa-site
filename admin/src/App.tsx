import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { LoginPage } from './pages/LoginPage'
import { SetPasswordPage } from './pages/SetPasswordPage'
import { AdminHomePage } from './pages/AdminHomePage'
import { EntriesPage } from './pages/EntriesPage'
import { EntryFormPage } from './pages/EntryFormPage'
import './App.css'

function AppRoutes() {
  const { isPasswordRecovery } = useAuth()

  if (isPasswordRecovery) {
    return (
      <Routes>
        <Route path="/set-password" element={<SetPasswordPage />} />
        <Route path="*" element={<Navigate to="/set-password" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/set-password" element={<SetPasswordPage />} />
      <Route
        path="/"
        element={
          <RequireAuth requireAdmin>
            <AdminHomePage />
          </RequireAuth>
        }
      />
      <Route
        path="/entries"
        element={
          <RequireAuth requireAdmin>
            <EntriesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/entries/new"
        element={
          <RequireAuth requireAdmin>
            <EntryFormPage />
          </RequireAuth>
        }
      />
      <Route
        path="/entries/:id/edit"
        element={
          <RequireAuth requireAdmin>
            <EntryFormPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  const { loading } = useAuth()

  if (loading) {
    return <div className="admin-loading">Loading…</div>
  }

  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  )
}
