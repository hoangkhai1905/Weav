import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, LoaderCircle, Mail, ShieldCheck } from 'lucide-react';
import { authApi } from '../api/auth.api';

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const requestCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const receipt = await authApi.requestPasswordReset(email);
      setChallengeId(receipt.challengeId);
      setMessage(`If the account is eligible, a code was sent. It expires in ${receipt.expiresIn} seconds.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not request a reset code.');
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const verification = await authApi.verifyOtp(challengeId, code);
      if (verification.purpose !== 'PASSWORD_RESET' || !verification.resetToken) {
        throw new Error('The verification response was invalid.');
      }
      await authApi.resetPassword(verification.resetToken, newPassword);
      navigate('/login', { replace: true, state: { message: 'Password reset. You can sign in now.' } });
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not reset password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 dark:bg-slate-950">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <Link to="/login" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-blue-600"><ArrowLeft size={14} />Back to sign in</Link>
        <div className="mt-6 flex size-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-400/10 dark:text-blue-300"><ShieldCheck size={22} /></div>
        <h1 className="mt-5 text-2xl font-bold text-slate-900 dark:text-slate-100">Reset your password</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Identity will send a one-time code to your account email.</p>

        {!challengeId ? (
          <form onSubmit={(event) => void requestCode(event)} className="mt-6 space-y-4">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300" htmlFor="reset-email">Email address</label>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 dark:border-slate-700 dark:bg-slate-800"><Mail size={15} className="text-slate-400" /><input id="reset-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none" /></div>
            <button disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">{loading && <LoaderCircle size={16} className="animate-spin" />}Send reset code</button>
          </form>
        ) : (
          <form onSubmit={(event) => void resetPassword(event)} className="mt-6 space-y-4">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300" htmlFor="reset-code">Verification code</label>
            <input id="reset-code" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-800" />
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300" htmlFor="reset-new-password">New password</label>
            <input id="reset-new-password" required minLength={8} maxLength={72} type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-800" />
            <button disabled={loading || code.length !== 6} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">{loading && <LoaderCircle size={16} className="animate-spin" />}Reset password</button>
          </form>
        )}
        {message && <p className="mt-4 text-xs font-medium text-emerald-600 dark:text-emerald-300">{message}</p>}
        {error && <p className="mt-4 text-xs font-medium text-rose-600 dark:text-rose-300">{error}</p>}
      </section>
    </main>
  );
}
