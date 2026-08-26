import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { LoginPage } from './pages/LoginPage'
import { SetPasswordPage } from './pages/SetPasswordPage'
import { EntriesPage } from './pages/EntriesPage'
import { EntryFormPage } from './pages/EntryFormPage'
import { CategoriesPage } from './pages/CategoriesPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import './App.css'
// hi
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
      <Route
        path="/categories"
        element={
          <RequireAuth requireAdmin requireFullAdmin>
            <CategoriesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/analytics"
        element={
          <RequireAuth requireAdmin>
            <AnalyticsPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/entries" replace />} />
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
