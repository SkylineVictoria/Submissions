import React from 'react';
import { View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { SignatureBlockSection } from '../../types/formDefinition';
import { Role, FormAnswers, SignatureData } from '../../types';
// Note: PDF shows all signature blocks (only hides cross-role signatures for privacy)

interface PdfSignatureBlockProps {
  section: SignatureBlockSection;
  role: Role;
  answers: FormAnswers;
  studentSignature: SignatureData;
  trainerSignature: SignatureData;
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  title: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 6,
    fontFamily: 'Inter',
  },
  table: {
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#d1d5db',
    minHeight: 30,
  },
  cell: {
    padding: 8,
    fontSize: 10,
    borderRightWidth: 1,
    borderRightColor: '#d1d5db',
    fontFamily: 'Inter',
  },
  labelCell: {
    width: '40%',
    fontWeight: 'bold',
    fontFamily: 'Inter',
  },
  valueCell: {
    width: '60%',
    fontFamily: 'Inter',
  },
  signatureImage: {
    maxHeight: 60,
    maxWidth: 200,
  },
});

export const PdfSignatureBlock: React.FC<PdfSignatureBlockProps> = ({
  section,
  role,
  answers,
  studentSignature,
  trainerSignature,
}) => {
  const isStudentSig = section.fieldId === 'student.signature';
  const isTrainerSig = section.fieldId === 'trainer.signature';

  // Privacy: Hide signature from opposite role
  const shouldHideSignature = () => {
    if (role === 'office') return false;
    if (isStudentSig && role === 'trainer') return true;
    if (isTrainerSig && role === 'student') return true;
    return false;
  };

  // PDF shows all signature blocks - only check shouldHideSignature for cross-role visibility
  if (shouldHideSignature()) return null;

  const signature = isStudentSig ? studentSignature : isTrainerSig ? trainerSignature : null;
  const nameFieldId = `${section.fieldId}.name`;
  const dateFieldId = `${section.fieldId}.date`;
  const nameValue = answers[nameFieldId] || '';
  const dateValue = answers[dateFieldId] || signature?.signedAtDate || '';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{section.label}</Text>
      <View style={styles.table}>
        {section.showNameField && (
          <View style={styles.row}>
            <Text style={[styles.cell, styles.labelCell]}>
              {isStudentSig ? 'Student Name' : 'Trainer/Assessor Name'}
            </Text>
            <Text style={[styles.cell, styles.valueCell]}>{nameValue}</Text>
          </View>
        )}
        <View style={styles.row}>
          <Text style={[styles.cell, styles.labelCell]}>
            {isStudentSig ? 'Student Signature' : 'Trainer/Assessor Signature'}
          </Text>
          <View style={[styles.cell, styles.valueCell]}>
            {signature?.imageDataUrl ? (
              <Image src={signature.imageDataUrl} style={styles.signatureImage} />
            ) : signature?.typedText ? (
              <Text style={{ fontSize: 10, color: '#dc2626', fontStyle: 'italic', fontFamily: 'Helvetica' }}>{signature.typedText}</Text>
            ) : nameValue ? (
              <Text style={{ fontSize: 10, color: '#2563eb', fontStyle: 'italic', fontFamily: 'Helvetica' }}>{nameValue}</Text>
            ) : (
              <Text style={{ fontSize: 9, color: '#9ca3af' }}>No signature</Text>
            )}
          </View>
        </View>
        {section.showDateField && (
          <View style={styles.row}>
            <Text style={[styles.cell, styles.labelCell]}>Date</Text>
            <Text style={[styles.cell, styles.valueCell]}>{dateValue}</Text>
          </View>
        )}
      </View>
    </View>
  );
};

