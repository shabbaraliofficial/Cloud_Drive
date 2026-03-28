import { useSyncExternalStore } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import RegisterPage from './pages/RegisterPage'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import FolderPage from './pages/FolderPage'
import ProfilePage from './pages/ProfilePage'
import SharePage from './pages/SharePage'
import Toaster from './components/ui/Toaster'
import ThemeProvider from './context/ThemeProvider'
import { getAuthSnapshot, subscribeAuth } from './lib/auth'

function ProtectedRoute({ children }) {
  const authenticated = useSyncExternalStore(subscribeAuth, getAuthSnapshot, () => false)

  if (!authenticated) {
    return <Navigate to="/login" replace />
  }
  return children
}

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/register" replace />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/share/:token" element={<SharePage />} />
          <Route
            path="/dashboard/*"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/drive"
            element={
              <ProtectedRoute>
                <DashboardPage forcedNav="my-drive" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/recent"
            element={
              <ProtectedRoute>
                <DashboardPage forcedNav="recent" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/trash"
            element={
              <ProtectedRoute>
                <DashboardPage forcedNav="bin" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/media"
            element={
              <ProtectedRoute>
                <DashboardPage forcedNav="media" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/photos"
            element={
              <ProtectedRoute>
                <DashboardPage forcedNav="media" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/starred"
            element={
              <ProtectedRoute>
                <DashboardPage forcedNav="starred" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/storage"
            element={
              <ProtectedRoute>
                <DashboardPage forcedNav="storage" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/folder/:folderId"
            element={
              <ProtectedRoute>
                <FolderPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" />
    </ThemeProvider>
  )
}

export default App

