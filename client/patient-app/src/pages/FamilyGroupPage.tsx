import React, { useEffect, useState } from 'react';
import { getMyFamilyGroups, createFamilyGroup, addFamilyMember, useTranslation } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';
import { Users, Plus, UserPlus, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

interface FamilyGroup {
  group_id: string;
  group_name: string;
  members?: { patient_id: string; name?: string; relationship?: string }[];
  delegates?: { patient_id: string; name?: string }[];
}

/**
 * FamilyGroupPage - Manage family health groups
 *
 * Features:
 * - List family groups (GET /api/family/my-groups)
 * - Create new group (POST /api/family/groups)
 * - Add member to group (POST /api/family/groups/{id}/members)
 *
 * © 2025 Trustware. All rights reserved.
 */
export function FamilyGroupPage() {
  const { t } = useTranslation();
  const { patient } = usePatientAuthStore();
  const { showSuccess, showError } = useToastActions();
  const [groups, setGroups] = useState<FamilyGroup[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [addMemberGroupId, setAddMemberGroupId] = useState<string | null>(null);
  const [newMemberHealthId, setNewMemberHealthId] = useState('');
  const [newMemberRelationship, setNewMemberRelationship] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isAddingMember, setIsAddingMember] = useState(false);

  useEffect(() => {
    loadGroups();
  }, []);

  const loadGroups = () => {
    getMyFamilyGroups()
      .then((res: any) => setGroups(res.groups || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patient?.healthId || !newGroupName.trim()) return;
    setIsCreating(true);
    try {
      await createFamilyGroup({
        group_name: newGroupName.trim(),
        primary_contact_id: patient.healthId,
      });
      setNewGroupName('');
      showSuccess(t('family.groupCreated'));
      loadGroups();
    } catch (err) {
      console.error(err);
      showError(t('family.createFailed'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addMemberGroupId || !newMemberHealthId.trim()) return;
    setIsAddingMember(true);
    try {
      await addFamilyMember(addMemberGroupId, {
        patient_id: newMemberHealthId.trim(),
        relationship: newMemberRelationship.trim() || undefined,
      });
      setNewMemberHealthId('');
      setNewMemberRelationship('');
      setAddMemberGroupId(null);
      showSuccess(t('family.memberAdded'));
      loadGroups();
    } catch (err) {
      console.error(err);
      showError(t('family.addFailed'));
    } finally {
      setIsAddingMember(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">{t('family.familyGroups')}</h1>
        <p className="text-neutral-500">{t('family.subtitle')}</p>
      </div>

      {/* Create Group Form */}
      <div className="patient-card">
        <h2 className="font-semibold text-neutral-800 mb-3 flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary-500" />
          {t('family.createNewGroup')}
        </h2>
        <form onSubmit={handleCreateGroup} className="flex gap-2">
          <label htmlFor="family-group-name" className="sr-only">{t('family.groupName')}</label>
          <input
            id="family-group-name"
            value={newGroupName}
            onChange={e => setNewGroupName(e.target.value)}
            placeholder={t('family.groupNamePlaceholder')}
            className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            required
          />
          <button
            type="submit"
            disabled={isCreating || !newGroupName.trim()}
            className="bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 flex items-center gap-1"
          >
            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {t('family.create')}
          </button>
        </form>
      </div>

      {/* Groups List */}
      <div className="space-y-3">
        {groups.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
            <p className="text-neutral-500">{t('family.noGroups')}</p>
          </div>
        ) : (
          groups.map(group => (
            <div key={group.group_id} className="patient-card">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setExpandedGroup(expandedGroup === group.group_id ? null : group.group_id)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
                    <Users className="w-5 h-5 text-primary-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-neutral-900">{group.group_name}</h3>
                    <p className="text-sm text-neutral-500">
                      {t('family.memberCount', { count: group.members?.length || 0 })}
                    </p>
                  </div>
                </div>
                {expandedGroup === group.group_id ? (
                  <ChevronUp className="w-5 h-5 text-neutral-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-neutral-400" />
                )}
              </div>

              {expandedGroup === group.group_id && (
                <div className="mt-4 space-y-3">
                  {/* Members List */}
                  {group.members && group.members.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-neutral-500 uppercase mb-2">{t('family.membersShort')}</p>
                      <div className="space-y-1">
                        {group.members.map((m, idx) => (
                          <div key={m.patient_id || idx} className="flex items-center gap-2 text-sm text-neutral-700 py-1">
                            <div className="w-6 h-6 bg-neutral-200 rounded-full flex items-center justify-center">
                              <Users className="w-3 h-3 text-neutral-500" />
                            </div>
                            <span>{m.name || m.patient_id}</span>
                            {m.relationship && (
                              <span className="text-xs text-neutral-400">({m.relationship})</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Add Member Button */}
                  {addMemberGroupId !== group.group_id ? (
                    <button
                      onClick={() => setAddMemberGroupId(group.group_id)}
                      className="w-full py-2 border-2 border-dashed border-neutral-200 rounded-lg text-sm text-neutral-500 hover:border-primary-300 hover:text-primary-600 transition-colors flex items-center justify-center gap-2"
                    >
                      <UserPlus className="w-4 h-4" />
                      {t('family.addMember')}
                    </button>
                  ) : (
                    <form onSubmit={handleAddMember} className="space-y-2 bg-neutral-50 rounded-lg p-3">
                      <p className="text-sm font-medium text-neutral-700">{t('family.addMemberTo', { group: group.group_name })}</p>
                      <label htmlFor={`member-id-${group.group_id}`} className="sr-only">{t('family.healthId')}</label>
                      <input
                        id={`member-id-${group.group_id}`}
                        value={newMemberHealthId}
                        onChange={e => setNewMemberHealthId(e.target.value)}
                        placeholder={t('family.memberIdPlaceholder')}
                        className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                        required
                      />
                      <label htmlFor={`member-rel-${group.group_id}`} className="sr-only">{t('family.relationship')}</label>
                      <input
                        id={`member-rel-${group.group_id}`}
                        value={newMemberRelationship}
                        onChange={e => setNewMemberRelationship(e.target.value)}
                        placeholder={t('family.relationshipPlaceholder')}
                        className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={isAddingMember || !newMemberHealthId.trim()}
                          className="flex-1 bg-primary-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 flex items-center justify-center gap-1"
                        >
                          {isAddingMember ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                          {t('common.add')}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAddMemberGroupId(null); setNewMemberHealthId(''); setNewMemberRelationship(''); }}
                          className="flex-1 border border-neutral-200 py-2 rounded-lg text-sm text-neutral-600 hover:bg-neutral-50"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
