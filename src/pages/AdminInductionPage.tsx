import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export const AdminInductionPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <Card className="mb-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[var(--text)]">Induction</h2>
              <p className="text-sm text-gray-600 mt-1">We’ll define the induction workflow next.</p>
            </div>
            <Link to="/admin/enrollment">
              <Button variant="outline">Back</Button>
            </Link>
          </div>
        </Card>

        <Card>
          <div className="py-10 text-center">
            <div className="text-sm text-gray-600">Coming soon</div>
          </div>
        </Card>
      </div>
    </div>
  );
};

