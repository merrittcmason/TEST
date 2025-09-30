import './Notifications.css';

export function Notifications() {
  return (
    <div className="notifications">
      <h2 className="section-title">Notifications</h2>
      <div className="notifications-list">
        <div className="notification-empty">
          <p>No new notifications</p>
        </div>
      </div>
    </div>
  );
}
