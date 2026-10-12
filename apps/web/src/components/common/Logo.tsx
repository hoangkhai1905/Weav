import { Link } from 'react-router-dom';
import { useI18nStore } from '../../store/useI18nStore';

interface LogoProps {
  collapsed?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
}

export function Logo({ collapsed = false, size = 'md', showSubtitle = true }: LogoProps) {
  const { t } = useI18nStore();
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
      <img
        src="/weav-logo.svg"
        alt={t('common.logo_alt')}
        className={`${imgSize} shrink-0 group-hover:scale-105 transition-transform duration-300`}
      />

      {!collapsed && (
        <div className="flex flex-col">
          <span className={`font-extrabold text-foreground ${titleSize} tracking-wider leading-none font-sans`}>
            WEAV
          </span>
          {showSubtitle && (
            <span className="text-[10px] text-muted-foreground font-semibold tracking-tight mt-0.5">
              {t('common.product_subtitle')}
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
