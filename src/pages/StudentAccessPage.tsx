import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchForm, studentLoginForForm } from '../lib/formEngine';
import { isValidInstitutionalEmail } from '../lib/emailUtils';
import type { Form } from '../types/database';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Loader } from '../components/ui/Loader';
import { toast } from '../utils/toast';

export const StudentAccessPage: React.FC = () => {
  const { formId } = useParams<{ formId: string }>();
  const [searchParams] = useSearchParams();
  const formIdParam = formId || searchParams.get('formId');
  const formIdNum = formIdParam ? Number(formIdParam) : 0;
  const navigate = useNavigate();
  const [form, setForm] = useState<Form | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (formIdNum && Number.isFinite(formIdNum)) {
      fetchForm(formIdNum).then((f) => {
        setForm(f || null);
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, [formIdNum]);

  const emailValid = isValidInstitutionalEmail(email);
  const canSubmit = !!email.trim() && !!password && emailValid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formIdNum || !Number.isFinite(formIdNum) || !form) return;
    if (!email.trim() || !password) {
      toast.error('Please enter your email and password.');
      return;
    }
    if (!emailValid) {
      toast.error('Only @student.slit.edu.au or @slit.edu.au emails can access forms.');
      return;
    }
    setSubmitting(true);
    const result = await studentLoginForForm(formIdNum, email.trim(), password);
    setSubmitting(false);
    if (result.success && result.url) {
      const path = result.url.replace(window.location.origin, '');
      navigate(path);
    } else {
      toast.error(result.error || 'Login failed.');
    }
  };

  if (loading) {
    return <Loader fullPage variant="dots" size="lg" message="Loading..." />;
  }

  if (!formIdNum || !Number.isFinite(formIdNum) || !form) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <p className="text-red-600">Invalid or missing form. Please use the link shared by your admin.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <h1 className="text-xl font-bold text-[var(--text)] mb-2">Student Access</h1>
        <p className="text-sm text-gray-600 mb-2">{form.name}</p>
        <p className="text-xs text-gray-500 mb-6">
          Enter your email and password to access your assessment form.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Input
              type="email"
              label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="firstname.lastname@student.slit.edu.au"
              autoComplete="email"
              required
              className={email.trim() && !emailValid ? 'border-amber-500' : ''}
            />
            {email.trim() && !emailValid && (
              <p className="mt-1.5 text-sm text-amber-600">Only @student.slit.edu.au or @slit.edu.au emails can access forms.</p>
            )}
          </div>
          <Input
            type="password"
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
          <Button type="submit" disabled={submitting || !canSubmit} className="w-full">
            {submitting ? 'Signing in...' : 'Access Form'}
          </Button>
        </form>
      </Card>
    </div>
  );
};
