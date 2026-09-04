import React, { useEffect, useState, useCallback } from 'react';
import { Check, X, UserPlus, Building2 } from 'lucide-react';
import type { WorkspaceMember } from '../types/workflow.types';
import { workspaceApi } from '../api/workspace.api';
import { useI18nStore } from '../store/useI18nStore';
import { ConfirmButton } from '../components/common/ConfirmButton';

export function WorkspacePage() {
  const { t } = useI18nStore();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');

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
    await workspaceApi.inviteMember(inviteEmail, 'MEMBER', true);
    setInviteEmail('');
    fetchMembers();
  };

  const handleRemove = async (id: string) => {
    if (confirm('Remove this member from workspace?')) {
      await workspaceApi.removeMember(id);
      fetchMembers();
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          {t('workspace.title')} <Building2 size={20} className="text-rose-500" />
        </h1>
        <p className="text-xs text-slate-600 dark:text-slate-400">{t('workspace.subtitle')}</p>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm dark:shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">WEAV Production Workspace</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Owner: Nguyễn Anh Xuân Trường • Created: August 1, 2026</p>
        </div>

        <form onSubmit={handleInvite} className="flex flex-wrap items-center gap-2">
          <input
            type="email"
            placeholder="colleague@company.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-rose-500"
          />
          <button
            type="submit"
            className="px-3.5 py-1.5 bg-gradient-to-r from-rose-500 to-indigo-600 hover:from-rose-600 hover:to-indigo-700 text-white rounded-xl text-xs font-bold shadow transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <UserPlus size={14} />
            <span>{t('workspace.invite_btn')}</span>
          </button>
        </form>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm dark:shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
            <thead className="bg-slate-100 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-5 py-3.5">Member</th>
                <th className="px-5 py-3.5">Email</th>
                <th className="px-5 py-3.5">Role</th>
                <th className="px-5 py-3.5">{t('workspace.can_publish')}</th>
                <th className="px-5 py-3.5">Joined</th>
                <th className="px-5 py-3.5 text-right">{t('workflows.col_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {members.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
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
                          : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 hover:bg-rose-500/20'
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
