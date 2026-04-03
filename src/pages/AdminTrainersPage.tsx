import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Mail, Phone, Pencil } from 'lucide-react';
import { listTrainersPaged, createTrainer, updateTrainer, listBatchesPaged } from '../lib/formEngine';
import type { Trainer } from '../lib/formEngine';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { Loader } from '../components/ui/Loader';
import { toast } from '../utils/toast';
import { AdminListPagination } from '../components/admin/AdminListPagination';

export const AdminTrainersPage: React.FC = () => {
  const PAGE_SIZE = 20;
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalTrainers, setTotalTrainers] = useState(0);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [draft, setDraft] = useState({
    full_name: '',
    email: '',
    phone: '',
    status: 'active',
  });

  const [editDraft, setEditDraft] = useState<{
    full_name: string;
    email: string;
    phone: string;
    status: string;
  } | null>(null);
  const [batches, setBatches] = useState<{ id: number; name: string; trainer_id: number }[]>([]);

  useEffect(() => {
    listBatchesPaged(1, 500).then((res) => setBatches(res.data));
  }, []);

  const digitsOnly = (val: string) => val.replace(/\D/g, '');

  const validateTrainerForm = (form: { full_name: string; email: string; phone: string; status: string }): string | null => {
    if (!form.full_name.trim()) return 'Full name is required.';
    if (!form.email.trim()) return 'Email is required.';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return 'Enter a valid email address.';
    if (!form.phone.trim()) return 'Phone is required.';
    if (!/^\d{10}$/.test(form.phone.trim())) return 'Phone must be exactly 10 digits.';
    if (!form.status.trim()) return 'Status is required.';
    return null;
  };

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await listTrainersPaged(currentPage, PAGE_SIZE, searchTerm);
      setTrainers(res.data);
      setTotalTrainers(res.total);
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [currentPage, searchTerm]);

  const createError = useMemo(() => validateTrainerForm(draft), [draft]);
  const editError = useMemo(() => (editDraft ? validateTrainerForm(editDraft) : 'Trainer form unavailable.'), [editDraft]);

  const handleCreate = async () => {
    const err = validateTrainerForm(draft);
    if (err) {
      toast.error(err);
      return;
    }
    setCreating(true);
    const created = await createTrainer(draft);
    setCreating(false);
    if (!created) {
      toast.error('Failed to add trainer');
      return;
    }
    setCurrentPage(1);
    const res = await listTrainersPaged(1, PAGE_SIZE, searchTerm);
    setTrainers(res.data);
    setTotalTrainers(res.total);
    setDraft({ full_name: '', email: '', phone: '', status: 'active' });
    setIsCreateOpen(false);
    toast.success('Trainer added');
  };

  const editingTrainer = useMemo(() => (editingId ? trainers.find((t) => t.id === editingId) : null), [editingId, trainers]);

  useEffect(() => {
    if (!editingTrainer) {
      setEditDraft(null);
      return;
    }
    setEditDraft({
      full_name: editingTrainer.full_name,
      email: editingTrainer.email,
      phone: editingTrainer.phone ?? '',
      status: editingTrainer.status ?? 'active',
    });
  }, [editingTrainer]);

  const handleSaveEdit = async () => {
    if (!editingId || !editDraft) return;
    const err = validateTrainerForm(editDraft);
    if (err) {
      toast.error(err);
      return;
    }
    setSavingEdit(true);
    const updated = await updateTrainer(editingId, editDraft);
    setSavingEdit(false);
    if (!updated) {
      toast.error('Failed to update trainer');
      return;
    }
    const res = await listTrainersPaged(currentPage, PAGE_SIZE, searchTerm);
    setTrainers(res.data);
    setTotalTrainers(res.total);
    setEditingId(null);
    toast.success('Trainer updated');
  };

  const totalPages = Math.max(1, Math.ceil(totalTrainers / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <Card className="mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[var(--text)]">Trainers</h2>
              <p className="text-sm text-gray-600 mt-1">
                Manage trainer directory. Batches are assigned to trainers on the Batches page.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search by name, email, phone..."
                className="w-full md:w-72"
              />
              <Button onClick={() => setIsCreateOpen(true)} className="min-w-[160px]">
                <Plus className="w-4 h-4 mr-2 inline" />
                Add Trainer
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold text-[var(--text)] mb-4">Trainer Directory</h2>
          {!loading && (
            <AdminListPagination
              placement="top"
              totalItems={totalTrainers}
              pageSize={PAGE_SIZE}
              currentPage={currentPage}
              totalPages={totalPages}
              onPrev={() => setCurrentPage((p) => Math.max(1, p - 1))}
              onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              itemLabel="trainers"
            />
          )}
          {loading ? (
            <div className="py-12">
              <Loader variant="dots" size="lg" message="Loading trainers..." />
            </div>
          ) : trainers.length === 0 ? (
            <p className="text-gray-500">No trainers found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full text-sm border border-[var(--border)] rounded-lg overflow-hidden">
                <thead className="bg-gray-50 text-gray-700">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Trainer</th>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Contact</th>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Batches</th>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Status</th>
                    <th className="text-right px-4 py-3 font-semibold border-b border-[var(--border)]">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {trainers.map((trainer) => (
                    <tr key={trainer.id} className="hover:bg-gray-50 align-top">
                      <td className="px-4 py-3 border-b border-[var(--border)]">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-orange-100 text-orange-700 font-semibold flex items-center justify-center">
                            {trainer.full_name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-[var(--text)]">{trainer.full_name}</div>
                            <div className="text-xs text-gray-500">ID: {trainer.id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)]">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-gray-700">
                            <Mail className="w-4 h-4 text-gray-400" />
                            <span>{trainer.email}</span>
                          </div>
                          <div className="flex items-center gap-2 text-gray-700">
                            <Phone className="w-4 h-4 text-gray-400" />
                            <span>{trainer.phone || '-'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)]">
                        <div className="flex flex-wrap gap-1">
                          {batches
                            .filter((b) => b.trainer_id === trainer.id)
                            .map((b) => (
                              <span
                                key={b.id}
                                className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700"
                              >
                                {b.name}
                              </span>
                            ))}
                          {batches.filter((b) => b.trainer_id === trainer.id).length === 0 && (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)]">
                        <div className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                          {trainer.status || 'active'}
                        </div>
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)] text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingId(trainer.id)}
                          className="inline-flex items-center justify-center gap-1.5 min-w-[96px] whitespace-nowrap"
                        >
                          <Pencil className="w-4 h-4" />
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && (
            <AdminListPagination
              placement="bottom"
              totalItems={totalTrainers}
              pageSize={PAGE_SIZE}
              currentPage={currentPage}
              totalPages={totalPages}
              onPrev={() => setCurrentPage((p) => Math.max(1, p - 1))}
              onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              itemLabel="trainers"
            />
          )}
        </Card>
      </div>

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Add Trainer" size="md">
        <div className="space-y-3">
          <Input
            value={draft.full_name}
            onChange={(e) => setDraft((p) => ({ ...p, full_name: e.target.value }))}
            placeholder="Full name *"
            required
          />
          <Input
            value={draft.email}
            onChange={(e) => setDraft((p) => ({ ...p, email: e.target.value }))}
            placeholder="Email *"
            type="email"
            required
          />
          <Input
            value={draft.phone}
            onChange={(e) => setDraft((p) => ({ ...p, phone: digitsOnly(e.target.value).slice(0, 10) }))}
            placeholder="Phone (10 digits) *"
            required
          />
          <Select
            value={draft.status}
            onChange={(v) => setDraft((p) => ({ ...p, status: v }))}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
          />
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={creating || !!createError}>
              {creating ? (
                <>
                  <Loader variant="dots" size="sm" inline className="mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2 inline" />
                  Add Trainer
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>

      {editingId && editDraft && (
        <Modal isOpen={!!editingId} onClose={() => setEditingId(null)} title="Edit Trainer" size="md">
          <div className="space-y-3">
            <Input
              value={editDraft.full_name}
              onChange={(e) => setEditDraft((p) => (p ? { ...p, full_name: e.target.value } : p))}
              placeholder="Full name *"
              required
            />
            <Input
              value={editDraft.email}
              onChange={(e) => setEditDraft((p) => (p ? { ...p, email: e.target.value } : p))}
              placeholder="Email *"
              type="email"
              required
            />
            <Input
              value={editDraft.phone}
              onChange={(e) => setEditDraft((p) => (p ? { ...p, phone: digitsOnly(e.target.value).slice(0, 10) } : p))}
              placeholder="Phone (10 digits) *"
              required
            />
            <Select
              value={editDraft.status}
              onChange={(v) => setEditDraft((p) => (p ? { ...p, status: v } : p))}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveEdit} disabled={savingEdit || !!editError}>
                {savingEdit ? (
                  <>
                    <Loader variant="dots" size="sm" inline className="mr-2" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
