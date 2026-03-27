import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, GraduationCap, Lock } from 'lucide-react';
import { Card } from '../components/ui/Card';

export const AdminEnrollmentPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <Card className="mb-6">
          <div>
            <h2 className="text-lg font-bold text-[var(--text)]">Enrollment</h2>
            <p className="text-sm text-gray-600 mt-1">Choose an enrollment workflow.</p>
          </div>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => navigate('/admin/enrollment/induction')}
            className="group text-left"
          >
            <div className="aspect-square rounded-2xl border border-[var(--border)] bg-white shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col">
              <div className="flex items-center justify-between">
                <div className="h-11 w-11 rounded-xl bg-[#f97316]/10 text-[#ea580c] flex items-center justify-center">
                  <ClipboardList className="w-6 h-6" />
                </div>
                <GraduationCap className="w-5 h-5 text-gray-300 group-hover:text-[#ea580c] transition-colors" />
              </div>
              <div className="mt-5">
                <div className="text-base font-semibold text-[var(--text)]">Induction</div>
                <div className="text-sm text-gray-600 mt-1">Import and onboard learners into their first activities.</div>
              </div>
              <div className="mt-auto pt-4 text-sm font-medium text-[#ea580c]">Open</div>
            </div>
          </button>

          <div className="relative">
            <div className="aspect-square rounded-2xl border border-[var(--border)] bg-white/70 shadow-sm p-5 flex flex-col">
              <div className="flex items-center justify-between">
                <div className="h-11 w-11 rounded-xl bg-gray-100 text-gray-500 flex items-center justify-center">
                  <Lock className="w-6 h-6" />
                </div>
                <GraduationCap className="w-5 h-5 text-gray-300" />
              </div>
              <div className="mt-5">
                <div className="text-base font-semibold text-[var(--text)]">Admissions</div>
                <div className="text-sm text-gray-600 mt-1">Coming soon</div>
              </div>
              <div className="mt-auto pt-4 text-sm font-medium text-gray-400">Unavailable</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

