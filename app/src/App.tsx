import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import SignIn from './pages/SignIn'
import StaffLayout from './staff/StaffLayout'
import StaffHome from './staff/Home'
import Projects from './staff/Projects'
import ProjectDetail from './staff/ProjectDetail'
import Time from './staff/Time'
import Employees from './staff/Employees'
import Invoices from './staff/Invoices'
import InvoiceBuilder from './staff/InvoiceBuilder'
import Proposals from './staff/Proposals'
import AgreementEditor from './staff/AgreementEditor'
import ClientUpdates from './staff/ClientUpdates'
import Bills from './staff/Bills'
import Expenses from './staff/Expenses'
import Clients from './staff/Clients'
import Settings from './staff/Settings'
import SiteEditor from './editor/SiteEditor'
import ClientLayout from './client/ClientLayout'
import ClientProject from './client/ClientProject'
import ClientInvoices from './client/ClientInvoices'
import ClientHome from './client/ClientHome'

function Gate() {
  const { session, profile, loading, signOut } = useAuth()
  if (loading) return <p style={{ padding: 40 }}>Loading…</p>
  if (!session) return <SignIn />
  if (!profile || profile.role === 'none') return (
    <div style={{ maxWidth: 520, margin: '80px auto' }} className="card pad stack">
      <h1>No access yet</h1>
      <p>{session.user.email} hasn’t been invited to the portal. Ask Abaya Design Studio to add this email address.</p>
      <button className="btn secondary" onClick={signOut}>Sign out</button>
    </div>
  )
  if (profile.role === 'client') return (
    <Routes>
      <Route element={<ClientLayout />}>
        <Route index element={<ClientHome />} />
        <Route path="projects/:id" element={<ClientProject />} />
        <Route path="invoices" element={<ClientInvoices />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  )
  return (
    <Routes>
      <Route element={<StaffLayout />}>
        <Route index element={<StaffHome />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="time" element={<Time />} />
        <Route path="employees" element={<Employees />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="invoices/new" element={<InvoiceBuilder />} />
        <Route path="invoices/:id" element={<InvoiceBuilder />} />
        <Route path="proposals" element={<Proposals />} />
        <Route path="proposals/:id" element={<AgreementEditor />} />
        <Route path="notifications" element={<ClientUpdates />} />
        <Route path="client-updates" element={<Navigate to="/notifications" />} />
        <Route path="bills" element={<Bills />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="clients" element={<Clients />} />
        <Route path="settings" element={<Settings />} />
        <Route path="site" element={<SiteEditor />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return <AuthProvider><HashRouter><Gate /></HashRouter></AuthProvider>
}
