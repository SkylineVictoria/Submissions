import { useState, useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from './components/ui/Toast';
import { toastManager } from './utils/toast';
import { Loader } from './components/ui/Loader';
import type { Toast } from './components/ui/Toast';

// Lazy  pages for code splitting
const AdminFormsListPage = lazy(() => import('./pages/AdminFormsListPage').then(m => ({ default: m.AdminFormsListPage })));
const AdminFormBuilderPage = lazy(() => import('./pages/AdminFormBuilderPage').then(m => ({ default: m.AdminFormBuilderPage })));
const AdminStudentsPage = lazy(() => import('./pages/AdminStudentsPage').then(m => ({ default: m.AdminStudentsPage })));
const FormsListPage = lazy(() => import('./pages/FormsListPage').then(m => ({ default: m.FormsListPage })));
const FormStartPage = lazy(() => import('./pages/FormStartPage').then(m => ({ default: m.FormStartPage })));
const InstanceFillPage = lazy(() => import('./pages/InstanceFillPage').then(m => ({ default: m.InstanceFillPage })));
const FormWizardPage = lazy(() => import('./pages/FormWizardPage').then(m => ({ default: m.FormWizardPage })));

function App() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const unsubscribe = toastManager.subscribe(setToasts);
    return unsubscribe;
  }, []);

  return (
    <BrowserRouter>
      <Suspense fallback={<Loader fullPage variant="dots" size="lg" message="Loading..." />}>
        <Routes>
          <Route path="/" element={<Navigate to="/forms" replace />} />
          <Route path="/forms" element={<FormsListPage />} />
          <Route path="/forms/:formId/start" element={<FormStartPage />} />
          <Route path="/instances/:instanceId" element={<InstanceFillPage />} />
          <Route path="/admin/forms" element={<AdminFormsListPage />} />
          <Route path="/admin/forms/:formId/builder" element={<AdminFormBuilderPage />} />
          <Route path="/admin/students" element={<AdminStudentsPage />} />
          <Route path="/legacy" element={<FormWizardPage />} />
        </Routes>
      </Suspense>
      <ToastContainer toasts={toasts} onRemove={(id) => toastManager.remove(id)} />
    </BrowserRouter>
  );
}

export default App;
