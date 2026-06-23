import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, ExternalLink } from 'lucide-react';
import { DatePicker } from '../components/ui/DatePicker';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Loader } from '../components/ui/Loader';
import {
  attachmentFilesOnly,
  attachmentLabel,
  downloadEnrolmentPdf,
  resolveCourseLabels,
} from '../lib/enrolmentPdf';
import {
  displayEnrolmentName,
  listEnrolmentApplications,
  type EnrolmentApplicationListRow,
} from '../lib/enrolmentAdmin';
import { formatMelbourneDateTime } from '../utils/melbourneTime';
import { toast } from '../utils/toast';

export const AdminAdmissionsEnrolmentPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<EnrolmentApplicationListRow[]>([]);
  const [nameFilter, setNameFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [pdfId, setPdfId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const fromIso = fromDate ? `${fromDate}T00:00:00.000Z` : undefined;
    const toIso = toDate ? `${toDate}T23:59:59.999Z` : undefined;
    const res = await listEnrolmentApplications({
      name: nameFilter,
      from: fromIso,
      to: toIso,
      status: statusFilter || undefined,
    });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not load applications');
      return;
    }
    setRows(res.rows ?? []);
  }, [nameFilter, fromDate, toDate, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const downloadRowPdf = async (row: EnrolmentApplicationListRow) => {
    setPdfId(row.id);
    try {
      const courseLabels = resolveCourseLabels(row.payload.course.courseIds);
      await downloadEnrolmentPdf(
        row.payload,
        row.application_no,
        attachmentFilesOnly(row.files),
        courseLabels
      );
      toast.success('PDF downloaded.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate PDF');
    } finally {
      setPdfId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <button
          type="button"
          onClick={() => navigate('/admin/enrollment')}
          className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-[#ea580c]"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to enrollment
        </button>

        <Card className="mb-6">
          <h2 className="text-lg font-bold text-[var(--text)]">Admissions — International applications</h2>
          <p className="text-sm text-gray-600 mt-1">
            Submitted enrolment forms. Download PDF on demand; open attachment links directly.
          </p>
        </Card>

        <Card className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Name / email / reference</label>
              <input
                type="search"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                placeholder="Search…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <DatePicker label="From date" value={fromDate} onChange={setFromDate} placement="below" />
            <DatePicker label="To date" value={toDate} onChange={setToDate} placement="below" />
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">All</option>
                <option value="submitted">Submitted</option>
                <option value="draft">Draft</option>
                <option value="under_review">Under review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>
          <div className="mt-4">
            <Button type="button" variant="primary" size="sm" onClick={() => void load()}>
              Apply filters
            </Button>
          </div>
        </Card>

        {loading ? (
          <Loader message="Loading applications…" />
        ) : rows.length === 0 ? (
          <Card>
            <p className="text-sm text-gray-600 text-center py-8">No applications match your filters.</p>
          </Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[960px] text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left">
                  <th className="py-3 px-4 font-semibold text-gray-800">Reference</th>
                  <th className="py-3 px-4 font-semibold text-gray-800">Name</th>
                  <th className="py-3 px-4 font-semibold text-gray-800">Email</th>
                  <th className="py-3 px-4 font-semibold text-gray-800">Submitted</th>
                  <th className="py-3 px-4 font-semibold text-gray-800">Status</th>
                  <th className="py-3 px-4 font-semibold text-gray-800">Attachments</th>
                  <th className="py-3 px-4 font-semibold text-gray-800 w-28">PDF</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const attachments = attachmentFilesOnly(row.files);
                  return (
                    <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50/80">
                      <td className="py-3 px-4 font-mono text-xs">{row.application_no ?? '—'}</td>
                      <td className="py-3 px-4">{displayEnrolmentName(row)}</td>
                      <td className="py-3 px-4 break-all">{row.email ?? '—'}</td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {formatMelbourneDateTime(row.submitted_at ?? row.created_at)}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-800 capitalize">
                          {row.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {attachments.length === 0 ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <ul className="space-y-1">
                            {attachments.map((f) => (
                              <li key={`${f.section}-${f.field}-${f.path}`}>
                                <a
                                  href={f.publicUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-[#2563eb] hover:underline text-xs"
                                >
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                  {attachmentLabel(f)}
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={pdfId === row.id}
                          onClick={() => void downloadRowPdf(row)}
                          title="Download application PDF"
                        >
                          <Download className="w-4 h-4" />
                          {pdfId === row.id ? '…' : ''}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
};

export default AdminAdmissionsEnrolmentPage;
