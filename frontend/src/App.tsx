import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { apiFetch } from '@/lib/api'
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
  const [userInfo, setUserInfo] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authOverlay, setAuthOverlay] = useState(false)
  const [authAnimating, setAuthAnimating] = useState(false)

  // 앱 시작 시 토큰 확인 및 자동 로그인
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('access_token')

      if (!token) {
        setIsLoading(false)
        return
      }

      try {
        // /api/v1/me 엔드포인트로 사용자 정보 가져오기
        const response = await apiFetch('/api/v1/me')

        if (response.ok) {
          const userData = await response.json()
          console.log("환영합니다, " + userData.name + "님!")
          setUserInfo(userData)
          setIsLoggedIn(true)
        } else {
          // 토큰이 만료되었거나 유효하지 않은 경우 로그아웃 처리
          console.log('토큰이 유효하지 않습니다. 로그아웃 처리합니다.')
          localStorage.removeItem('access_token')
          localStorage.removeItem('user_email')
          localStorage.removeItem('user_id')
          setIsLoggedIn(false)
        }
      } catch (error) {
        console.error('인증 확인 중 오류:', error)
        localStorage.removeItem('access_token')
        localStorage.removeItem('user_email')
        localStorage.removeItem('user_id')
        setIsLoggedIn(false)
      } finally {
        setIsLoading(false)
      }
    }

    checkAuth()
  }, [])

  // 로그인 처리
  const handleLogin = async () => {
    const token = localStorage.getItem('access_token')
    if (!token) return

    try {
      const response = await apiFetch('/api/v1/me')

      if (response.ok) {
        const userData = await response.json()
        setUserInfo(userData)
        // 1) 오버레이 정상 상태로 렌더 + 홈 화면 동시 렌더
        setAuthOverlay(true)
        setIsLoggedIn(true)
        // 2) 다음 프레임에서 exit 애니메이션 트리거 (CSS 트랜지션 발동)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setAuthAnimating(true)
          })
        })
        // 3) 애니메이션 완료 후 오버레이 제거
        setTimeout(() => {
          setAuthOverlay(false)
          setAuthAnimating(false)
        }, 600)
      }
    } catch (error) {
      console.error('로그인 후 사용자 정보 가져오기 실패:', error)
    }
  }

  // 로그아웃 처리
  const handleLogout = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('user_email')
    localStorage.removeItem('user_id')
    setIsLoggedIn(false)
    setUserInfo(null)
  }

  // 로딩 중일 때 표시
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">로딩 중...</p>
        </div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <SearchProvider>
      <Routes>
        {/* Public Route */}
        <Route
          path="/login"
          element={isLoggedIn ? <Navigate to="/" replace /> : <AuthPage onLogin={handleLogin} />}
        />

        {/* Protected Routes */}
        <Route
          path="/"
          element={isLoggedIn ? <MainLayout onLogout={handleLogout} userInfo={userInfo} /> : <Navigate to="/login" replace />}
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

      {/* 로그인→홈 트랜지션: auth 오버레이가 슬라이드 아웃하며 홈 화면 드러냄 */}
      {authOverlay && (
        <div className="fixed inset-0 z-50 pointer-events-none">
          <AuthPage onLogin={() => {}} exiting={authAnimating} />
        </div>
      )}
      </SearchProvider>
    </BrowserRouter>
  )
}

export default App
