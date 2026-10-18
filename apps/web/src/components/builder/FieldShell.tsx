import React from 'react';

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  testId?: string;
  children: (a11y: { id: string; describedBy?: string }) => React.ReactNode;
}

/** Label, optional `*`, control, hint and error of one field, with the ids wired for assistive technology. */
export const FieldShell: React.FC<FieldShellProps> = ({ id, label, hint, error, required, testId, children }) => {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div data-testid={testId}>
      <label id={`${id}-label`} htmlFor={id} onClick={() => document.getElementById(id)?.focus()} className="mb-1 block text-[13px] font-medium text-foreground">
        {label}
        {required && <span aria-hidden="true" className="ml-0.5 text-err">*</span>}
      </label>
      {children({ id, describedBy })}
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="mt-1 text-[10px] text-err">{error}</p>}
    </div>
  );
};
