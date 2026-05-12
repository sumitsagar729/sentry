import { FaClipboardList, FaDesktop, FaCubes, FaCog, FaChartLine, FaShieldAlt, FaUsers, FaWrench, FaInfoCircle } from 'react-icons/fa';
import './IconSidebar.css';

const navItems = [
  { icon: FaClipboardList, label: 'GETTING STARTED', id: 'getting-started' },
  { icon: FaDesktop, label: 'DEVICES', id: 'devices' },
  { icon: FaCubes, label: 'RESOURCES', id: 'resources' },
  { icon: FaCog, label: 'ORCHESTRATION', id: 'orchestration' },
  { icon: FaChartLine, label: 'MONITOR', id: 'monitor' },
  { icon: FaShieldAlt, label: 'SECURITY', id: 'security', active: true },
  { icon: FaUsers, label: 'ACCOUNTS', id: 'accounts' },
  { icon: FaWrench, label: 'GROUPS & SETTINGS', id: 'settings' },
];

export default function IconSidebar() {
  return (
    <nav className="icon-sidebar">
      <div className="icon-sidebar-items">
        {navItems.map((item) => (
          <div
            key={item.id}
            className={`icon-sidebar-item ${item.active ? 'active' : ''}`}
          >
            <item.icon className="icon-sidebar-icon" />
            <span className="icon-sidebar-label">{item.label}</span>
          </div>
        ))}
      </div>
      <div className="icon-sidebar-bottom">
        <div className="icon-sidebar-item">
          <FaInfoCircle className="icon-sidebar-icon" />
          <span className="icon-sidebar-label">ABOUT</span>
        </div>
      </div>
    </nav>
  );
}
