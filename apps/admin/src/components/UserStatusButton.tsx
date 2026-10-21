import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { ApiError } from '../api/client';
import { changeStatus, type AdminUser } from '../api/users';
import { useT } from '../lib/i18n';
import { getProfile } from '../lib/session';
import { btnCls } from '../lib/ui';
import { ConfirmDialog } from './ConfirmDialog';

const rowBtnCls = btnCls.replace('h-8', 'h-7').replace('px-3 text-[13px]', 'px-2.5 text-xs');
const disableBtnCls = rowBtnCls.replace('text-foreground', 'text-err').replace('hover:bg-subtle', 'hover:bg-err-bg');

interface Props {
  user: AdminUser;
  onChanged: (updated: AdminUser) => void;
  /** Called with an empty string when a new attempt starts, or with a friendly message when it fails. */
  onError: (message: string) => void;
}

/** Disable (after confirming) / Enable button. Renders nothing for admins and for yourself: Identity refuses those anyway. */
export function UserStatusButton({ user, onChanged, onError }: Props) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (user.systemRole === 'ADMIN' || user.id === getProfile()?.id) return null;

  const active = user.status === 'ACTIVE';
  const label = active ? t('users.disable') : t('users.enable');

  const apply = async () => {
    setConfirming(false);
    setBusy(true);
    onError('');
    try {
      onChanged(await changeStatus(user.id, active ? 'DISABLED' : 'ACTIVE'));
    } catch (error) {
      onError(error instanceof ApiError && error.status === 409 ? t('users.locked_error') : t('users.status_error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-label={`${label}: ${user.email}`}
        onClick={() => (active ? setConfirming(true) : void apply())}
        className={active ? disableBtnCls : rowBtnCls}
      >
        {busy && <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />}
        {label}
      </button>
      <ConfirmDialog
        open={confirming}
        danger
        title={t('users.disable_title')}
        description={<><strong className="font-semibold text-foreground">{user.email}</strong><br />{t('users.disable_confirm')}</>}
        confirmText={t('users.disable')}
        onConfirm={apply}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
