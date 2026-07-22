import { Link } from 'react-router-dom'
import { AdminNav } from '../components/AdminNav'
import { useAuth } from '../auth/AuthContext'

export function AdminHomePage() {
  const { user } = useAuth()
  return (
    <div className="admin-app">
      <AdminNav />
      <main className="admin-main admin-home">
        <p>Signed in as {user?.email}</p>
        <Link to="/entries" className="admin-button">
          Manage entries
        </Link>
      </main>
    </div>
  )
}
