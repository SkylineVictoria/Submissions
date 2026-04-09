import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { TaskInstructionsModal, type TaskInstructionsData } from './TaskInstructionsModal';

interface AdditionalInstructionsEditorProps {
  section: { id: number; title: string; instructions_meta?: TaskInstructionsData | null };
  onSaved?: () => void;
}

export function AdditionalInstructionsEditor({ section, onSaved }: AdditionalInstructionsEditorProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const initial = (section.instructions_meta ?? null) as TaskInstructionsData | null;

  const handleSave = async (data: TaskInstructionsData) => {
    const updates: { instructions_meta: TaskInstructionsData } = { instructions_meta: data };
    await supabase.from('skyline_form_sections').update(updates).eq('id', section.id);
    setModalOpen(false);
    onSaved?.();
  };

  return (
    <Card>
      <h3 className="font-bold mb-2">Additional instructions</h3>
      <p className="text-sm text-gray-600 mb-4">
        Add general instructions that appear in the PDF but are not linked to a specific assessment task.
      </p>
      <Button variant="primary" onClick={() => setModalOpen(true)}>
        {initial ? 'Edit additional instructions' : 'Add additional instructions'}
      </Button>
      {modalOpen && (
        <TaskInstructionsModal
          isOpen
          onClose={() => setModalOpen(false)}
          rowLabel={section.title || 'Additional instructions'}
          initialData={initial}
          rowHelpFallback={null}
          uploadTarget={{ scope: 'section', id: section.id }}
          onSave={handleSave}
        />
      )}
    </Card>
  );
}

