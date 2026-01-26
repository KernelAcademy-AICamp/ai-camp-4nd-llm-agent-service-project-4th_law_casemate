import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { MainLayout } from '@/components/legal/main-layout'
import { AuthPage } from '@/components/legal/auth-page'
import { HomePage } from '@/components/legal/pages/home-page'
import { DashboardPage } from '@/components/legal/pages/dashboard-page'
import { CasesPage } from '@/components/legal/pages/cases-page'
import { CaseDetailPage } from '@/components/legal/pages/case-detail-page'
import { PrecedentsPage } from '@/components/legal/pages/precedents-page'
import { EvidenceDetailPage } from '@/components/legal/pages/evidence-detail-page'
import { PrecedentDetailPage } from '@/components/legal/pages/precedent-detail-page'
import { NewCasePage } from '@/components/legal/pages/new-case-page'
import { EvidenceUploadPage } from '@/components/legal/pages/evidence-upload-page'
import { SearchProvider } from '@/contexts/search-context'
import './App.css'

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  return (
    <BrowserRouter>
      <SearchProvider>
      <Routes>
        {/* Public Route */}
        <Route
          path="/login"
          element={isLoggedIn ? <Navigate to="/" replace /> : <AuthPage onLogin={() => setIsLoggedIn(true)} />}
        />

        {/* Protected Routes */}
        <Route
          path="/"
          element={isLoggedIn ? <MainLayout onLogout={() => setIsLoggedIn(false)} /> : <Navigate to="/login" replace />}
        >
          <Route index element={<HomePage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="cases" element={<CasesPage />} />
          <Route path="cases/:id" element={<CaseDetailPage />} />
          <Route path="precedents" element={<PrecedentsPage />} />
          <Route path="precedents/:id" element={<PrecedentDetailPage />} />
          <Route path="evidence/upload" element={<EvidenceUploadPage />} />
          <Route path="evidence/:id" element={<EvidenceDetailPage />} />
          <Route path="new-case" element={<NewCasePage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </SearchProvider>
    </BrowserRouter>
  )
}

export default App
