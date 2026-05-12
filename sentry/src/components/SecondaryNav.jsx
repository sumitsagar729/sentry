import { useLocation, useNavigate } from 'react-router-dom';
import './SecondaryNav.css';

const navSections = [
  {
    title: 'Compliance',
    items: [{ label: 'Compliance Policies', path: '/compliance-policies' }],
  },
  {
    title: 'Tunnel',
    items: [
      { label: 'Dashboard', path: '/tunnel-dashboard' },
      { label: 'Applications', path: '/applications' },
      { label: 'Device Traffic Rules', path: '/device-traffic-rules' },
      { label: 'Profiles', path: '/profiles' },
      { label: 'Gateways', path: '/gateways' },
      { label: 'SNL', path: '/snl', highlighted: true },
    ],
  },
  {
    title: 'Email Security',
    items: [
      { label: 'Dashboard', path: '/email-dashboard' },
      { label: 'Activity', path: '/email-activity' },
      { label: 'Control Policies', path: '/email-control-policies' },
    ],
  },
  {
    title: 'TunnelSNL',
    items: [
      { label: 'Configuration', path: '/configuration' },
    ],
  },
];

export default function SecondaryNav() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="secondary-nav">
      <div className="secondary-nav-content">
        {navSections.map((section) => (
          <div key={section.title} className="nav-section">
            <div className="nav-section-title">{section.title}</div>
            {section.items.map((item) => {
              const isCurrent = location.pathname === item.path;
              const isHighlighted = item.highlighted && !isCurrent;
              return (
                <div
                  key={item.label + item.path}
                  className={`nav-item ${isHighlighted ? 'highlighted' : ''} ${isCurrent ? 'active' : ''}`}
                  onClick={() => navigate(item.path)}
                >
                  {item.label}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="secondary-nav-collapse">‹</div>
    </nav>
  );
}
