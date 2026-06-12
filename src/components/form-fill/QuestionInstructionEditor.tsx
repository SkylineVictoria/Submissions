import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { TaskInstructionsModal, type TaskInstructionsData } from './TaskInstructionsModal';
import { getQuestionInstructionListLabel, getQuestionInstructionsData } from '../../utils/questionInstructionLabel';
import type { FormQuestion } from '../../types/database';
import type { Json } from '../../types/database';

interface QuestionInstructionEditorProps {
  question: FormQuestion;
  sectionId: number;
  onSaved: (updated: Partial<FormQuestion>) => void;
  autoOpen?: boolean;
  onAutoOpenHandled?: () => void;
}

export function QuestionInstructionEditor({
  question,
  sectionId,
  onSaved,
  autoOpen = false,
  onAutoOpenHandled,
}: QuestionInstructionEditorProps) {
  const [modalOpen, setModalOpen] = useState(autoOpen);
  const initial = getQuestionInstructionsData(question.pdf_meta);

  useEffect(() => {
    if (autoOpen) setModalOpen(true);
  }, [autoOpen, question.id]);

  const closeModal = () => {
    setModalOpen(false);
    onAutoOpenHandled?.();
  };

  const handleSave = async (data: TaskInstructionsData) => {
    const pm = { ...((question.pdf_meta as Record<string, unknown>) || {}), instructions: data };
    const label = getQuestionInstructionListLabel({ ...question, pdf_meta: pm });
    const updates = { pdf_meta: pm as Json, label };
    await supabase.from('skyline_form_questions').update(updates).eq('id', question.id);
    onSaved(updates);
    closeModal();
  };

  return (
    <Card>
      <h3 className="font-bold mb-2">Question instruction</h3>
      <p className="text-sm text-gray-600 mb-4">
        Add instructions that appear among the questions in this task. Use the same editor as Student Instructions — headings, tables, images, and formatted text.
      </p>
      <Button variant="primary" onClick={() => setModalOpen(true)}>
        {initial ? 'Edit instruction' : 'Add instruction content'}
      </Button>
      {modalOpen && (
        <TaskInstructionsModal
          isOpen
          onClose={closeModal}
          rowLabel={question.label || 'Instruction'}
          initialData={initial}
          uploadTarget={{ scope: 'section', id: sectionId }}
          onSave={handleSave}
        />
      )}
    </Card>
  );
}
