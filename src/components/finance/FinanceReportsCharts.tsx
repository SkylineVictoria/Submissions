import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { Card } from '../ui/Card';
import { formatAud } from '../../services/financeReports';
import type { FinanceReportsCharts as ChartsData } from '../../types/financeReports';

const STATUS_COLORS: Record<string, string> = {
  Paid: '#10b981',
  Pending: '#f59e0b',
  Void: '#94a3b8',
  Cancelled: '#ef4444',
};

type Props = {
  charts: ChartsData;
};

const chartTooltipStyle = {
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  fontSize: 12,
};

function MonthlyBarChart({
  data,
  dataKey,
  name,
  fill,
  emptyMessage,
}: {
  data: { month: string; [key: string]: string | number }[];
  dataKey: string;
  name: string;
  fill: string;
  emptyMessage: string;
}) {
  if (data.length === 0) {
    return <p className="py-12 text-center text-sm text-gray-500">{emptyMessage}</p>;
  }
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip contentStyle={chartTooltipStyle} formatter={(value) => formatAud(Number(value) || 0)} />
          <Legend />
          <Bar dataKey={dataKey} name={name} fill={fill} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export const FinanceReportsCharts: React.FC<Props> = ({ charts }) => {
  const pieData = charts.statusBreakdown.filter((d) => d.value > 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text)]">Invoice Status</h3>
        {pieData.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-500">No data for chart</p>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={88} label>
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? '#94a3b8'} />
                  ))}
                </Pie>
                <Tooltip contentStyle={chartTooltipStyle} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text)]">Paid by Payment Date</h3>
        {charts.paymentTrendWarning ? (
          <p className="mb-3 text-xs text-amber-700">{charts.paymentTrendWarning}</p>
        ) : null}
        <MonthlyBarChart
          data={charts.monthlyByPaymentDate}
          dataKey="amount"
          name="Paid amount"
          fill="#10b981"
          emptyMessage="No payment dates in filtered invoices"
        />
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text)]">Invoiced by Invoice Date</h3>
        <MonthlyBarChart
          data={charts.monthlyByInvoiceDate}
          dataKey="amount"
          name="Invoiced amount"
          fill="#f97316"
          emptyMessage="No invoice dates in filtered rows"
        />
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text)]">Outstanding by Due Date</h3>
        <MonthlyBarChart
          data={charts.outstandingByDueMonth}
          dataKey="outstanding"
          name="Outstanding"
          fill="#ea580c"
          emptyMessage="No outstanding balances"
        />
      </Card>
    </div>
  );
};
