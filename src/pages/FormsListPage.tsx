import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listForms } from '../lib/formEngine';
import type { Form } from '../types/database';
import { Card } from '../components/ui/Card';
import { Loader } from '../components/ui/Loader';
import { FileText } from 'lucide-react';

export const FormsListPage: React.FC = () => {
  const [forms, setForms] = useState<Form[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listForms('published').then((data) => {
      setForms(data);
      setLoading(false);
    });
  }, []);

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <header className="bg-white border-b border-[var(--border)] shadow-sm sticky top-0 z-20">
        <div className="w-full px-4 md:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-[var(--text)]">Forms</h1>
            <Link to="/admin/forms" className="text-sm text-gray-600 hover:text-gray-900">
              Admin
            </Link>
          </div>
        </div>
      </header>

      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <Card>
          <h2 className="text-lg font-bold text-[var(--text)] mb-4">Published Forms</h2>
          {loading ? (
            <div className="py-12">
              <Loader variant="dots" size="lg" message="Loading forms..." />
            </div>
          ) : forms.length === 0 ? (
            <p className="text-gray-500">No published forms.</p>
          ) : (
            <ul className="space-y-2">
              {forms.map((form) => (
                <li key={form.id}>
                  <Link
                    to={`/forms/${form.id}/start`}
                    className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border)] bg-white hover:bg-[var(--brand)]/10 focus-visible:bg-[var(--brand)]/10 transition-colors block"
                  >
                    <FileText className="w-5 h-5 text-gray-400" />
                    <div>
                      <div className="font-medium text-[var(--text)]">{form.name}</div>
                      <div className="text-xs text-gray-500">
                        Version: {form.version || '-'} | Unit: {form.unit_code || '-'}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
};
