import React, { useState, useEffect, useCallback } from 'react';
import { Users, Plus, Search, Edit, Trash2, Shield, Key, Lock, Unlock, CheckCircle, XCircle, Mail, Phone, Calendar, User, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { assignRole, getUsers, revokeRole, updateUserProfile, walletRegister, useTranslation, RestrictedSection } from '@medichain/shared';
import { useToastActions } from '../components/Toast';

type UserRole = 'admin' | 'doctor' | 'nurse' | 'lab-technician' | 'pharmacist' | 'patient';
type UserStatus = 'active' | 'inactive' | 'suspended' | 'pending';

interface SystemUser {
  userId: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  status: UserStatus;
  department?: string;
  licenseNumber?: string;
  specialization?: string;
  createdAt: string;
  lastLogin?: string;
  permissions: string[];
  emergencyContact?: string;
  notes?: string;
}

interface Permission {
  id: string;
  name: string;
  description: string;
  category: 'clinical' | 'administrative' | 'system';
}

function normalizeUserRole(role?: string): UserRole {
  switch (role?.toLowerCase()) {
    case 'labtechnician':
    case 'lab_technician':
    case 'lab-technician':
      return 'lab-technician';
    case 'admin':
    case 'doctor':
    case 'nurse':
    case 'pharmacist':
    case 'patient':
      return role.toLowerCase() as UserRole;
    default:
      return 'patient';
  }
}

const UserManagementPage: React.FC = () => {
  // This section is administrator-only server-side; without this the page
  // received a correct 403 and then rendered nothing, which reads as a fault
  // rather than a permissions boundary.
  // Administrator-only, gated after the hooks rather than before them:
  // returning early above meant a non-administrator render ran a dozen fewer
  // hooks, and React throws "Rendered fewer hooks than expected" the moment the
  // role changes without a remount.
  const { user } = useAuthStore();
  const isAdministrator = user?.role === 'Admin';
  const { t } = useTranslation();
  const { showSuccess, showError, showWarning } = useToastActions();
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'users' | 'roles' | 'permissions' | 'new-user'>('users');
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'all'>('all');
  const [selectedUser, setSelectedUser] = useState<SystemUser | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [newUser, setNewUser] = useState({
    walletAddress: '',
    username: '',
    name: '',
    email: '',
    phone: '',
    role: 'doctor' as UserRole,
    department: '',
    licenseNumber: '',
    specialization: '',
    emergencyContact: '',
    notes: '',
  });

  const availablePermissions: Permission[] = [
    { id: 'view_patients', name: t('docUserManagement.permission_view_patients_name'), description: t('docUserManagement.permission_view_patients_desc'), category: 'clinical' },
    { id: 'edit_patients', name: t('docUserManagement.permission_edit_patients_name'), description: t('docUserManagement.permission_edit_patients_desc'), category: 'clinical' },
    { id: 'prescribe_medications', name: t('docUserManagement.permission_prescribe_medications_name'), description: t('docUserManagement.permission_prescribe_medications_desc'), category: 'clinical' },
    { id: 'order_labs', name: t('docUserManagement.permission_order_labs_name'), description: t('docUserManagement.permission_order_labs_desc'), category: 'clinical' },
    { id: 'order_imaging', name: t('docUserManagement.permission_order_imaging_name'), description: t('docUserManagement.permission_order_imaging_desc'), category: 'clinical' },
    { id: 'view_lab_results', name: t('docUserManagement.permission_view_lab_results_name'), description: t('docUserManagement.permission_view_lab_results_desc'), category: 'clinical' },
    { id: 'document_notes', name: t('docUserManagement.permission_document_notes_name'), description: t('docUserManagement.permission_document_notes_desc'), category: 'clinical' },
    { id: 'emergency_access', name: t('docUserManagement.permission_emergency_access_name'), description: t('docUserManagement.permission_emergency_access_desc'), category: 'clinical' },
    { id: 'manage_users', name: t('docUserManagement.permission_manage_users_name'), description: t('docUserManagement.permission_manage_users_desc'), category: 'administrative' },
    { id: 'manage_roles', name: t('docUserManagement.permission_manage_roles_name'), description: t('docUserManagement.permission_manage_roles_desc'), category: 'administrative' },
    { id: 'view_audit_logs', name: t('docUserManagement.permission_view_audit_logs_name'), description: t('docUserManagement.permission_view_audit_logs_desc'), category: 'administrative' },
    { id: 'manage_settings', name: t('docUserManagement.permission_manage_settings_name'), description: t('docUserManagement.permission_manage_settings_desc'), category: 'system' },
    { id: 'system_admin', name: t('docUserManagement.permission_system_admin_name'), description: t('docUserManagement.permission_system_admin_desc'), category: 'system' },
  ];

  // Fetch users from API
  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fetchedUsers = await getUsers();
      
      // Defensive check: ensure we have an array
      if (!Array.isArray(fetchedUsers)) {
        console.warn('[MediChain] getUsers returned non-array:', fetchedUsers);
        setUsers([]);
        return;
      }
      
      // Map API response to SystemUser interface
      const mappedUsers: SystemUser[] = fetchedUsers.map((u: { user_id?: string; userId?: string; wallet_address?: string; name?: string; email?: string; phone?: string; role?: string; status?: string; department?: string; license_number?: string; licenseNumber?: string; specialization?: string; created_at?: string; createdAt?: string; last_login?: string; lastLogin?: string; permissions?: string[]; emergency_contact?: string; emergencyContact?: string; notes?: string }) => ({
        userId: u.wallet_address || u.user_id || u.userId || '',
        name: u.name || '',
        email: u.email || '',
        phone: u.phone || '',
        role: normalizeUserRole(u.role),
        status: (u.status as UserStatus) || 'active',
        department: u.department,
        licenseNumber: u.license_number || u.licenseNumber,
        specialization: u.specialization,
        createdAt: u.created_at || u.createdAt || new Date().toISOString(),
        lastLogin: u.last_login || u.lastLogin,
        permissions: u.permissions || [],
        emergencyContact: u.emergency_contact || u.emergencyContact,
        notes: u.notes,
      }));
      setUsers(mappedUsers);
    } catch (err) {
      console.error('Failed to fetch users:', err);
      setError(err instanceof Error ? err.message : t('docUserManagement.loadUsersError'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Skip the request, not the hook: a non-administrator would otherwise
    // spend a call to be told 403 on a screen they cannot see.
    if (!isAdministrator) return;
    fetchUsers();
  }, [fetchUsers, isAdministrator]);

  const handleCreateUser = async () => {
    if (!newUser.walletAddress || !newUser.name || !newUser.email || !newUser.phone) {
      showWarning(t('docUserManagement.warnRequiredFields'));
      return;
    }

    try {
      const result = await walletRegister({
        wallet_address: newUser.walletAddress.trim(),
        name: newUser.name.trim(),
        username: newUser.username.trim() || undefined,
        role: newUser.role,
        email: newUser.email.trim(),
        phone: newUser.phone.trim(),
        department: newUser.department.trim() || undefined,
        specialty: newUser.specialization.trim() || undefined,
        license_number: newUser.licenseNumber.trim() || undefined,
      });
      await fetchUsers();
      setNewUser({ walletAddress: '', username: '', name: '', email: '', phone: '', role: 'doctor', department: '', licenseNumber: '', specialization: '', emergencyContact: '', notes: '' });
      setActiveTab('users');
      showSuccess(t('docUserManagement.userCreatedSuccess', { id: result.wallet_address }));
    } catch (err) {
      showError(err instanceof Error ? err.message : t('docUserManagement.loadUsersError'));
    }
  };

  const handleUpdateUser = async () => {
    if (!selectedUser) return;

    try {
      await updateUserProfile(selectedUser.userId, {
        name: selectedUser.name,
        email: selectedUser.email || undefined,
        phone: selectedUser.phone || undefined,
        department: selectedUser.department,
        specialty: selectedUser.specialization,
        license_number: selectedUser.licenseNumber,
      });
      const persistedRole = users.find((user) => user.userId === selectedUser.userId)?.role;
      if (persistedRole !== selectedUser.role) {
        await assignRole({
          wallet_address: selectedUser.userId,
          name: selectedUser.name,
          role: selectedUser.role,
        });
      }
      await fetchUsers();
      setShowEditModal(false);
      setSelectedUser(null);
      showSuccess(t('docUserManagement.userUpdatedSuccess'));
    } catch (err) {
      showError(err instanceof Error ? err.message : t('docUserManagement.loadUsersError'));
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (confirm(t('docUserManagement.confirmDeleteUser'))) {
      try {
        await revokeRole({ wallet_address: userId });
        await fetchUsers();
        showSuccess(t('docUserManagement.userDeletedSuccess'));
      } catch (err) {
        showError(err instanceof Error ? err.message : t('docUserManagement.loadUsersError'));
      }
    }
  };

  const handleTogglePermission = (permissionId: string) => {
    if (!selectedUser) return;

    const hasPermission = selectedUser.permissions.includes(permissionId);
    const updatedPermissions = hasPermission
      ? selectedUser.permissions.filter((p) => p !== permissionId)
      : [...selectedUser.permissions, permissionId];

    setSelectedUser({ ...selectedUser, permissions: updatedPermissions });
  };

  const handleStatusChange = async (userId: string, newStatus: UserStatus) => {
    try {
      await updateUserProfile(userId, { status: newStatus });
      await fetchUsers();
      showSuccess(t('docUserManagement.statusChangedSuccess', { status: t(`docUserManagement.status_${newStatus}`) }));
    } catch (err) {
      showError(err instanceof Error ? err.message : t('docUserManagement.loadUsersError'));
    }
  };

  const getRoleBadge = (role: UserRole) => {
    const badges = {
      admin: 'bg-purple-100 text-purple-800',
      doctor: 'bg-notice-subtle text-notice-subtle-fg',
      nurse: 'bg-ok-subtle text-ok-subtle-fg',
      'lab-technician': 'bg-caution-subtle text-caution-subtle-fg',
      pharmacist: 'bg-pink-100 text-pink-800',
      patient: 'bg-surface-sunken text-content-secondary',
    };
    return badges[role];
  };

  const getStatusBadge = (status: UserStatus) => {
    const badges = {
      active: 'bg-ok-subtle text-ok-subtle-fg',
      inactive: 'bg-surface-sunken text-content-secondary',
      suspended: 'bg-critical-subtle text-critical-subtle-fg',
      pending: 'bg-caution-subtle text-caution-subtle-fg',
    };
    return badges[status];
  };

  const getStatusIcon = (status: UserStatus) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="w-4 h-4 text-ok-subtle-fg" />;
      case 'inactive':
        return <XCircle className="w-4 h-4 text-content-muted" />;
      case 'suspended':
        return <Lock className="w-4 h-4 text-critical-subtle-fg" />;
      case 'pending':
        return <Calendar className="w-4 h-4 text-caution-subtle-fg" />;
    }
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleString();
  };

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      (u.userId?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (u.name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (u.email?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    const matchesStatus = statusFilter === 'all' || u.status === statusFilter;
    return matchesSearch && matchesRole && matchesStatus;
  });

  const getRolePermissions = (role: UserRole): Permission[] => {
    const rolePermissionIds: { [key in UserRole]: string[] } = {
      admin: ['view_patients', 'edit_patients', 'manage_users', 'manage_roles', 'view_audit_logs', 'manage_settings', 'system_admin'],
      doctor: ['view_patients', 'edit_patients', 'prescribe_medications', 'order_labs', 'order_imaging', 'view_lab_results', 'document_notes', 'emergency_access'],
      nurse: ['view_patients', 'edit_patients', 'view_lab_results', 'document_notes'],
      'lab-technician': ['view_patients', 'view_lab_results', 'document_notes'],
      pharmacist: ['view_patients', 'prescribe_medications', 'view_lab_results'],
      patient: ['view_patients'],
    };

    return availablePermissions.filter((p) => rolePermissionIds[role].includes(p.id));
  };

  // Safe here: every hook above has already run, so the hook count is identical
  // for an administrator and for anyone else.
  if (!isAdministrator) {
    return (
      <RestrictedSection
        title="User management"
        audience="administrators"
        currentRole={user?.role}
      />
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="bg-gradient-to-r from-purple-600 to-indigo-500 text-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold mb-2">{t('docUserManagement.title')}</h1>
        <p className="text-purple-100">{t('docUserManagement.subtitle')}</p>
      </div>

      <div className="flex gap-2 mb-6 border-b">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'users' ? 'text-purple-700 border-b-2 border-purple-700' : 'text-content-muted hover:text-purple-700'
          }`}
        >
          {t('docUserManagement.tabAllUsers', { count: users.length })}
        </button>
        <button
          onClick={() => setActiveTab('new-user')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'new-user' ? 'text-purple-700 border-b-2 border-purple-700' : 'text-content-muted hover:text-purple-700'
          }`}
        >
          {t('docUserManagement.tabNewUser')}
        </button>
        <button
          onClick={() => setActiveTab('roles')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'roles' ? 'text-purple-700 border-b-2 border-purple-700' : 'text-content-muted hover:text-purple-700'
          }`}
        >
          {t('docUserManagement.tabRolesPermissions')}
        </button>
      </div>

      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="bg-surface rounded-lg shadow-sm border border-border p-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label htmlFor="user-search" className="block text-sm font-semibold text-content-secondary mb-2">{t('docUserManagement.searchLabel')}</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-content-muted w-5 h-5" />
                  <input
                    id="user-search"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={t('docUserManagement.searchPlaceholder')}
                    className="w-full pl-10 pr-4 py-2 border border-border-strong rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="user-role-filter" className="block text-sm font-semibold text-content-secondary mb-2">{t('docUserManagement.roleLabel')}</label>
                <select
                  id="user-role-filter"
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as UserRole | 'all')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                >
                  <option value="all">{t('docUserManagement.allRoles')}</option>
                  <option value="admin">{t('docUserManagement.role_admin')}</option>
                  <option value="doctor">{t('docUserManagement.role_doctor')}</option>
                  <option value="nurse">{t('docUserManagement.role_nurse')}</option>
                  <option value="lab-technician">{t('docUserManagement.role_lab-technician')}</option>
                  <option value="pharmacist">{t('docUserManagement.role_pharmacist')}</option>
                </select>
              </div>
              <div>
                <label htmlFor="user-status-filter" className="block text-sm font-semibold text-content-secondary mb-2">{t('docUserManagement.statusLabel')}</label>
                <select
                  id="user-status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as UserStatus | 'all')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                >
                  <option value="all">{t('docUserManagement.allStatuses')}</option>
                  <option value="active">{t('docUserManagement.status_active')}</option>
                  <option value="inactive">{t('docUserManagement.status_inactive')}</option>
                  <option value="suspended">{t('docUserManagement.status_suspended')}</option>
                  <option value="pending">{t('docUserManagement.status_pending')}</option>
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {filteredUsers.map((systemUser) => (
              <div key={systemUser.userId} className="border border-border-strong rounded-lg shadow-sm bg-surface p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <div className="bg-purple-100 rounded-full p-3">
                      <User className="w-8 h-8 text-purple-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-bold text-content">{systemUser.name}</h3>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getRoleBadge(systemUser.role)}`}>
                          {t(`docUserManagement.role_${systemUser.role}`).toUpperCase()}
                        </span>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${getStatusBadge(systemUser.status)}`}>
                          {getStatusIcon(systemUser.status)}
                          {t(`docUserManagement.status_${systemUser.status}`).toUpperCase()}
                        </span>
                      </div>
                      <p className="text-sm text-content-muted flex items-center gap-1">
                        <Mail className="w-4 h-4" />
                        {systemUser.email}
                      </p>
                      <p className="text-sm text-content-muted flex items-center gap-1">
                        <Phone className="w-4 h-4" />
                        {systemUser.phone}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setSelectedUser(systemUser);
                        setShowEditModal(true);
                      }}
                      className="p-2 text-notice-subtle-fg hover:bg-notice-subtle rounded-lg transition-colors"
                      title={t('docUserManagement.editUserTitle')}
                    >
                      <Edit className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => {
                        setSelectedUser(systemUser);
                        setShowPermissionsModal(true);
                      }}
                      className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                      title={t('docUserManagement.managePermissionsTitle')}
                    >
                      <Shield className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleDeleteUser(systemUser.userId)}
                      className="p-2 text-critical-subtle-fg hover:bg-critical-subtle rounded-lg transition-colors"
                      title={t('docUserManagement.deleteUserTitle')}
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* `grid-cols-4` was fixed at every breakpoint and the cells
                    had no `min-w-0`. A wallet address is 48 unbreakable
                    characters, and a grid track cannot shrink below its
                    content's intrinsic width without `min-w-0` — so the first
                    column pushed past its share and the four values rendered
                    on top of each other. `break-all` lets the address wrap,
                    `min-w-0` lets the track shrink, and the column count now
                    steps down on narrow viewports instead of cramming four
                    columns into a phone. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4 bg-purple-50 rounded-lg p-4">
                  <div className="min-w-0">
                    <p className="text-sm text-purple-900 font-semibold mb-1">{t('docUserManagement.userIdLabel')}</p>
                    {/* Monospaced and selectable: this is an identifier someone
                        copies, and proportional type makes a transposed
                        character in an SS58 address genuinely hard to spot. */}
                    <p
                      className="font-mono text-xs text-content break-all select-all"
                      title={systemUser.userId}
                    >
                      {systemUser.userId}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-purple-900 font-semibold mb-1">{t('docUserManagement.departmentLabel')}</p>
                    <p className="text-sm text-content break-words">{systemUser.department || t('docUserManagement.notAssigned')}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-purple-900 font-semibold mb-1">{t('docUserManagement.licenseNumberLabel')}</p>
                    <p className="text-sm text-content break-words">{systemUser.licenseNumber || t('docUserManagement.na')}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-purple-900 font-semibold mb-1">{t('docUserManagement.specializationLabel')}</p>
                    <p className="text-sm text-content break-words">{systemUser.specialization || t('docUserManagement.na')}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-notice-subtle border border-notice rounded-lg p-3">
                    <p className="text-sm font-semibold text-notice-subtle-fg mb-1">{t('docUserManagement.createdLabel')}</p>
                    <p className="text-sm text-notice-subtle-fg">{formatDate(systemUser.createdAt)}</p>
                  </div>
                  <div className="bg-ok-subtle border border-ok rounded-lg p-3">
                    <p className="text-sm font-semibold text-ok-subtle-fg mb-1">{t('docUserManagement.lastLoginLabel')}</p>
                    <p className="text-sm text-ok-subtle-fg">{systemUser.lastLogin ? formatDate(systemUser.lastLogin) : t('docUserManagement.never')}</p>
                  </div>
                </div>

                <div className="bg-surface-sunken border border-border rounded-lg p-4 mb-4">
                  <p className="text-sm font-semibold text-content mb-2 flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    {t('docUserManagement.permissionsCount', { count: systemUser.permissions.length })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {systemUser.permissions.length > 0 ? (
                      systemUser.permissions.map((perm) => (
                        <span key={perm} className="px-2 py-1 bg-surface border border-border-strong rounded text-xs text-content-secondary">
                          {t(`docUserManagement.permission_${perm}_name`)}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-content-muted">{t('docUserManagement.noPermissionsAssigned')}</span>
                    )}
                  </div>
                </div>

                {systemUser.notes && (
                  <div className="bg-caution-subtle border border-caution rounded-lg p-3">
                    <p className="text-sm font-semibold text-caution-subtle-fg mb-1">{t('docUserManagement.notesLabel')}</p>
                    <p className="text-sm text-caution-subtle-fg">{systemUser.notes}</p>
                  </div>
                )}

                <div className="mt-4 pt-4 border-t flex gap-2">
                  {systemUser.status === 'active' && (
                    <button
                      onClick={() => handleStatusChange(systemUser.userId, 'inactive')}
                      className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors flex items-center gap-2"
                    >
                      <XCircle className="w-4 h-4" />
                      {t('docUserManagement.deactivateButton')}
                    </button>
                  )}
                  {systemUser.status === 'inactive' && (
                    <button
                      onClick={() => handleStatusChange(systemUser.userId, 'active')}
                      className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm transition-colors flex items-center gap-2"
                    >
                      <CheckCircle className="w-4 h-4" />
                      {t('docUserManagement.activateButton')}
                    </button>
                  )}
                  {systemUser.status === 'pending' && (
                    <button
                      onClick={() => handleStatusChange(systemUser.userId, 'active')}
                      className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm transition-colors flex items-center gap-2"
                    >
                      <CheckCircle className="w-4 h-4" />
                      {t('docUserManagement.approveButton')}
                    </button>
                  )}
                  {systemUser.status !== 'suspended' && (
                    <button
                      onClick={() => handleStatusChange(systemUser.userId, 'suspended')}
                      className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm transition-colors flex items-center gap-2"
                    >
                      <Lock className="w-4 h-4" />
                      {t('docUserManagement.suspendButton')}
                    </button>
                  )}
                  {systemUser.status === 'suspended' && (
                    <button
                      onClick={() => handleStatusChange(systemUser.userId, 'active')}
                      className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm transition-colors flex items-center gap-2"
                    >
                      <Unlock className="w-4 h-4" />
                      {t('docUserManagement.unsuspendButton')}
                    </button>
                  )}
                </div>
              </div>
            ))}

            {filteredUsers.length === 0 && (
              <div className="bg-surface-sunken border border-border rounded-lg p-8 text-center">
                <Users className="w-12 h-12 text-content-muted mx-auto mb-3" />
                <p className="text-content-muted">{t('docUserManagement.noUsersFound')}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'new-user' && (
        <div className="bg-surface rounded-lg shadow-sm border border-border p-6">
          <h2 className="text-xl font-bold text-content mb-6">{t('docUserManagement.createNewUserTitle')}</h2>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="new-user-wallet" className="block text-sm font-semibold text-content-secondary mb-2">
                  Wallet address <span className="text-critical-subtle-fg">*</span>
                </label>
                <input
                  id="new-user-wallet"
                  type="text"
                  value={newUser.walletAddress}
                  onChange={(e) => setNewUser({ ...newUser, walletAddress: e.target.value })}
                  placeholder="SS58 wallet address"
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                  required
                />
              </div>
              <div>
                <label htmlFor="new-user-name" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docUserManagement.fullNameLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <input
                  id="new-user-name"
                  type="text"
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  placeholder={t('docUserManagement.fullNamePlaceholder')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                  required
                />
              </div>
              <div>
                <label htmlFor="new-user-username" className="block text-sm font-semibold text-content-secondary mb-2">Username</label>
                <input
                  id="new-user-username"
                  type="text"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label htmlFor="new-user-role" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docUserManagement.roleLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <select
                  id="new-user-role"
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                  required
                >
                  <option value="doctor">{t('docUserManagement.role_doctor')}</option>
                  <option value="nurse">{t('docUserManagement.role_nurse')}</option>
                  <option value="lab-technician">{t('docUserManagement.role_lab-technician')}</option>
                  <option value="pharmacist">{t('docUserManagement.role_pharmacist')}</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="new-user-email" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docUserManagement.emailLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <input
                  id="new-user-email"
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder={t('docUserManagement.emailPlaceholder')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                  required
                />
              </div>
              <div>
                <label htmlFor="new-user-phone" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docUserManagement.phoneLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <input
                  id="new-user-phone"
                  type="tel"
                  value={newUser.phone}
                  onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                  placeholder={t('docUserManagement.phonePlaceholder')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="new-user-department" className="block text-sm font-semibold text-content-secondary mb-2">{t('docUserManagement.departmentLabel')}</label>
                <input
                  id="new-user-department"
                  type="text"
                  value={newUser.department}
                  onChange={(e) => setNewUser({ ...newUser, department: e.target.value })}
                  placeholder={t('docUserManagement.departmentPlaceholder')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label htmlFor="new-user-license" className="block text-sm font-semibold text-content-secondary mb-2">{t('docUserManagement.licenseNumberLabel')}</label>
                <input
                  id="new-user-license"
                  type="text"
                  value={newUser.licenseNumber}
                  onChange={(e) => setNewUser({ ...newUser, licenseNumber: e.target.value })}
                  placeholder={t('docUserManagement.licenseNumberPlaceholder')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="new-user-specialization" className="block text-sm font-semibold text-content-secondary mb-2">{t('docUserManagement.specializationLabel')}</label>
                <input
                  id="new-user-specialization"
                  type="text"
                  value={newUser.specialization}
                  onChange={(e) => setNewUser({ ...newUser, specialization: e.target.value })}
                  placeholder={t('docUserManagement.specializationPlaceholder')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label htmlFor="new-user-emergency-contact" className="block text-sm font-semibold text-content-secondary mb-2">{t('docUserManagement.emergencyContactLabel')}</label>
                <input
                  id="new-user-emergency-contact"
                  type="tel"
                  value={newUser.emergencyContact}
                  onChange={(e) => setNewUser({ ...newUser, emergencyContact: e.target.value })}
                  placeholder={t('docUserManagement.emergencyContactPlaceholder')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                />
              </div>
            </div>

            <div>
              <label htmlFor="new-user-notes" className="block text-sm font-semibold text-content-secondary mb-2">{t('docUserManagement.notesLabel')}</label>
              <textarea
                id="new-user-notes"
                value={newUser.notes}
                onChange={(e) => setNewUser({ ...newUser, notes: e.target.value })}
                placeholder={t('docUserManagement.notesPlaceholder')}
                rows={3}
                className="w-full border border-border-strong rounded-lg px-3 py-2"
              />
            </div>

            <button
              onClick={handleCreateUser}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              {t('docUserManagement.createUserButton')}
            </button>
          </div>
        </div>
      )}
      {activeTab === 'roles' && (
        <div className="space-y-6">
          <div className="bg-surface rounded-lg shadow-sm border border-border p-6">
            <h2 className="text-xl font-bold text-content mb-6">{t('docUserManagement.roleBasedPermissionsTitle')}</h2>
            <p className="text-sm text-content-muted mb-6">
              {t('docUserManagement.roleBasedPermissionsDesc')}
            </p>

            <div className="space-y-6">
              {(['admin', 'doctor', 'nurse', 'lab-technician', 'pharmacist', 'patient'] as UserRole[]).map((role) => (
                <div key={role} className="border border-border-strong rounded-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <Shield className="w-6 h-6 text-purple-600" />
                      <h3 className="text-lg font-bold text-content">{t(`docUserManagement.role_${role}`).toUpperCase()}</h3>
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getRoleBadge(role)}`}>
                        {t('docUserManagement.usersCountSuffix', { count: users.filter((u) => u.role === role).length })}
                      </span>
                    </div>
                  </div>

                  <div className="bg-surface-sunken rounded-lg p-4">
                    <p className="text-sm font-semibold text-content mb-3">{t('docUserManagement.defaultPermissionsLabel')}</p>
                    <div className="grid grid-cols-3 gap-3">
                      {getRolePermissions(role).map((perm) => (
                        <div key={perm.id} className="bg-surface border border-border rounded-lg p-3">
                          <p className="text-sm font-semibold text-content mb-1">{perm.name}</p>
                          <p className="text-xs text-content-muted">{perm.description}</p>
                          <span
                            className={`inline-block mt-2 px-2 py-1 rounded text-xs font-semibold ${
                              perm.category === 'clinical'
                                ? 'bg-notice-subtle text-notice-subtle-fg'
                                : perm.category === 'administrative'
                                ? 'bg-purple-100 text-purple-800'
                                : 'bg-critical-subtle text-critical-subtle-fg'
                            }`}
                          >
                            {t(`docUserManagement.category_${perm.category}`)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface rounded-lg shadow-sm border border-border p-6">
            <h2 className="text-xl font-bold text-content mb-6">{t('docUserManagement.allAvailablePermissionsTitle')}</h2>

            <div className="space-y-6">
              {(['clinical', 'administrative', 'system'] as const).map((category) => (
                <div key={category} className="border border-border-strong rounded-lg p-6">
                  <h3 className="text-lg font-bold text-content mb-4 capitalize">{t('docUserManagement.categoryPermissionsHeading', { category: t(`docUserManagement.category_${category}`) })}</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {availablePermissions
                      .filter((p) => p.category === category)
                      .map((perm) => (
                        <div key={perm.id} className="bg-surface-sunken border border-border rounded-lg p-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-semibold text-content mb-1">{perm.name}</p>
                              <p className="text-sm text-content-muted">{perm.description}</p>
                            </div>
                            <Key className="w-5 h-5 text-content-muted" />
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showEditModal && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-surface rounded-lg shadow-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-content">{t('docUserManagement.editUserTitle')}</h2>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setSelectedUser(null);
                }}
                className="text-content-muted hover:text-content-secondary"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="usermgmt-full-name" className="block text-sm font-semibold text-content-secondary mb-2">{t('docUserManagement.fullNameLabel')}</label>
                  <input
                    id="usermgmt-full-name"
                    type="text"
                    value={selectedUser.name}
                    onChange={(e) => setSelectedUser({ ...selectedUser, name: e.target.value })}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="usermgmt-role" className="block text-sm font-semibold text-content-secondary mb-2">{t('docUserManagement.roleLabel')}</label>
                  <select
                    id="usermgmt-role"
                    value={selectedUser.role}
                    onChange={(e) => setSelectedUser({ ...selectedUser, role: e.target.value as UserRole })}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  >
                    <option value="admin">{t('docUserManagement.role_admin')}</option>
                    <option value="doctor">{t('docUserManagement.role_doctor')}</option>
                    <option value="nurse">{t('docUserManagement.role_nurse')}</option>
                    <option value="lab-technician">{t('docUserManagement.role_lab-technician')}</option>
                    <option value="pharmacist">{t('docUserManagement.role_pharmacist')}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="usermgmt-email" className="block text-sm font-semibold text-content-secondary mb-2">{t('docUserManagement.emailLabel')}</label>
                  <input
                    id="usermgmt-email"
                    type="email"
                    value={selectedUser.email}
                    onChange={(e) => setSelectedUser({ ...selectedUser, email: e.target.value })}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="usermgmt-phone" className="block text-sm font-semibold text-content-secondary mb-2">{t('docUserManagement.phoneLabel')}</label>
                  <input
                    id="usermgmt-phone"
                    type="tel"
                    value={selectedUser.phone}
                    onChange={(e) => setSelectedUser({ ...selectedUser, phone: e.target.value })}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="usermgmt-department" className="block text-sm font-semibold text-content-secondary mb-2">{t('docUserManagement.departmentLabel')}</label>
                  <input
                    id="usermgmt-department"
                    type="text"
                    value={selectedUser.department || ''}
                    onChange={(e) => setSelectedUser({ ...selectedUser, department: e.target.value })}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="usermgmt-license-number" className="block text-sm font-semibold text-content-secondary mb-2">{t('docUserManagement.licenseNumberLabel')}</label>
                  <input
                    id="usermgmt-license-number"
                    type="text"
                    value={selectedUser.licenseNumber || ''}
                    onChange={(e) => setSelectedUser({ ...selectedUser, licenseNumber: e.target.value })}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="usermgmt-specialization" className="block text-sm font-semibold text-content-secondary mb-2">{t('docUserManagement.specializationLabel')}</label>
                <input
                  id="usermgmt-specialization"
                  type="text"
                  value={selectedUser.specialization || ''}
                  onChange={(e) => setSelectedUser({ ...selectedUser, specialization: e.target.value })}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="usermgmt-notes" className="block text-sm font-semibold text-content-secondary mb-2">{t('docUserManagement.notesLabel')}</label>
                <textarea
                  id="usermgmt-notes"
                  value={selectedUser.notes || ''}
                  onChange={(e) => setSelectedUser({ ...selectedUser, notes: e.target.value })}
                  rows={3}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleUpdateUser}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 rounded-lg transition-colors"
                >
                  {t('docUserManagement.updateUserButton')}
                </button>
                <button
                  onClick={() => {
                    setShowEditModal(false);
                    setSelectedUser(null);
                  }}
                  className="flex-1 bg-surface-sunken hover:bg-gray-300 text-content-secondary font-semibold py-2 rounded-lg transition-colors"
                >
                  {t('docUserManagement.cancelButton')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPermissionsModal && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-surface rounded-lg shadow-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-content">{t('docUserManagement.managePermissionsModalTitle', { name: selectedUser.name })}</h2>
              <button
                onClick={() => {
                  setShowPermissionsModal(false);
                  setUsers(users.map((u) => (u.userId === selectedUser.userId ? selectedUser : u)));
                  setSelectedUser(null);
                }}
                className="text-content-muted hover:text-content-secondary"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="mb-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
              <p className="text-sm text-purple-900">
                <strong>{t('docUserManagement.currentRoleLabel')}</strong> {t(`docUserManagement.role_${selectedUser.role}`).toUpperCase()}
              </p>
              <p className="text-sm text-purple-800 mt-1">
                {t('docUserManagement.selectedPermissionsCount', { selected: selectedUser.permissions.length, total: availablePermissions.length })}
              </p>
            </div>

            <div className="space-y-6">
              {(['clinical', 'administrative', 'system'] as const).map((category) => (
                <div key={category} className="border border-border-strong rounded-lg p-4">
                  <h3 className="text-lg font-bold text-content mb-4 capitalize">{t('docUserManagement.categoryPermissionsHeading', { category: t(`docUserManagement.category_${category}`) })}</h3>
                  <div className="space-y-3">
                    {availablePermissions
                      .filter((p) => p.category === category)
                      .map((perm) => (
                        <div
                          key={perm.id}
                          className="flex items-center justify-between p-3 bg-surface-sunken rounded-lg hover:bg-surface-sunken transition-colors"
                        >
                          <div className="flex-1">
                            <p className="font-semibold text-content">{perm.name}</p>
                            <p className="text-sm text-content-muted">{perm.description}</p>
                          </div>
                          <button
                            onClick={() => handleTogglePermission(perm.id)}
                            className={`ml-4 px-4 py-2 rounded-lg font-semibold transition-colors ${
                              selectedUser.permissions.includes(perm.id)
                                ? 'bg-green-500 text-white hover:bg-green-600'
                                : 'bg-surface-sunken text-content-secondary hover:bg-gray-300'
                            }`}
                          >
                            {selectedUser.permissions.includes(perm.id) ? (
                              <span className="flex items-center gap-2">
                                <CheckCircle className="w-4 h-4" />
                                {t('docUserManagement.enabledLabel')}
                              </span>
                            ) : (
                              <span className="flex items-center gap-2">
                                <XCircle className="w-4 h-4" />
                                {t('docUserManagement.disabledLabel')}
                              </span>
                            )}
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-6 border-t">
              <button
                onClick={() => {
                  setShowPermissionsModal(false);
                  setUsers(users.map((u) => (u.userId === selectedUser.userId ? selectedUser : u)));
                  setSelectedUser(null);
                  showSuccess(t('docUserManagement.permissionsUpdatedSuccess'));
                }}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                {t('docUserManagement.savePermissionsButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagementPage;
