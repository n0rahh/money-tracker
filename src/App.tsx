import { lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { RequireAuth } from './components/RequireAuth'
import { AddSheetProvider } from './context/AddSheetContext'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'

// Home and Login ship with the app. Every other page is a chunk of its own, fetched on its first visit behind the Suspense
// fallback in AppShell; the service worker precaches every chunk, so they open offline too. `lazy` wants a default export.
const TrendsPage = lazy(() => import('./pages/TrendsPage').then((m) => ({ default: m.TrendsPage })))
const CategoriesPage = lazy(() => import('./pages/CategoriesPage').then((m) => ({ default: m.CategoriesPage })))
const CategoryPage = lazy(() => import('./pages/CategoryPage').then((m) => ({ default: m.CategoryPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
// RecurringPage goes here the same way, with its `recurring` route below.

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AddSheetProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<RequireAuth />}>
                <Route element={<AppShell />}>
                  <Route index element={<HomePage />} />
                  <Route path="trends" element={<TrendsPage />} />
                  <Route path="categories" element={<CategoriesPage />} />
                  <Route path="category/:id" element={<CategoryPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AddSheetProvider>
      </AuthProvider>
    </ToastProvider>
  )
}
