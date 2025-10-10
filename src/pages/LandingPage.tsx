import { useState } from 'react'
import { HamburgerMenu } from '../components/HamburgerMenu'
import { WeekAtAGlance } from '../components/WeekAtAGlance'
import { CalendarView } from '../components/CalendarView'
import { EventInput } from '../components/EventInput'
import type { ParsedEvent } from '../services/openai'
import './LandingPage.css'

interface LandingPageProps {
  onNavigate: (page: string) => void
  onDateClick: (date: Date) => void
  onEventsExtracted: (events: ParsedEvent[]) => void
}

export function LandingPage({ onNavigate, onDateClick, onEventsExtracted }: LandingPageProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [modalActive, setModalActive] = useState(false)

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date)
    onDateClick?.(date)
  }

  return (
    <div className="landing-page">
      {!modalActive && <HamburgerMenu onNavigate={onNavigate} />}

<div className="fullbleed">
  <CalendarView
    selectedDate={selectedDate}
    onDateSelect={setSelectedDate}
    onEventClick={() => setModalActive(true)}
    onModalClose={() => setModalActive(false)}
  />
</div>

    </div>
  )
}
