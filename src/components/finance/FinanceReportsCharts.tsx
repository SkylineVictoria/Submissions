import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { Card } from '../ui/Card';
import { formatAud } from '../../lib/financeReports';
import type { FinanceReportsCharts as ChartsData } from '../../types/financeReports';

const STATUS_COLORS: Record<string, string> = {
  Paid: '#10b981',
  Pending: '#f59e0b',
  'Partially Paid': '#0ea5e9',
};

type Props = {
  charts: ChartsData;
};

const chartTooltipStyle = {
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  fontSize: 12,
};

export const FinanceReportsCharts: React.FC<Props> = ({ charts }) => {
  const pieData = charts.statusBreakdown.filter((d) => d.value > 0);
  const hasTrend = charts.monthlyCollectionTrend.length > 0;
  const hasOutstanding = charts.outstandingByDueMonth.length > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <Card className="p-4 lg:col-span-1">
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

      <Card className="p-4 lg:col-span-1 xl:col-span-1">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text)]">Monthly Collection Trend</h3>
        {!hasTrend ? (
          <p className="py-12 text-center text-sm text-gray-500">No data for chart</p>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={charts.monthlyCollectionTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(value) => formatAud(Number(value) || 0)}
                />
                <Legend />
                <Line type="monotone" dataKey="collected" name="Collected" stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="invoiced" name="Invoiced" stroke="#f97316" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card className="p-4 lg:col-span-2 xl:col-span-1">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text)]">Outstanding by Due Month</h3>
        {!hasOutstanding ? (
          <p className="py-12 text-center text-sm text-gray-500">No outstanding balances</p>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts.outstandingByDueMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(value) => formatAud(Number(value) || 0)} />
                <Bar dataKey="outstanding" name="Outstanding" fill="#ea580c" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
};
