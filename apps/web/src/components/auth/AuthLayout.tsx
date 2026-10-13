import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LanguageSwitch, ThemeToggle } from '../layout/ShellControls';
import { WeavMark } from '../common/WeavMark';
import { FOCUS_RING } from '../../lib/uiClasses';
import { AnimatedWorkflowShowcase } from './AnimatedWorkflowShowcase';

/** Sign-in / register / forgot-password shell: form on the left, the animated workflow diagram on the right (lg+). */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen w-full flex-wrap bg-background text-foreground">
      <div className="flex flex-[1_1_520px] flex-col px-6 py-6 sm:px-10">
        <header className="flex items-center gap-2.5">
          <Link to="/" className={`flex items-center gap-2.5 rounded-md ${FOCUS_RING}`}>
            <WeavMark className="h-7 w-7" />
            <span className="text-[17px] font-semibold">Weav</span>
          </Link>
          <div className="flex-1" />
          <LanguageSwitch />
          <ThemeToggle />
        </header>
        <main className="flex flex-1 items-center justify-center py-12">{children}</main>
      </div>
      <div className="hidden flex-[1_1_520px] lg:block">
        <AnimatedWorkflowShowcase />
      </div>
    </div>
  );
}
