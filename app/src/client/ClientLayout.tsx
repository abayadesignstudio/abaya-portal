import { Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import ClientHeader from './ClientHeader'

export default function ClientLayout() {
  const { profile, signOut } = useAuth()
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <ClientHeader email={profile?.email} onSignOut={signOut} />
      <main className="main" style={{ maxWidth: 1200, margin: '0 auto' }}><Outlet /></main>
    </div>
  )
}
