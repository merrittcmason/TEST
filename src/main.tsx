import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

const storedTheme = localStorage.getItem('theme') || 'dark';
const actualTheme = storedTheme === 'system'
  ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  : storedTheme;
document.documentElement.setAttribute('data-theme', actualTheme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
