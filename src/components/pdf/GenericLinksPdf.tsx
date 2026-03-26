import React from 'react';
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';

type StudentRow = { id: number; name: string; email: string };
type FormRow = { id: number; name: string; version?: string | null; url: string };

interface GenericLinksPdfProps {
  title: string;
  courseName: string;
  batchName: string;
  createdAtIso: string;
  forms: FormRow[];
  students: StudentRow[];
}

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 10, fontFamily: 'Helvetica' },
  h1: { fontSize: 16, fontWeight: 700, marginBottom: 8 },
  meta: { fontSize: 10, color: '#374151', marginBottom: 2 },
  sectionTitle: { marginTop: 14, marginBottom: 6, fontSize: 12, fontWeight: 700 },
  box: { border: '1pt solid #E5E7EB', borderRadius: 6, padding: 10, marginTop: 6 },
  row: { flexDirection: 'row', gap: 8 },
  col: { flexGrow: 1 },
  label: { fontSize: 9, color: '#6B7280', marginBottom: 2 },
  mono: { fontFamily: 'Courier', fontSize: 9 },
  tableHeader: { flexDirection: 'row', borderBottom: '1pt solid #E5E7EB', paddingBottom: 6, marginBottom: 6 },
  th: { fontSize: 9, color: '#6B7280', fontWeight: 700 },
  tr: { flexDirection: 'row', paddingVertical: 3 },
  td: { fontSize: 9, color: '#111827' },
  w40: { width: '40%' },
  w60: { width: '60%' },
});

export const GenericLinksPdf: React.FC<GenericLinksPdfProps> = ({
  title,
  courseName,
  batchName,
  createdAtIso,
  forms,
  students,
}) => {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>{title}</Text>
        <Text style={styles.meta}>Course: {courseName}</Text>
        <Text style={styles.meta}>Batch: {batchName}</Text>
        <Text style={styles.meta}>Generated: {createdAtIso}</Text>

        <Text style={styles.sectionTitle}>Forms (generic student access links)</Text>
        <View style={styles.box}>
          {forms.length === 0 ? (
            <Text style={styles.td}>No forms selected.</Text>
          ) : (
            <>
              <View style={styles.tableHeader}>
                <Text style={[styles.th, styles.w40]}>Form</Text>
                <Text style={[styles.th, styles.w60]}>Generic link</Text>
              </View>
              {forms.map((f) => (
                <View key={f.id} style={styles.tr}>
                  <Text style={[styles.td, styles.w40]}>{f.name} {f.version ? `(v${f.version})` : ''}</Text>
                  <Text style={[styles.td, styles.w60, styles.mono]}>{f.url}</Text>
                </View>
              ))}
            </>
          )}
        </View>

        <Text style={styles.sectionTitle}>Students selected</Text>
        <View style={styles.box}>
          {students.length === 0 ? (
            <Text style={styles.td}>No students selected.</Text>
          ) : (
            <>
              <View style={styles.tableHeader}>
                <Text style={[styles.th, styles.w40]}>Student</Text>
                <Text style={[styles.th, styles.w60]}>Email</Text>
              </View>
              {students.map((s) => (
                <View key={s.id} style={styles.tr}>
                  <Text style={[styles.td, styles.w40]}>{s.name}</Text>
                  <Text style={[styles.td, styles.w60]}>{s.email}</Text>
                </View>
              ))}
            </>
          )}
        </View>
      </Page>
    </Document>
  );
};

