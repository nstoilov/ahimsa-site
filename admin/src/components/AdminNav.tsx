import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export function AdminNav() {
  const { user, signOut } = useAuth()
  return (
    <header className="admin-topnav">
      <Link to="/" className="admin-brand">
        Λ H I M S Λ
      </Link>
      <nav className="admin-links">
        <Link to="/entries">Entries</Link>
      </nav>
      <div className="admin-account">
        <span className="admin-user">{user?.email}</span>
        <button className="admin-button admin-button-sm" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    </header>
  )
}
