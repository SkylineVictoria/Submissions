import React from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import type { LivePdfGenerateDialogProps } from '../../hooks/useInstancePdfDownload';

type Props = LivePdfGenerateDialogProps;

export const LivePdfGenerateConfirmDialog: React.FC<Props> = (props) => (
  <ConfirmDialog
    isOpen={props.isOpen}
    onClose={props.onClose}
    onConfirm={props.onConfirm}
    title={props.title}
    message={props.message}
    confirmLabel={props.confirmLabel}
    cancelLabel={props.cancelLabel}
    variant={props.variant}
  />
);
