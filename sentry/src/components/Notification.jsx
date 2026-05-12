import { useApp } from '../context/AppContext';
import './Notification.css';

export default function Notification() {
  const { notification } = useApp();
  if (!notification) return null;

  return (
    <div className={`notification notification-${notification.type}`}>
      {notification.message}
    </div>
  );
}
