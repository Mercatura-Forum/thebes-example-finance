import { Routes, Route } from 'react-router-dom'
import { MemphisGate } from '@thebes/sdk'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { AccountPage } from './pages/Account'
import { Budgets } from './pages/Budgets'

// Separate pages under one shell: dashboard / account detail / budgets.
export function App() {
  return (
    <MemphisGate appName="Ledger" tagline="Sign in to your on-chain finances.">
      <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/a/:id" element={<AccountPage />} />
        <Route path="/budgets" element={<Budgets />} />
        <Route path="*" element={<Dashboard />} />
      </Route>
    </Routes>
    </MemphisGate>
  )
}
