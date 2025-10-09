import { useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ModeProvider } from './contexts/ModeContext'
import { LaunchScreen } from './components/LaunchScreen'
import { WelcomeScreen } from './components/WelcomeScreen'
import { AuthPage } from './pages/AuthPage'
import { LandingPage } from './pages/LandingPage'
import { EventConfirmation } from './pages/EventConfirmation'
import { SettingsPage } from './pages/SettingsPage'
import { AccountPage } from './pages/AccountPage'
import { SubscriptionPage } from './pages/SubscriptionPage'
import type { ParsedEvent } from './services/openai'
import type { Database } from './lib/supabase'
import { DatabaseService } from './services/database'
import './styles/theme.css'

type Page = 'landing' | 'settings' | 'account' | 'subscription' | 'eventConfirmation'
type Event = Database['public']['Tables']['events']['Row']

function AppContent() {
  const { user, loading: authLoading } = useAuth()
  const [stage, setStage] = useState<'launch' | 'auth' | 'welcome' | 'landing'>('launch')
  const [userName, setUserName] = useState('User')
  const [currentPage, setCurrentPage] = useState<Page>('landing')
  const [extractedEvents, setExtractedEvents] = useState<ParsedEvent[]>([])
  const LAUNCH_DURATION = 2500
  const WELCOME_DURATION = 3200
  const skipLaunch = sessionStorage.getItem('skipLaunchOnce') === '1'

  useEffect(() => {
    if (authLoading) return
    if (skipLaunch) {
      sessionStorage.removeItem('skipLaunchOnce')
      if (user) setStage('welcome')
      else setStage('auth')
      return
    }
    setStage('launch')
    const t = setTimeout(() => {
      if (user) setStage('welcome')
      else setStage('auth')
    }, LAUNCH_DURATION)
    return () => clearTimeout(t)
  }, [authLoading, user])

  useEffect(() => {
    if (!user || authLoading) return
    DatabaseService.getUser(user.id)
      .then((data) => setUserName(data?.name || user.email?.split('@')[0] || 'User'))
      .catch(() => setUserName(user.email?.split('@')[0] || 'User'))
  }, [user, authLoading])

  if (authLoading)
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <div className="loading-spinner" />
      </div>
    )

  if (stage === 'launch') return <LaunchScreen />
  if (stage === 'auth') return <AuthPage />
  if (stage === 'welcome' && user)
    return <WelcomeScreen userName={userName} onComplete={() => setStage('landing')} />

  if (stage === 'landing' && user) {
    if (currentPage === 'eventConfirmation' && extractedEvents.length > 0)
      return (
        <EventConfirmation
          events={extractedEvents}
          onConfirm={() => {
            setExtractedEvents([])
            setCurrentPage('landing')
          }}
          onCancel={() => {
            setExtractedEvents([])
            setCurrentPage('landing')
          }}
        />
      )
    if (currentPage === 'settings') return <SettingsPage onNavigate={(p) => setCurrentPage(p as Page)} />
    if (currentPage === 'account') return <AccountPage onNavigate={(p) => setCurrentPage(p as Page)} />
    if (currentPage === 'subscription') return <SubscriptionPage onNavigate={(p) => setCurrentPage(p as Page)} />
    return (
      <LandingPage
        onNavigate={(p) => setCurrentPage(p as Page)}
        onDateClick={() => {}}
        onEventsExtracted={(evts) => {
          setExtractedEvents(evts)
          setCurrentPage('eventConfirmation')
        }}
      />
    )
  }

  return null
}

export default function App() {
  return (
    <AuthProvider>
      <ModeProvider>
        <AppContent />
      </ModeProvider>
    </AuthProvider>
  )
}
