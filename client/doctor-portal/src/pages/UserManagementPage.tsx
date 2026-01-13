import React, { useState, useEffect, useCallback } from 'react';
import { Users, Plus, Search, Edit, Trash2, Shield, Key, Lock, Unlock, CheckCircle, XCircle, Mail, Phone, Calendar, User, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { getUsers, assignRole } from '@medichain/shared';

type UserRole = 'admin' | 'doctor' | 'nurse' | 'lab-technician' | 'pharmacist' | 'radiologist' | 'patient';
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

const UserManagementPage: React.FC = () => {
  const { user: _user } = useAuthStore();
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
    { id: 'view_patients', name: 'View Patients', description: 'View patient demographics and records', category: 'clinical' },
    { id: 'edit_patients', name: 'Edit Patients', description: 'Modify patient information', category: 'clinical' },
    { id: 'prescribe_medications', name: 'Prescribe Medications', description: 'Order and prescribe medications', category: 'clinical' },
    { id: 'order_labs', name: 'Order Labs', description: 'Request laboratory tests', category: 'clinical' },
    { id: 'order_imaging', name: 'Order Imaging', description: 'Request radiology studies', category: 'clinical' },
    { id: 'view_lab_results', name: 'View Lab Results', description: 'Access laboratory findings', category: 'clinical' },
    { id: 'document_notes', name: 'Document Notes', description: 'Create clinical documentation', category: 'clinical' },
    { id: 'emergency_access', name: 'Emergency Access', description: 'Break-glass access to restricted records', category: 'clinical' },
    { id: 'manage_users', name: 'Manage Users', description: 'Create, edit, and delete users', category: 'administrative' },
    { id: 'manage_roles', name: 'Manage Roles', description: 'Configure role permissions', category: 'administrative' },
    { id: 'view_audit_logs', name: 'View Audit Logs', description: 'Access system activity logs', category: 'administrative' },
    { id: 'manage_settings', name: 'Manage Settings', description: 'Configure system settings', category: 'system' },
    { id: 'system_admin', name: 'System Administrator', description: 'Full system access', category: 'system' },
  ];

  // Fetch users from API
  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fetchedUsers = await getUsers();
      // Map API response to SystemUser interface
      const mappedUsers: SystemUser[] = fetchedUsers.map((u: { user_id?: string; userId?: string; name?: string; email?: string; phone?: string; role?: string; status?: string; department?: string; license_number?: string; licenseNumber?: string; specialization?: string; created_at?: string; createdAt?: string; last_login?: string; lastLogin?: string; permissions?: string[]; emergency_contact?: string; emergencyContact?: string; notes?: string }) => ({
        userId: u.user_id || u.userId || '',
        name: u.name || '',
        email: u.email || '',
        phone: u.phone || '',
        role: (u.role as UserRole) || 'patient',
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
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleCreateUser = () => {
    if (!newUser.name || !newUser.email || !newUser.phone) {
      alert('Please fill in required fields');
      return;
    }

    const rolePrefix = {
      admin: 'ADMIN',
      doctor: 'DOC',
      nurse: 'NURSE',
      'lab-technician': 'LAB',
      pharmacist: 'PHARM',
      radiologist: 'RAD',
      patient: 'PAT',
    }[newUser.role];

    const existingCount = users.filter((u) => u.userId.startsWith(rolePrefix)).length;

    const defaultPermissions: { [key in UserRole]: string[] } = {
      admin: ['view_patients', 'edit_patients', 'manage_users', 'manage_roles', 'view_audit_logs', 'manage_settings', 'system_admin'],
      doctor: ['view_patients', 'edit_patients', 'prescribe_medications', 'order_labs', 'order_imaging', 'view_lab_results', 'document_notes'],
      nurse: ['view_patients', 'edit_patients', 'view_lab_results', 'document_notes'],
      'lab-technician': ['view_patients', 'view_lab_results', 'document_notes'],
      pharmacist: ['view_patients', 'prescribe_medications', 'view_lab_results'],
      radiologist: ['view_patients', 'order_imaging', 'document_notes'],
      patient: ['view_patients'],
    };

    const newSystemUser: SystemUser = {
      userId: `${rolePrefix}-${String(existingCount + 1).padStart(3, '0')}`,
      name: newUser.name,
      email: newUser.email,
      phone: newUser.phone,
      role: newUser.role,
      status: 'pending',
      department: newUser.department || undefined,
      licenseNumber: newUser.licenseNumber || undefined,
      specialization: newUser.specialization || undefined,
      createdAt: new Date().toISOString(),
      permissions: defaultPermissions[newUser.role],
      emergencyContact: newUser.emergencyContact || undefined,
      notes: newUser.notes || undefined,
    };

    setUsers([newSystemUser, ...users]);
    setNewUser({
      name: '',
      email: '',
      phone: '',
      role: 'doctor',
      department: '',
      licenseNumber: '',
      specialization: '',
      emergencyContact: '',
      notes: '',
    });
    setActiveTab('users');
    alert(`User ${newSystemUser.userId} created successfully`);
  };

  const handleUpdateUser = () => {
    if (!selectedUser) return;

    setUsers(users.map((u) => (u.userId === selectedUser.userId ? selectedUser : u)));
    setShowEditModal(false);
    setSelectedUser(null);
    alert('User updated successfully');
  };

  const handleDeleteUser = (userId: string) => {
    if (confirm('Are you sure you want to delete this user?')) {
      setUsers(users.filter((u) => u.userId !== userId));
      alert('User deleted successfully');
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

  const handleStatusChange = (userId: string, newStatus: UserStatus) => {
    setUsers(users.map((u) => (u.userId === userId ? { ...u, status: newStatus } : u)));
    alert(`User status changed to ${newStatus}`);
  };

  const getRoleBadge = (role: UserRole) => {
    const badges = {
      admin: 'bg-purple-100 text-purple-800',
      doctor: 'bg-blue-100 text-blue-800',
      nurse: 'bg-green-100 text-green-800',
      'lab-technician': 'bg-yellow-100 text-yellow-800',
      pharmacist: 'bg-pink-100 text-pink-800',
      radiologist: 'bg-indigo-100 text-indigo-800',
      patient: 'bg-gray-100 text-gray-800',
    };
    return badges[role];
  };

  const getStatusBadge = (status: UserStatus) => {
    const badges = {
      active: 'bg-green-100 text-green-800',
      inactive: 'bg-gray-100 text-gray-800',
      suspended: 'bg-red-100 text-red-800',
      pending: 'bg-yellow-100 text-yellow-800',
    };
    return badges[status];
  };

  const getStatusIcon = (status: UserStatus) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'inactive':
        return <XCircle className="w-4 h-4 text-gray-600" />;
      case 'suspended':
        return <Lock className="w-4 h-4 text-red-600" />;
      case 'pending':
        return <Calendar className="w-4 h-4 text-yellow-600" />;
    }
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleString();
  };

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.userId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase());
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
      radiologist: ['view_patients', 'order_imaging', 'document_notes'],
      patient: ['view_patients'],
    };

    return availablePermissions.filter((p) => rolePermissionIds[role].includes(p.id));
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="bg-gradient-to-r from-purple-600 to-indigo-500 text-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold mb-2">User Management</h1>
        <p className="text-purple-100">System user administration and role-based access control</p>
      </div>

      <div className="flex gap-2 mb-6 border-b">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'users' ? 'text-purple-700 border-b-2 border-purple-700' : 'text-gray-600 hover:text-purple-700'
          }`}
        >
          All Users ({users.length})
        </button>
        <button
          onClick={() => setActiveTab('new-user')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'new-user' ? 'text-purple-700 border-b-2 border-purple-700' : 'text-gray-600 hover:text-purple-700'
          }`}
        >
          New User
        </button>
        <button
          onClick={() => setActiveTab('roles')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'roles' ? 'text-purple-700 border-b-2 border-purple-700' : 'text-gray-600 hover:text-purple-700'
          }`}
        >
          Roles & Permissions
        </button>
      </div>

      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search users..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Role</label>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as UserRole | 'all')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="all">All Roles</option>
                  <option value="admin">Administrator</option>
                  <option value="doctor">Doctor</option>
                  <option value="nurse">Nurse</option>
                  <option value="lab-technician">Lab Technician</option>
                  <option value="pharmacist">Pharmacist</option>
                  <option value="radiologist">Radiologist</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as UserStatus | 'all')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="all">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="suspended">Suspended</option>
                  <option value="pending">Pending</option>
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {filteredUsers.map((systemUser) => (
              <div key={systemUser.userId} className="border border-gray-300 rounded-lg shadow-sm bg-white p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <div className="bg-purple-100 rounded-full p-3">
                      <User className="w-8 h-8 text-purple-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-bold text-gray-900">{systemUser.name}</h3>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getRoleBadge(systemUser.role)}`}>
                          {systemUser.role.toUpperCase().replace('-', ' ')}
                        </span>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${getStatusBadge(systemUser.status)}`}>
                          {getStatusIcon(systemUser.status)}
                          {systemUser.status.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 flex items-center gap-1">
                        <Mail className="w-4 h-4" />
                        {systemUser.email}
                      </p>
                      <p className="text-sm text-gray-600 flex items-center gap-1">
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
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="Edit User"
                    >
                      <Edit className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => {
                        setSelectedUser(systemUser);
                        setShowPermissionsModal(true);
                      }}
                      className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                      title="Manage Permissions"
                    >
                      <Shield className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleDeleteUser(systemUser.userId)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete User"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-4 mb-4 bg-purple-50 rounded-lg p-4">
                  <div>
                    <p className="text-sm text-purple-900 font-semibold mb-1">User ID</p>
                    <p className="font-semibold text-gray-900">{systemUser.userId}</p>
                  </div>
                  <div>
                    <p className="text-sm text-purple-900 font-semibold mb-1">Department</p>
                    <p className="text-sm text-gray-900">{systemUser.department || 'Not assigned'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-purple-900 font-semibold mb-1">License Number</p>
                    <p className="text-sm text-gray-900">{systemUser.licenseNumber || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-purple-900 font-semibold mb-1">Specialization</p>
                    <p className="text-sm text-gray-900">{systemUser.specialization || 'N/A'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-sm font-semibold text-blue-900 mb-1">Created</p>
                    <p className="text-sm text-blue-800">{formatDate(systemUser.createdAt)}</p>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <p className="text-sm font-semibold text-green-900 mb-1">Last Login</p>
                    <p className="text-sm text-green-800">{systemUser.lastLogin ? formatDate(systemUser.lastLogin) : 'Never'}</p>
                  </div>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                  <p className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    Permissions ({systemUser.permissions.length})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {systemUser.permissions.length > 0 ? (
                      systemUser.permissions.map((perm) => (
                        <span key={perm} className="px-2 py-1 bg-white border border-gray-300 rounded text-xs text-gray-700">
                          {perm.replace('_', ' ')}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-gray-500">No permissions assigned</span>
                    )}
                  </div>
                </div>

                {systemUser.notes && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <p className="text-sm font-semibold text-yellow-900 mb-1">Notes</p>
                    <p className="text-sm text-yellow-800">{systemUser.notes}</p>
                  </div>
                )}

                <div className="mt-4 pt-4 border-t flex gap-2">
                  {systemUser.status === 'active' && (
                    <button
                      onClick={() => handleStatusChange(systemUser.userId, 'inactive')}
                      className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors flex items-center gap-2"
                    >
                      <XCircle className="w-4 h-4" />
                      Deactivate
                    </button>
                  )}
                  {systemUser.status === 'inactive' && (
                    <button
                      onClick={() => handleStatusChange(systemUser.userId, 'active')}
                      className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm transition-colors flex items-center gap-2"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Activate
                    </button>
                  )}
                  {systemUser.status === 'pending' && (
                    <button
                      onClick={() => handleStatusChange(systemUser.userId, 'active')}
                      className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm transition-colors flex items-center gap-2"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Approve
                    </button>
                  )}
                  {systemUser.status !== 'suspended' && (
                    <button
                      onClick={() => handleStatusChange(systemUser.userId, 'suspended')}
                      className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm transition-colors flex items-center gap-2"
                    >
                      <Lock className="w-4 h-4" />
                      Suspend
                    </button>
                  )}
                  {systemUser.status === 'suspended' && (
                    <button
                      onClick={() => handleStatusChange(systemUser.userId, 'active')}
                      className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm transition-colors flex items-center gap-2"
                    >
                      <Unlock className="w-4 h-4" />
                      Unsuspend
                    </button>
                  )}
                </div>
              </div>
            ))}

            {filteredUsers.length === 0 && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                <Users className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">No users found</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'new-user' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-6">Create New User</h2>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Full Name <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  placeholder="e.g., Dr. John Doe"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Role <span className="text-red-600">*</span>
                </label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                >
                  <option value="doctor">Doctor</option>
                  <option value="nurse">Nurse</option>
                  <option value="lab-technician">Lab Technician</option>
                  <option value="pharmacist">Pharmacist</option>
                  <option value="radiologist">Radiologist</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Email <span className="text-red-600">*</span>
                </label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="john.doe@hospital.za"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Phone <span className="text-red-600">*</span>
                </label>
                <input
                  type="tel"
                  value={newUser.phone}
                  onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                  placeholder="+27 11 123 4567"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Department</label>
                <input
                  type="text"
                  value={newUser.department}
                  onChange={(e) => setNewUser({ ...newUser, department: e.target.value })}
                  placeholder="e.g., Emergency Medicine"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">License Number</label>
                <input
                  type="text"
                  value={newUser.licenseNumber}
                  onChange={(e) => setNewUser({ ...newUser, licenseNumber: e.target.value })}
                  placeholder="e.g., MP-12345"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Specialization</label>
                <input
                  type="text"
                  value={newUser.specialization}
                  onChange={(e) => setNewUser({ ...newUser, specialization: e.target.value })}
                  placeholder="e.g., Cardiology"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Emergency Contact</label>
                <input
                  type="tel"
                  value={newUser.emergencyContact}
                  onChange={(e) => setNewUser({ ...newUser, emergencyContact: e.target.value })}
                  placeholder="+27 11 987 6543"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Notes</label>
              <textarea
                value={newUser.notes}
                onChange={(e) => setNewUser({ ...newUser, notes: e.target.value })}
                placeholder="Additional notes..."
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
            </div>

            <button
              onClick={handleCreateUser}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Create User
            </button>
          </div>
        </div>
      )}
      {activeTab === 'roles' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Role-Based Permissions</h2>
            <p className="text-sm text-gray-600 mb-6">
              Each role has predefined permissions that determine what actions users with that role can perform in the system.
            </p>

            <div className="space-y-6">
              {(['admin', 'doctor', 'nurse', 'lab-technician', 'pharmacist', 'radiologist'] as UserRole[]).map((role) => (
                <div key={role} className="border border-gray-300 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <Shield className="w-6 h-6 text-purple-600" />
                      <h3 className="text-lg font-bold text-gray-900">{role.toUpperCase().replace('-', ' ')}</h3>
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getRoleBadge(role)}`}>
                        {users.filter((u) => u.role === role).length} users
                      </span>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-sm font-semibold text-gray-900 mb-3">Default Permissions</p>
                    <div className="grid grid-cols-3 gap-3">
                      {getRolePermissions(role).map((perm) => (
                        <div key={perm.id} className="bg-white border border-gray-200 rounded-lg p-3">
                          <p className="text-sm font-semibold text-gray-900 mb-1">{perm.name}</p>
                          <p className="text-xs text-gray-600">{perm.description}</p>
                          <span
                            className={`inline-block mt-2 px-2 py-1 rounded text-xs font-semibold ${
                              perm.category === 'clinical'
                                ? 'bg-blue-100 text-blue-800'
                                : perm.category === 'administrative'
                                ? 'bg-purple-100 text-purple-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {perm.category}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">All Available Permissions</h2>
            
            <div className="space-y-6">
              {(['clinical', 'administrative', 'system'] as const).map((category) => (
                <div key={category} className="border border-gray-300 rounded-lg p-6">
                  <h3 className="text-lg font-bold text-gray-900 mb-4 capitalize">{category} Permissions</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {availablePermissions
                      .filter((p) => p.category === category)
                      .map((perm) => (
                        <div key={perm.id} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-semibold text-gray-900 mb-1">{perm.name}</p>
                              <p className="text-sm text-gray-600">{perm.description}</p>
                            </div>
                            <Key className="w-5 h-5 text-gray-400" />
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
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">Edit User</h2>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setSelectedUser(null);
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Full Name</label>
                  <input
                    type="text"
                    value={selectedUser.name}
                    onChange={(e) => setSelectedUser({ ...selectedUser, name: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Role</label>
                  <select
                    value={selectedUser.role}
                    onChange={(e) => setSelectedUser({ ...selectedUser, role: e.target.value as UserRole })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  >
                    <option value="admin">Administrator</option>
                    <option value="doctor">Doctor</option>
                    <option value="nurse">Nurse</option>
                    <option value="lab-technician">Lab Technician</option>
                    <option value="pharmacist">Pharmacist</option>
                    <option value="radiologist">Radiologist</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Email</label>
                  <input
                    type="email"
                    value={selectedUser.email}
                    onChange={(e) => setSelectedUser({ ...selectedUser, email: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Phone</label>
                  <input
                    type="tel"
                    value={selectedUser.phone}
                    onChange={(e) => setSelectedUser({ ...selectedUser, phone: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Department</label>
                  <input
                    type="text"
                    value={selectedUser.department || ''}
                    onChange={(e) => setSelectedUser({ ...selectedUser, department: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">License Number</label>
                  <input
                    type="text"
                    value={selectedUser.licenseNumber || ''}
                    onChange={(e) => setSelectedUser({ ...selectedUser, licenseNumber: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Specialization</label>
                <input
                  type="text"
                  value={selectedUser.specialization || ''}
                  onChange={(e) => setSelectedUser({ ...selectedUser, specialization: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Notes</label>
                <textarea
                  value={selectedUser.notes || ''}
                  onChange={(e) => setSelectedUser({ ...selectedUser, notes: e.target.value })}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleUpdateUser}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 rounded-lg transition-colors"
                >
                  Update User
                </button>
                <button
                  onClick={() => {
                    setShowEditModal(false);
                    setSelectedUser(null);
                  }}
                  className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold py-2 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPermissionsModal && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">Manage Permissions: {selectedUser.name}</h2>
              <button
                onClick={() => {
                  setShowPermissionsModal(false);
                  setUsers(users.map((u) => (u.userId === selectedUser.userId ? selectedUser : u)));
                  setSelectedUser(null);
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="mb-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
              <p className="text-sm text-purple-900">
                <strong>Current Role:</strong> {selectedUser.role.toUpperCase().replace('-', ' ')}
              </p>
              <p className="text-sm text-purple-800 mt-1">
                Selected: {selectedUser.permissions.length} / {availablePermissions.length} permissions
              </p>
            </div>

            <div className="space-y-6">
              {(['clinical', 'administrative', 'system'] as const).map((category) => (
                <div key={category} className="border border-gray-300 rounded-lg p-4">
                  <h3 className="text-lg font-bold text-gray-900 mb-4 capitalize">{category} Permissions</h3>
                  <div className="space-y-3">
                    {availablePermissions
                      .filter((p) => p.category === category)
                      .map((perm) => (
                        <div
                          key={perm.id}
                          className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex-1">
                            <p className="font-semibold text-gray-900">{perm.name}</p>
                            <p className="text-sm text-gray-600">{perm.description}</p>
                          </div>
                          <button
                            onClick={() => handleTogglePermission(perm.id)}
                            className={`ml-4 px-4 py-2 rounded-lg font-semibold transition-colors ${
                              selectedUser.permissions.includes(perm.id)
                                ? 'bg-green-500 text-white hover:bg-green-600'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                            }`}
                          >
                            {selectedUser.permissions.includes(perm.id) ? (
                              <span className="flex items-center gap-2">
                                <CheckCircle className="w-4 h-4" />
                                Enabled
                              </span>
                            ) : (
                              <span className="flex items-center gap-2">
                                <XCircle className="w-4 h-4" />
                                Disabled
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
                  alert('Permissions updated successfully');
                }}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                Save Permissions
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagementPage;