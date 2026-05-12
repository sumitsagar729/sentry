import { FaSearch, FaBell, FaQuestionCircle, FaStar, FaTh } from 'react-icons/fa';
import './Header.css';

export default function Header() {
  return (
    <header className="header">
      <div className="header-left">
        <div className="header-logo">
          <div className="logo-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
              <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.18l7 3.5v7.64l-7 3.5-7-3.5V7.68l7-3.5z" />
            </svg>
          </div>
          <span className="logo-text">UEM</span>
        </div>
        <div className="header-dropdown">
          <select defaultValue="tunnel-team">
            <option value="tunnel-team">Tunnel Team (PPAT)</option>
          </select>
        </div>
      </div>
      <div className="header-right">
        <button className="header-icon-btn"><FaSearch /></button>
        <button className="header-icon-btn notification-btn">
          <FaBell />
          <span className="notification-badge">1</span>
        </button>
        <button className="header-icon-btn"><FaQuestionCircle /></button>
        <button className="header-icon-btn"><FaStar /></button>
        <div className="header-user">
          <span>esg\ssumist1</span>
          <span className="user-caret">▾</span>
        </div>
        <button className="header-icon-btn"><FaTh /></button>
      </div>
    </header>
  );
}
