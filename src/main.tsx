import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { reloadOnStaleChunk } from './lib/chunkReload'

// Before anything renders: a tab left open across a deploy asks for page chunks that are gone, and one reload fixes it.
window.addEventListener('vite:preloadError', reloadOnStaleChunk)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
