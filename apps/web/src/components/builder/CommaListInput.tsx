import React, { useState } from 'react';

interface CommaListInputProps {
  id: string;
  label: string;
  value: unknown;
  onChange: (items: string[]) => void;
}

/** A comma-separated list. The raw text is kept while typing (so a trailing comma survives); the saved list is trimmed. */
export const CommaListInput: React.FC<CommaListInputProps> = ({ id, label, value, onChange }) => {
  const [text, setText] = useState(() => (Array.isArray(value) ? value.join(', ') : ''));
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-text-2">{label}</label>
      <input
        id={id}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(event.target.value.split(',').map((item) => item.trim()).filter(Boolean));
        }}
        onBlur={() => setText((current) => current.split(',').map((item) => item.trim()).filter(Boolean).join(', '))}
        className="w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
      />
    </div>
  );
};
