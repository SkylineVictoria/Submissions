import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  FileText,
  Users,
  UserRoundCheck,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  Layers,
  LogOut,
  LayoutDashboard,
  User,
  GraduationCap,
  Menu,
} from 'lucide-react';
import { cn } from '../components/utils/cn';
import { useAuth } from '../contexts/AuthContext';
import { useMediaQuery } from '../hooks/useMediaQuery';

const SIDEBAR_WIDTH_EXPANDED = 220;
const SIDEBAR_WIDTH_COLLAPSED = 64;

export const AdminLayout: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMdUp = useMediaQuery('(min-width: 768px)');
  const width = sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;
  const isTrainerOrOffice = user?.role === 'trainer' || user?.role === 'office';

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (isMdUp) setMobileNavOpen(false);
  }, [isMdUp]);

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

  const showSidebarLabels = isMdUp ? !sidebarCollapsed : true;

  return (
    <div className="min-h-screen bg-[var(--bg)] flex">
      {/* Mobile: tap outside to close nav */}
      {mobileNavOpen && !isMdUp ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          aria-label="Close menu"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      {/* Single navbar/sidebar: crest (sized by expand/collapse) + toggle + nav links */}
      <aside
        className={cn(
          'fixed top-0 bottom-0 left-0 z-40 flex flex-col border-r border-[var(--border)] bg-white shadow-sm transition-[width,transform] duration-200 ease-out',
          !isMdUp && !mobileNavOpen && '-translate-x-full',
          !isMdUp && mobileNavOpen && 'translate-x-0',
          isMdUp && 'translate-x-0'
        )}
        style={{ width: isMdUp ? width : SIDEBAR_WIDTH_EXPANDED }}
      >
        <div
          className={cn(
            'flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-3',
            isMdUp && sidebarCollapsed ? 'flex-col' : 'flex-row'
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
                  isMdUp && sidebarCollapsed ? 'h-8' : 'h-12'
                )}
                onError={() => setLogoError(true)}
              />
            ) : (
              <span
                className={cn(
                  'font-bold text-[#f97316] transition-[font-size] duration-200',
                  isMdUp && sidebarCollapsed ? 'text-sm' : 'text-lg'
                )}
              >
                SKYLINE
              </span>
            )}
          </Link>
          {showSidebarLabels && user && (
            <div className="text-xs text-gray-600 truncate max-w-[120px] min-w-0" title={user.email}>
              {user.full_name}
            </div>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            className="hidden md:flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
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
                  {showSidebarLabels && <span className="min-w-0">{item.label}</span>}
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
                !showSidebarLabels ? 'justify-center' : ''
              )}
            >
              <LogOut className="w-5 h-5 shrink-0" />
              {showSidebarLabels && <span>Logout</span>}
            </button>
          </div>
        )}
      </aside>

      {/* Main: full width on small screens; offset by sidebar width on md+ */}
      <main
        className="flex min-h-screen min-w-0 flex-1 flex-col transition-[margin-left] duration-200 ease-out"
        style={{ marginLeft: isMdUp ? width : 0 }}
      >
        {/* Mobile top bar — opens drawer nav (sidebar toggle is desktop-only) */}
        {!isMdUp ? (
          <header className="sticky top-0 z-20 flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-white px-3 py-2.5 shadow-sm">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100"
              aria-label="Open menu"
            >
              <Menu className="h-6 w-6" />
            </button>
            <span className="truncate text-base font-semibold text-[var(--text)]">Skyline</span>
          </header>
        ) : null}
        <div className="min-h-0 min-w-0 flex-1">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
