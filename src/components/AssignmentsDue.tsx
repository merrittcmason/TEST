import { format, startOfDay, addDays } from 'date-fns';
import { useEffect, useState } from 'react';
import { DatabaseService } from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import { MODE_CONFIG } from '../contexts/ModeContext';
import type { Database } from '../lib/supabase';
import './AssignmentsDue.css';

type Event = Database['public']['Tables']['events']['Row'];

interface AssignmentsDueProps {
  onDateClick: (date: Date) => void;
}

export function AssignmentsDue({ onDateClick }: AssignmentsDueProps) {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<Event[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!user) return;

    const loadAssignments = async () => {
      try {
        const today = startOfDay(new Date());
        const futureDate = addDays(today, 30);
        const startStr = format(today, 'yyyy-MM-dd');
        const endStr = format(futureDate, 'yyyy-MM-dd');
        const events = await DatabaseService.getEvents(user.id, startStr, endStr);

        const assignmentTags = MODE_CONFIG.education.assignmentTags || [];
        const filteredAssignments = events.filter(event =>
          event.tag && (assignmentTags as readonly string[]).includes(event.tag)
        );

        const sortedAssignments = filteredAssignments.sort((a, b) => {
          const dateCompare = a.date.localeCompare(b.date);
          if (dateCompare !== 0) return dateCompare;
          if (!a.time && !b.time) return 0;
          if (!a.time) return 1;
          if (!b.time) return -1;
          return a.time.localeCompare(b.time);
        });

        setAssignments(sortedAssignments);
      } catch (error) {
        console.error('Failed to load assignments:', error);
      }
    };

    loadAssignments();
  }, [user]);

  const handleJumpToDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    onDateClick(date);
  };

  const displayedAssignments = expanded ? assignments : assignments.slice(0, 3);

  return (
    <div className="assignments-due">
      <div className="assignments-header">
        <h2 className="section-title">Assignments Due</h2>
        {assignments.length > 3 && (
          <button
            className="expand-toggle"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Show Less' : `Show All (${assignments.length})`}
          </button>
        )}
      </div>

      <div className="assignments-card">
        {assignments.length === 0 ? (
          <div className="no-assignments-message">
            No upcoming assignments
          </div>
        ) : (
          <div className="assignments-list">
            {displayedAssignments.map(assignment => (
              <div key={assignment.id} className="assignment-item">
                <div className="assignment-info">
                  <div className="assignment-name">{assignment.name}</div>
                  <div className="assignment-meta">
                    <span className="assignment-tag">{assignment.tag}</span>
                    {(assignment as any).label && (
                      <span className="assignment-label">{(assignment as any).label}</span>
                    )}
                  </div>
                  <div className="assignment-date">
                    {format(new Date(assignment.date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')}
                    {assignment.time && ` at ${format(new Date(`2000-01-01T${assignment.time}`), 'h:mm a')}`}
                  </div>
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleJumpToDate(assignment.date)}
                >
                  Jump to Date
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
