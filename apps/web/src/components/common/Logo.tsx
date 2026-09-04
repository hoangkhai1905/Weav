import { Link } from 'react-router-dom';

interface LogoProps {
  collapsed?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
}

export function Logo({ collapsed = false, size = 'md', showSubtitle = true }: LogoProps) {
  let imgSize = 'w-9 h-9';
  let titleSize = 'text-base';

  if (size === 'sm') {
    imgSize = 'w-7 h-7';
    titleSize = 'text-sm';
  } else if (size === 'lg') {
    imgSize = 'w-11 h-11';
    titleSize = 'text-xl';
  }

  return (
    <Link to="/dashboard" className="flex items-center gap-3 overflow-hidden cursor-pointer select-none group">
      <div className="relative shrink-0">
        <img
          src="/logo.png"
          alt="WEAV Logo"
          className={`${imgSize} rounded-xl object-cover border border-blue-500/30 shadow-md shadow-blue-600/20 group-hover:scale-105 transition-transform duration-300`}
        />
        <div className="absolute inset-0 rounded-xl ring-1 ring-white/20 pointer-events-none" />
      </div>

      {!collapsed && (
        <div className="flex flex-col">
          <span className={`font-extrabold text-slate-900 dark:text-slate-100 ${titleSize} tracking-wider leading-none font-sans`}>
            WEAV
          </span>
          {showSubtitle && (
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold tracking-tight mt-0.5">
              AI Workflow Studio
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
