import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Initialize debug utility (registers global LIBO object and keyboard shortcut)
import '@/lib/debug'

// Enable console capture for logging
import { enableConsoleCapture } from '@/stores/logStore'
enableConsoleCapture()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
