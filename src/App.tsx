import { useState, useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { ToastContainer } from './components/ui/Toast';
import { toastManager } from './utils/toast';
import { Loader } from './components/ui/Loader';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminOnlyRoute } from './components/AdminOnlyRoute';
import { SuperAdminOnlyRoute } from './components/SuperAdminOnlyRoute';
import type { Toast } from './components/ui/Toast';

// Layouts
const AdminLayout = lazy(() => import('./layouts/AdminLayout').then(m => ({ default: m.AdminLayout })));

// Lazy  pages for code splitting
const AdminFormsListPage = lazy(() => import('./pages/AdminFormsListPage').then(m => ({ default: m.AdminFormsListPage })));
const AdminFormBuilderPage = lazy(() => import('./pages/AdminFormBuilderPage').then(m => ({ default: m.AdminFormBuilderPage })));
const AdminFormPreviewPage = lazy(() => import('./pages/AdminFormPreviewPage').then(m => ({ default: m.AdminFormPreviewPage })));
const AdminStudentsPage = lazy(() => import('./pages/AdminStudentsPage').then(m => ({ default: m.AdminStudentsPage })));
const AdminStudentDetailsPage = lazy(() => import('./pages/AdminStudentDetailsPage').then(m => ({ default: m.AdminStudentDetailsPage })));
const AdminAssessmentsPage = lazy(() => import('./pages/AdminAssessmentsPage').then(m => ({ default: m.AdminAssessmentsPage })));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage').then(m => ({ default: m.AdminUsersPage })));
const AdminBatchesPage = lazy(() => import('./pages/AdminBatchesPage').then(m => ({ default: m.AdminBatchesPage })));
const AdminCoursesPage = lazy(() => import('./pages/AdminCoursesPage').then(m => ({ default: m.AdminCoursesPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage').then(m => ({ default: m.AdminDashboardPage })));
const MyProfilePage = lazy(() => import('./pages/MyProfilePage').then(m => ({ default: m.MyProfilePage })));
const AdminEnrollmentPage = lazy(() => import('./pages/AdminEnrollmentPage').then(m => ({ default: m.AdminEnrollmentPage })));
const AdminInductionPage = lazy(() => import('./pages/AdminInductionPage'));
const FormStartPage = lazy(() => import('./pages/FormStartPage').then(m => ({ default: m.FormStartPage })));
const StudentAccessPage = lazy(() => import('./pages/StudentAccessPage').then(m => ({ default: m.StudentAccessPage })));
const InstanceFillPage = lazy(() => import('./pages/InstanceFillPage').then(m => ({ default: m.InstanceFillPage })));
const FormWizardPage = lazy(() => import('./pages/FormWizardPage').then(m => ({ default: m.FormWizardPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const PublicInductionPage = lazy(() => import('./pages/PublicInductionPage').then(m => ({ default: m.PublicInductionPage })));

function DashboardOrFormsRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const isTrainer = user.role === 'trainer';
  return <Navigate to={isTrainer ? '/admin/dashboard' : '/admin/overview'} replace />;
}

function App() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const unsubscribe = toastManager.subscribe(setToasts);
    return unsubscribe;
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<Loader fullPage variant="dots" size="lg" message="Loading..." />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<DashboardOrFormsRedirect />} />
            <Route path="/forms" element={<Navigate to="/admin" replace />} />
            <Route path="/forms/:formId/start" element={<FormStartPage />} />
            <Route path="/forms/:formId/student-access" element={<StudentAccessPage />} />
            <Route path="/student-access" element={<StudentAccessPage />} />
            <Route path="/instances/:instanceId" element={<InstanceFillPage />} />
            <Route path="/induction/:token" element={<PublicInductionPage />} />
            <Route path="/admin" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
            <Route index element={<DashboardOrFormsRedirect />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="overview" element={<AdminOnlyRoute><AdminDashboardPage /></AdminOnlyRoute>} />
            <Route path="profile" element={<MyProfilePage />} />
            <Route path="enrollment" element={<AdminOnlyRoute><AdminEnrollmentPage /></AdminOnlyRoute>} />
            <Route path="enrollment/induction" element={<AdminOnlyRoute><AdminInductionPage /></AdminOnlyRoute>} />
            <Route path="forms" element={<AdminOnlyRoute><AdminFormsListPage /></AdminOnlyRoute>} />
            <Route path="forms/:formId/builder" element={<AdminOnlyRoute><SuperAdminOnlyRoute><AdminFormBuilderPage /></SuperAdminOnlyRoute></AdminOnlyRoute>} />
            <Route path="forms/:formId/preview" element={<AdminOnlyRoute><AdminFormPreviewPage /></AdminOnlyRoute>} />
            <Route path="students" element={<AdminOnlyRoute><AdminStudentsPage /></AdminOnlyRoute>} />
            <Route path="students/:studentId" element={<AdminOnlyRoute><AdminStudentDetailsPage /></AdminOnlyRoute>} />
            <Route path="batches" element={<AdminOnlyRoute><AdminBatchesPage /></AdminOnlyRoute>} />
            <Route path="courses" element={<AdminOnlyRoute><AdminCoursesPage /></AdminOnlyRoute>} />
            <Route path="users" element={<AdminOnlyRoute><AdminUsersPage /></AdminOnlyRoute>} />
            <Route path="trainers" element={<Navigate to="/admin/users" replace />} />
            <Route path="assessments" element={<AdminOnlyRoute><AdminAssessmentsPage /></AdminOnlyRoute>} />
          </Route>
          <Route path="/legacy" element={<FormWizardPage />} />
          </Routes>
        </Suspense>
        <ToastContainer toasts={toasts} onRemove={(id) => toastManager.remove(id)} />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
