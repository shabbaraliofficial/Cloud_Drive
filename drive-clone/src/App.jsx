import { useSyncExternalStore } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import RegisterPage from './pages/RegisterPage'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import AdminPage from './pages/AdminPage'
import AdminLoginPage from './pages/AdminLoginPage'
import FolderPage from './pages/FolderPage'
import ProfilePage from './pages/ProfilePage'
import SharePage from './pages/SharePage'
import Toaster from './components/ui/Toaster'
import ThemeProvider from './context/ThemeProvider'
import useProfile from './hooks/useProfile'
import { getAuthSnapshot, subscribeAuth } from './lib/auth'
import { getHomeRouteForRole, isAdminRole } from './lib/roleRoutes'

function RouteLoadingState({ message }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">
      {message}
    </div>
  )
}

function PublicRoute({ children }) {
  const authenticated = useSyncExternalStore(subscribeAuth, getAuthSnapshot, () => false)
  const { user, loading } = useProfile()

  if (!authenticated) {
    return children
  }

  if (loading) {
    return <RouteLoadingState message="Restoring your workspace..." />
  }

  if (user) {
    return <Navigate to={getHomeRouteForRole(user.role)} replace />
  }

  return children
}

function UserRoute({ children }) {
  const authenticated = useSyncExternalStore(subscribeAuth, getAuthSnapshot, () => false)
  const { user, loading } = useProfile()

  if (!authenticated) {
    return <Navigate to="/login" replace />
  }

  if (loading) {
    return <RouteLoadingState message="Opening your drive..." />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (isAdminRole(user.role)) {
    return <Navigate to="/admin" replace />
  }

  return children
}

function AdminRoute({ children }) {
  const authenticated = useSyncExternalStore(subscribeAuth, getAuthSnapshot, () => false)
  const { user, loading } = useProfile()

  if (!authenticated) {
    return <Navigate to="/admin/login" replace />
  }

  if (loading) {
    return <RouteLoadingState message="Verifying admin access..." />
  }

  if (!user) {
    return <Navigate to="/admin/login" replace />
  }

  if (!isAdminRole(user.role)) {
    return <Navigate to="/" replace />
  }

  return children
}

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/register"
            element={(
              <PublicRoute>
                <RegisterPage />
              </PublicRoute>
            )}
          />
          <Route
            path="/login"
            element={(
              <PublicRoute>
                <LoginPage />
              </PublicRoute>
            )}
          />
          <Route
            path="/admin/login"
            element={(
              <PublicRoute>
                <AdminLoginPage />
              </PublicRoute>
            )}
          />
          <Route path="/share/:token" element={<SharePage />} />
          <Route
            path="/"
            element={
              <UserRoute>
                <DashboardPage />
              </UserRoute>
            }
          />
          <Route
            path="/dashboard/*"
            element={
              <UserRoute>
                <DashboardPage />
              </UserRoute>
            }
          />
          <Route
            path="/drive"
            element={
              <UserRoute>
                <DashboardPage forcedNav="my-drive" />
              </UserRoute>
            }
          />
          <Route
            path="/recent"
            element={
              <UserRoute>
                <DashboardPage forcedNav="recent" />
              </UserRoute>
            }
          />
          <Route
            path="/trash"
            element={
              <UserRoute>
                <DashboardPage forcedNav="bin" />
              </UserRoute>
            }
          />
          <Route
            path="/media"
            element={
              <UserRoute>
                <DashboardPage forcedNav="media" />
              </UserRoute>
            }
          />
          <Route
            path="/photos"
            element={
              <UserRoute>
                <DashboardPage forcedNav="media" />
              </UserRoute>
            }
          />
          <Route
            path="/starred"
            element={
              <UserRoute>
                <DashboardPage forcedNav="starred" />
              </UserRoute>
            }
          />
          <Route
            path="/storage"
            element={
              <UserRoute>
                <DashboardPage forcedNav="storage" />
              </UserRoute>
            }
          />
          <Route
            path="/folder/:folderId"
            element={
              <UserRoute>
                <FolderPage />
              </UserRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <UserRoute>
                <ProfilePage />
              </UserRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminPage />
              </AdminRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" />
    </ThemeProvider>
  )
}

export default App

