import React, { useState } from 'react';
import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom';
import { FileText, Users, UserRoundCheck, ClipboardCheck, ChevronLeft, ChevronRight, Layers, LogOut, LayoutDashboard, User, GraduationCap } from 'lucide-react';
import { cn } from '../components/utils/cn';
import { useAuth } from '../contexts/AuthContext';

const SIDEBAR_WIDTH_EXPANDED = 220;
const SIDEBAR_WIDTH_COLLAPSED = 64;

export const AdminLayout: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const width = sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;
  const isTrainerOrOffice = user?.role === 'trainer' || user?.role === 'office';

  const baseNavItems = isTrainerOrOffice
    ? [{ to: '/admin/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5 shrink-0" />, end: true }]
    : [
        { to: '/admin/overview', label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5 shrink-0" />, end: true },
        { to: '/admin/forms', label: 'Forms', icon: <FileText className="w-5 h-5 shrink-0" />, end: true },
        { to: '/admin/students', label: 'Students', icon: <Users className="w-5 h-5 shrink-0" />, end: true },
        { to: '/admin/batches', label: 'Batches', icon: <Layers className="w-5 h-5 shrink-0" />, end: true },
        { to: '/admin/courses', label: 'Courses', icon: <GraduationCap className="w-5 h-5 shrink-0" />, end: true },
        { to: '/admin/users', label: 'Users', icon: <UserRoundCheck className="w-5 h-5 shrink-0" />, end: true },
        { to: '/admin/assessments', label: 'Assessments', icon: <ClipboardCheck className="w-5 h-5 shrink-0" />, end: true },
      ];
  const navItems = [
    ...baseNavItems,
    { to: '/admin/profile', label: 'My Profile', icon: <User className="w-5 h-5 shrink-0" />, end: true },
    ...(user?.role === 'admin'
      ? [{ to: '/admin/enrollment', label: 'Enrollment', icon: <GraduationCap className="w-5 h-5 shrink-0" />, end: true }]
      : []),
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
            to={isTrainerOrOffice ? '/admin/dashboard' : '/admin/overview'}
            className="flex shrink-0 items-center justify-center overflow-hidden no-underline text-[var(--text)]"
            aria-label={isTrainerOrOffice ? 'Dashboard' : 'Forms'}
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
          {!sidebarCollapsed && user && (
            <div className="text-xs text-gray-600 truncate max-w-[120px]" title={user.email}>
              {user.full_name}
            </div>
          )}
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
        {user && (
          <div className="shrink-0 border-t border-[var(--border)] p-2">
            <button
              type="button"
              onClick={() => { logout(); navigate('/login', { replace: true }); }}
              className={cn(
                'flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors',
                sidebarCollapsed ? 'justify-center' : ''
              )}
            >
              <LogOut className="w-5 h-5 shrink-0" />
              {!sidebarCollapsed && <span>Logout</span>}
            </button>
          </div>
        )}
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
