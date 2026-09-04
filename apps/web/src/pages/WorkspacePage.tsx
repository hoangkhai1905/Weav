import React, { useEffect, useState, useCallback } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, X, UserPlus, Building2, ShieldCheck, Users, Zap } from 'lucide-react';
import type { WorkspaceMember } from '../types/workflow.types';
import { workspaceApi } from '../api/workspace.api';
import { useI18nStore } from '../store/useI18nStore';
import { ConfirmButton } from '../components/common/ConfirmButton';
import { buttonPress, pageVariants, reducedMotionVariants, staggerContainer, staggerItem } from '../lib/motion';

export function WorkspacePage() {
  const { t } = useI18nStore();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const pageMotion = prefersReducedMotion ? reducedMotionVariants : pageVariants;
  const listMotion = prefersReducedMotion ? reducedMotionVariants : staggerContainer;
  const itemMotion = prefersReducedMotion ? reducedMotionVariants : staggerItem;

  const fetchMembers = useCallback(async () => {
    try {
      const list = await workspaceApi.getMembers();
      setMembers(list);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchMembers();
    });
  }, [fetchMembers]);

  const handleTogglePublish = async (m: WorkspaceMember) => {
    await workspaceApi.updatePublishPermission(m.id, !m.canPublishWorkflow);
    fetchMembers();
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setIsInviting(true);
    try {
      await workspaceApi.inviteMember(inviteEmail, 'MEMBER', true);
      setInviteEmail('');
      await fetchMembers();
    } finally {
      setIsInviting(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (confirm('Remove this member from workspace?')) {
      await workspaceApi.removeMember(id);
      fetchMembers();
    }
  };

  return (
    <motion.div
      data-testid="workspace-page"
      className="space-y-6 max-w-7xl mx-auto pb-10"
      initial="initial"
      animate="animate"
      variants={pageMotion}
    >
      <motion.div variants={itemMotion} className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-300">
            <Building2 size={17} aria-hidden="true" />
          </span>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{t('workspace.title')}</h1>
        </div>
        <p className="max-w-2xl text-xs text-slate-600 dark:text-slate-400">{t('workspace.subtitle')}</p>
      </motion.div>

      <motion.section variants={itemMotion} className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Workspace summary">
        {[
          { label: 'Members', value: members.length, icon: Users, tone: 'text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-400/10' },
          { label: 'Publishing access', value: members.filter((member) => member.canPublishWorkflow).length, icon: ShieldCheck, tone: 'text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-400/10' },
          { label: 'Environment', value: 'Prod', icon: Zap, tone: 'text-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-400/10' },
        ].map(({ label, value, icon: Icon, tone }) => (
          <motion.div key={label} variants={itemMotion} whileHover={prefersReducedMotion ? undefined : { y: -2, transition: { duration: 0.15 } }} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-lg">
            <span className={`flex size-9 items-center justify-center rounded-lg ${tone}`}><Icon size={17} aria-hidden="true" /></span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{label}</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">{value}</p>
            </div>
          </motion.div>
        ))}
      </motion.section>

      <motion.section variants={itemMotion} className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-xl md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">WEAV Production Workspace</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-500" />Active</span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Owner: Nguyễn Anh Xuân Trường • Created: August 1, 2026</p>
        </div>

        <form onSubmit={handleInvite} className="flex w-full flex-col gap-2 sm:flex-row md:w-auto" aria-label="Invite workspace member">
          <label className="sr-only" htmlFor="workspace-invite-email">Email address</label>
          <input
            id="workspace-invite-email"
            type="email"
            placeholder="colleague@company.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          <motion.button
            type="submit"
            disabled={isInviting}
            variants={buttonPress}
            whileHover="hover"
            whileTap="tap"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm shadow-blue-600/20 transition-colors hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
          >
            <UserPlus size={14} aria-hidden="true" />
            <span>{isInviting ? 'Inviting…' : t('workspace.invite_btn')}</span>
          </motion.button>
        </form>
      </motion.section>

      <motion.section variants={itemMotion} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div><h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Workspace members</h2><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Manage access and publishing permissions.</p></div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{members.length} total</span>
        </div>
        <div className="overflow-x-auto">
          <motion.table variants={listMotion} initial="initial" animate="animate" className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
            <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400 uppercase font-semibold text-[10px] tracking-wider">
              <tr>
                <th className="px-5 py-3.5">Member</th>
                <th className="px-5 py-3.5">Email</th>
                <th className="px-5 py-3.5">Role</th>
                <th className="px-5 py-3.5">{t('workspace.can_publish')}</th>
                <th className="px-5 py-3.5">Joined</th>
                <th className="px-5 py-3.5 text-right">{t('workflows.col_actions')}</th>
              </tr>
            </thead>
            <AnimatePresence initial={false}>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {members.map((m) => (
                <motion.tr key={m.id} layout variants={itemMotion} initial="initial" animate="animate" exit="exit" className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-5 py-4 font-bold text-slate-900 dark:text-slate-100 flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-rose-500 text-white flex items-center justify-center font-bold text-xs">
                      {m.name.slice(0, 2).toUpperCase()}
                    </div>
                    <span>{m.name}</span>
                  </td>

                  <td className="px-5 py-4 text-slate-500 dark:text-slate-400">{m.email}</td>

                  <td className="px-5 py-4">
                    <span
                      className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full border ${m.role === 'OWNER'
                          ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
                          : 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20'
                        }`}
                    >
                      {m.role}
                    </span>
                  </td>

                  <td className="px-5 py-4">
                    <button
                      onClick={() => handleTogglePublish(m)}
                      disabled={m.role === 'OWNER'}
                      className={`px-3 py-1 text-[11px] font-bold rounded-xl border flex items-center gap-1.5 transition-all cursor-pointer ${m.canPublishWorkflow
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                          : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20 hover:bg-amber-500/20'
                        }`}
                    >
                      {m.canPublishWorkflow ? <Check size={12} /> : <X size={12} />}
                      <span>{m.canPublishWorkflow ? 'Allowed' : 'Restricted'}</span>
                    </button>
                  </td>

                  <td className="px-5 py-4 text-slate-500 dark:text-slate-400 text-[11px]">{new Date(m.joinedAt).toLocaleDateString()}</td>

                  <td className="px-5 py-4 text-right">
                    {m.role !== 'OWNER' && (
                      <ConfirmButton
                        onConfirm={() => handleRemove(m.id)}
                        title="Xóa Thành viên Workspace"
                        description={`Bạn có chắc chắn muốn gỡ thành viên "${m.name}" (${m.email}) khỏi workspace không?`}
                        confirmText="Gỡ Thành viên"
                        cancelText="Hủy"
                        variant="danger"
                        className="px-2.5 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 rounded-lg transition-colors text-[11px] font-semibold cursor-pointer"
                      >
                        Remove
                      </ConfirmButton>
                    )}
                  </td>
                </motion.tr>
              ))}
            </tbody>
            </AnimatePresence>
          </motion.table>
        </div>
      </motion.section>
    </motion.div>
  );
}
