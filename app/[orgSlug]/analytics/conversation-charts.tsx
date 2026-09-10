"use client";

import { BarChart, Bar, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Props = {
  sentiment: { name: string; calls: number }[];
  objections: { name: string; count: number }[];
  variants: { name: string; conversionRate: number; averageSavings: number }[];
};

export function ConversationCharts({ sentiment, objections, variants }: Props) {
  return <div className="grid gap-6 lg:grid-cols-2">
    <Chart title="Vendor sentiment"><BarChart data={sentiment}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="calls" fill="#2563eb" /></BarChart></Chart>
    <Chart title="Top vendor pushback"><BarChart data={objections}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" interval={0} angle={-20} textAnchor="end" height={75} /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="#f97316" /></BarChart></Chart>
    <Chart title="Prompt variant performance"><BarChart data={variants}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis yAxisId="rate" unit="%" /><YAxis yAxisId="savings" orientation="right" unit="$" /><Tooltip /><Legend /><Bar yAxisId="rate" dataKey="conversionRate" fill="#16a34a" name="Conversion rate" /><Bar yAxisId="savings" dataKey="averageSavings" fill="#7c3aed" name="Average savings" /></BarChart></Chart>
  </div>;
}

function Chart({ title, children }: { title: string; children: React.ReactElement }) {
  return <section className="h-80 rounded border bg-white p-5"><h2 className="mb-4 font-semibold">{title}</h2><ResponsiveContainer height="88%" width="100%">{children}</ResponsiveContainer></section>;
}
