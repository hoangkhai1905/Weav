import { gatewayRequest } from './auth.api';

export type AdminUserStatus = 'ACTIVE' | 'DISABLED';

export interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  systemRole: 'USER' | 'ADMIN';
  status: AdminUserStatus;
  createdAt: string;
  emailVerifiedAt: string | null;
  avatarPresent: boolean;
}

export interface AdminUserPage {
  items: AdminUser[];
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
}

/** Gateway GET/PATCH /api/admin/users (ADMIN only; Identity re-checks the role). */
export const adminApi = {
  listUsers(params: { page: number; size?: number; search?: string; status?: AdminUserStatus }): Promise<AdminUserPage> {
    return gatewayRequest<AdminUserPage>({
      method: 'GET',
      url: '/api/admin/users',
      params: { page: params.page, size: params.size ?? 20, search: params.search || undefined, status: params.status },
    });
  },

  changeStatus(userId: string, status: AdminUserStatus): Promise<AdminUser> {
    return gatewayRequest<AdminUser>({
      method: 'PATCH',
      url: `/api/admin/users/${encodeURIComponent(userId)}/status`,
      data: { status },
    });
  },
};
