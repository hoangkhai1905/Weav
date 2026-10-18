import React, { useState } from 'react';
import { FieldShell } from './FieldShell';

interface CommaListInputProps {
  id: string;
  label: string;
  value: unknown;
  onChange: (items: string[]) => void;
  /** One sentence on what the field is for, shown under it. */
  hint?: string;
  placeholder?: string;
}

/** A comma-separated list. The raw text is kept while typing (so a trailing comma survives); the saved list is trimmed. */
export const CommaListInput: React.FC<CommaListInputProps> = ({ id, label, value, onChange, hint, placeholder }) => {
  const [text, setText] = useState(() => (Array.isArray(value) ? value.join(', ') : ''));
  return (
    <FieldShell id={id} label={label} hint={hint}>
      {({ id: inputId, describedBy }) => (
        <input
          id={inputId}
          aria-describedby={describedBy}
          placeholder={placeholder}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onChange(event.target.value.split(',').map((item) => item.trim()).filter(Boolean));
          }}
          onBlur={() => setText((current) => current.split(',').map((item) => item.trim()).filter(Boolean).join(', '))}
          className="w-full rounded-md border border-border-strong bg-card px-3 py-2 text-[13px] text-foreground outline-none hover:border-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring"
        />
      )}
    </FieldShell>
  );
};
