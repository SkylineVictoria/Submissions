import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchForm, createFormInstance, issueInstanceAccessLink } from '../lib/formEngine';
import type { Form } from '../types/database';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Loader } from '../components/ui/Loader';

export const FormStartPage: React.FC = () => {
  const { formId } = useParams<{ formId: string }>();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form | null>(null);
  const [role, setRole] = useState('student');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (formId) {
      fetchForm(Number(formId)).then((f) => {
        setForm(f || null);
        setLoading(false);
      });
    }
  }, [formId]);

  const handleStart = async () => {
    if (!formId) return;
    setStarting(true);
    const instance = await createFormInstance(Number(formId), role);
    setStarting(false);
    if (instance) {
      const secureUrl = await issueInstanceAccessLink(instance.id, role as 'student' | 'trainer' | 'office');
      if (!secureUrl) return;
      const path = secureUrl.replace(window.location.origin, '');
      navigate(path);
    }
  };

  if (loading || !form) {
    return <Loader fullPage variant="dots" size="lg" message="Loading..." />;
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <h1 className="text-xl font-bold text-[var(--text)] mb-2">{form.name}</h1>
        <p className="text-sm text-gray-600 mb-6">
          Version: {form.version || '-'} | Unit: {form.unit_code || '-'}
        </p>
        <div className="space-y-4">
          <Select
            label="Select your role"
            value={role}
            onChange={setRole}
            options={[
              { value: 'student', label: 'Student' },
              { value: 'trainer', label: 'Trainer' },
              { value: 'office', label: 'Office' },
            ]}
          />
          <Button onClick={handleStart} disabled={starting} className="w-full">
            Start Form
          </Button>
        </div>
      </Card>
    </div>
  );
};
