import React, { useState } from 'react';
import { Outlet, NavLink, Link } from 'react-router-dom';
import { FileText, Users, UserRoundCheck, ClipboardCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../components/utils/cn';

const SIDEBAR_WIDTH_EXPANDED = 220;
const SIDEBAR_WIDTH_COLLAPSED = 64;

export const AdminLayout: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const width = sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;

  const navItems: { to: string; label: string; icon: React.ReactNode; end?: boolean }[] = [
    { to: '/admin/forms', label: 'Forms', icon: <FileText className="w-5 h-5 shrink-0" />, end: true },
    { to: '/admin/students', label: 'Students', icon: <Users className="w-5 h-5 shrink-0" />, end: true },
    { to: '/admin/trainers', label: 'Trainers', icon: <UserRoundCheck className="w-5 h-5 shrink-0" />, end: true },
    { to: '/admin/assessments', label: 'Assessments', icon: <ClipboardCheck className="w-5 h-5 shrink-0" />, end: true },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg)] flex">
      {/* Single navbar/sidebar: crest (sized by expand/collapse) + toggle + nav links */}
      <aside
        className="fixed top-0 bottom-0 left-0 z-30 flex flex-col border-r border-[var(--border)] bg-white shadow-sm transition-[width] duration-200 ease-out"
        style={{ width }}
      >
        <div
          className={cn(
            'flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-3',
            sidebarCollapsed ? 'flex-col' : 'flex-row'
          )}
        >
          <Link
            to="/admin/forms"
            className="flex shrink-0 items-center justify-center overflow-hidden no-underline text-[var(--text)]"
            aria-label="Forms"
          >
            {!logoError ? (
              <img
                src="/logo-crest.png"
                alt="Skyline"
                className={cn(
                  'w-auto object-contain transition-[height] duration-200',
                  sidebarCollapsed ? 'h-8' : 'h-12'
                )}
                onError={() => setLogoError(true)}
              />
            ) : (
              <span
                className={cn(
                  'font-bold text-[#f97316] transition-[font-size] duration-200',
                  sidebarCollapsed ? 'text-sm' : 'text-lg'
                )}
              >
                SKYLINE
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          </button>
        </div>
        <nav className="flex-1 overflow-x-hidden overflow-y-auto py-4">
          <ul className="space-y-0.5 px-2">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      isActive ? 'bg-[#f97316]/10 text-[#ea580c]' : 'text-gray-700 hover:bg-gray-100'
                    )
                  }
                >
                  {item.icon}
                  {!sidebarCollapsed && <span>{item.label}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* Main content: no top padding, only left margin */}
      <main
        className="flex-1 flex flex-col min-h-screen transition-[margin-left] duration-200 ease-out"
        style={{ marginLeft: width }}
      >
        <Outlet />
      </main>
    </div>
  );
};
