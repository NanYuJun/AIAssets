import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { marked } from 'marked'
import './index.css'
import App from './App.jsx'

window.marked = marked

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)