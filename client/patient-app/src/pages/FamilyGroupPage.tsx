import React, { useEffect, useState } from 'react';
import {
  addFamilyMember,
  createFamilyGroup,
  getMyFamilyGroups,
  getMyWards,
  listMyMedicalIdentities,
  removeFamilyMember,
  useTranslation,
  confirmDialog,
} from '@medichain/shared';
import type { GuardianRelationship, MedicalIdentitySummary } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';
import { Users, Plus, UserPlus, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

interface FamilyGroup {
  group_id: string;
  group_name: string;
  primary_account_id?: string;
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
 * © 2025 Lukau Invasion (Pty) Ltd. All rights reserved.
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
  const [newMemberWalletAddress, setNewMemberWalletAddress] = useState('');
  const [newMemberRelationship, setNewMemberRelationship] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  // --- Records this account may open -----------------------------------------
  //
  // Guardianship is recorded on the clinician's side -- a parent is verified
  // against a child's record there -- and `GET /api/identity/my-medical-identities`
  // is the patient-side answer to "whose records may I open". It had no caller,
  // so a parent could be granted authority over a child's record and never see
  // it from their own app.
  //
  // The server filters to active, unexpired relationships: this list is an
  // offer to act, not a history, which is the opposite of how the clinician's
  // guardian list is built.
  const [identities, setIdentities] = useState<MedicalIdentitySummary[]>([]);
  const [identitiesLoaded, setIdentitiesLoaded] = useState(false);
  // An empty list and a failed read are different answers to "may I open my
  // child's record", and only one of them should be shown as settled.
  const [identitiesUnknown, setIdentitiesUnknown] = useState(false);
  const [wards, setWards] = useState<GuardianRelationship[]>([]);
  const [wardsLoaded, setWardsLoaded] = useState(false);
  const [wardsUnknown, setWardsUnknown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listMyMedicalIdentities()
      .then((body) => {
        if (cancelled) return;
        setIdentities(body.identities ?? []);
        setIdentitiesUnknown(false);
      })
      .catch(() => {
        if (!cancelled) setIdentitiesUnknown(true);
      })
      .finally(() => {
        if (!cancelled) setIdentitiesLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getMyWards()
      .then((body) => {
        if (cancelled) return;
        setWards(body.relationships ?? []);
        setWardsUnknown(false);
      })
      .catch(() => {
        if (!cancelled) setWardsUnknown(true);
      })
      .finally(() => {
        if (!cancelled) setWardsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);


  const guardianStatus = (relationship: GuardianRelationship) => {
    if (relationship.revoked_at || !relationship.active) return t('family.guardianshipRevoked');
    if (relationship.expires_at && new Date(relationship.expires_at) <= new Date()) {
      return t('family.guardianshipExpired');
    }
    return t('family.guardianshipActive');
  };


  useEffect(() => {
    loadGroups();
  }, []);

  const loadGroups = () => {
    getMyFamilyGroups()
      // The API returns `family_id` / `family_name`; the screen reads
      // `group_id` / `group_name`. Both are accepted so a row written under
      // either name still renders.
      .then((res) =>
        setGroups(
          (res.groups || []).map((group) => ({
            ...group,
            group_id: group.family_id,
            group_name: group.family_name,
          }))
        )
      )
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patient?.walletAddress || !newGroupName.trim()) return;
    setIsCreating(true);
    try {
      await createFamilyGroup({
        group_name: newGroupName.trim(),
        primary_contact_id: patient.walletAddress,
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
    if (!addMemberGroupId || !newMemberWalletAddress.trim()) return;
    setIsAddingMember(true);
    try {
      await addFamilyMember(addMemberGroupId, {
        // Family access is authorized against wallet identities. A Health ID
        // would persist here but never match the caller identity used by the
        // appointment and removal authorization checks.
        patient_id: newMemberWalletAddress.trim(),
        relationship: newMemberRelationship.trim() || undefined,
        access_level: 'ViewOnly',
      });
      setNewMemberWalletAddress('');
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

  const handleRemoveMember = async (groupId: string, memberId: string) => {
    if (!(await confirmDialog({ message: t('family.removeMemberConfirm'), destructive: true }))) return;

    setRemovingMemberId(memberId);
    try {
      await removeFamilyMember(groupId, memberId);
      showSuccess(t('family.memberRemoved'));
      loadGroups();
    } catch (err) {
      console.error(err);
      showError(t('family.removeFailed'));
    } finally {
      setRemovingMemberId(null);
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
      {/* Records this account may open */}
      <div className="patient-card mb-4">
        <h2 className="text-lg font-semibold text-content mb-1">{t('family.identitiesHeading')}</h2>
        <p className="text-sm text-content-muted mb-4">{t('family.identitiesSubtitle')}</p>
        {!identitiesLoaded ? (
          <p className="text-sm text-content-muted">{t('family.identitiesLoading')}</p>
        ) : identitiesUnknown ? (
          <p className="text-sm text-content-muted">{t('family.identitiesUnknown')}</p>
        ) : identities.length === 0 ? (
          <p className="text-sm text-content-muted">{t('family.identitiesNone')}</p>
        ) : (
          <ul className="space-y-2" data-testid="medical-identity-list">
            {identities.map((identity) => (
              <li
                key={identity.patient_id}
                className="border border-border rounded-lg p-3 flex items-start justify-between gap-3"
              >
                <div>
                  <p className="text-sm text-content">
                    {identity.full_name || identity.patient_id}
                  </p>
                  <p className="text-xs text-content-muted">
                    {identity.relationship === 'self'
                      ? t('family.relationshipSelf')
                      : identity.relationship}
                    {identity.date_of_birth ? ` · ${identity.date_of_birth}` : ''}
                  </p>
                </div>
                {/* What the guardianship actually permits, not a blanket
                    "authorised": a relationship can carry view-only rights. */}
                <span className="text-xs text-content-muted text-right">
                  {identity.permissions.includes('all')
                    ? t('family.permissionsAll')
                    : identity.permissions.join(', ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The profile switcher above intentionally excludes expired and revoked
          authority. This separate record makes a past delegation visible
          without implying it still grants access. */}
      <div className="patient-card mb-4">
        <h2 className="text-lg font-semibold text-content mb-1">{t('family.guardianshipHeading')}</h2>
        <p className="text-sm text-content-muted mb-4">{t('family.guardianshipSubtitle')}</p>
        {!wardsLoaded ? (
          <p className="text-sm text-content-muted">{t('family.identitiesLoading')}</p>
        ) : wardsUnknown ? (
          <p className="text-sm text-content-muted">{t('family.guardianshipUnknown')}</p>
        ) : wards.length === 0 ? (
          <p className="text-sm text-content-muted">{t('family.guardianshipNone')}</p>
        ) : (
          <ul className="space-y-2" data-testid="guardianship-history-list">
            {wards.map((relationship) => (
              <li key={relationship.id} className="border border-border rounded-lg p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-content">{relationship.ward_patient_id}</p>
                    <p className="text-xs text-content-muted">{relationship.relationship_type}</p>
                  </div>
                  <span className="text-xs text-content-muted text-right">
                    {guardianStatus(relationship)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-content-muted">
                  {relationship.permissions.join(', ')}
                  {relationship.expires_at
                    ? ` · ${t('family.guardianshipExpires', { date: relationship.expires_at })}`
                    : ''}
                  {relationship.revoked_reason
                    ? ` · ${t('family.guardianshipRevokedReason', { reason: relationship.revoked_reason })}`
                    : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-content">{t('family.familyGroups')}</h1>
        <p className="text-content-muted">{t('family.subtitle')}</p>
      </div>

      {/* Create Group Form */}
      <div className="patient-card">
        <h2 className="font-semibold text-content-secondary mb-3 flex items-center gap-2">
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
            className="flex-1 border border-border-interactive rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
            required
          />
          <button
            type="submit"
            disabled={isCreating || !newGroupName.trim()}
            className="bg-primary-500 text-brand-fg px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand disabled:opacity-50 flex items-center gap-1"
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
            <p className="text-content-muted">{t('family.noGroups')}</p>
          </div>
        ) : (
          groups.map(group => (
            <div key={group.group_id} className="patient-card">
              {/* A clickable <div> is not operable by keyboard and is invisible
                  to assistive tech — this control expands the member list, so
                  it needs to be a real button. */}
              <button
                type="button"
                aria-expanded={expandedGroup === group.group_id}
                className="w-full flex items-center justify-between cursor-pointer text-left"
                onClick={() => setExpandedGroup(expandedGroup === group.group_id ? null : group.group_id)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-brand-subtle rounded-xl flex items-center justify-center">
                    <Users className="w-5 h-5 text-brand" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-content">{group.group_name}</h3>
                    <p className="text-sm text-content-muted">
                      {t('family.memberCount', { count: group.members?.length || 0 })}
                    </p>
                  </div>
                </div>
                {expandedGroup === group.group_id ? (
                  <ChevronUp className="w-5 h-5 text-content-muted" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-content-muted" />
                )}
              </button>

              {expandedGroup === group.group_id && (
                <div className="mt-4 space-y-3">
                  {/* Members List */}
                  {group.members && group.members.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-content-muted uppercase mb-2">{t('family.membersShort')}</p>
                      <div className="space-y-1">
                        {group.members.map((m, idx) => (
                          <div key={m.patient_id || idx} className="flex items-center gap-2 text-sm text-content-secondary py-1">
                            <div className="w-6 h-6 bg-surface-sunken rounded-full flex items-center justify-center">
                              <Users className="w-3 h-3 text-content-muted" />
                            </div>
                            <span>{m.name || m.patient_id}</span>
                            {m.relationship && (
                              <span className="text-xs text-content-muted">({m.relationship})</span>
                            )}
                            {m.patient_id !== group.primary_account_id &&
                              (group.primary_account_id === patient?.walletAddress ||
                                m.patient_id === patient?.walletAddress) && (
                                <button
                                  type="button"
                                  onClick={() => void handleRemoveMember(group.group_id, m.patient_id)}
                                  disabled={removingMemberId === m.patient_id}
                                  className="ml-auto text-xs text-critical-subtle-fg hover:underline disabled:opacity-50"
                                >
                                  {removingMemberId === m.patient_id
                                    ? t('common.loading')
                                    : t('family.removeMember')}
                                </button>
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
                      className="w-full py-2 border-2 border-dashed border-border rounded-lg text-sm text-content-muted hover:border-brand hover:text-brand transition-colors flex items-center justify-center gap-2"
                    >
                      <UserPlus className="w-4 h-4" />
                      {t('family.addMember')}
                    </button>
                  ) : (
                    <form onSubmit={handleAddMember} className="space-y-2 bg-surface-sunken rounded-lg p-3">
                      <p className="text-sm font-medium text-content-secondary">{t('family.addMemberTo', { group: group.group_name })}</p>
                      <label htmlFor={`member-id-${group.group_id}`} className="sr-only">{t('family.memberWalletAddress')}</label>
                      <input
                        id={`member-id-${group.group_id}`}
                        value={newMemberWalletAddress}
                        onChange={e => setNewMemberWalletAddress(e.target.value)}
                        placeholder={t('family.memberWalletPlaceholder')}
                        className="w-full border border-border-interactive rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                        required
                      />
                      <label htmlFor={`member-rel-${group.group_id}`} className="sr-only">{t('family.relationship')}</label>
                      <input
                        id={`member-rel-${group.group_id}`}
                        value={newMemberRelationship}
                        onChange={e => setNewMemberRelationship(e.target.value)}
                        placeholder={t('family.relationshipPlaceholder')}
                        className="w-full border border-border-interactive rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={isAddingMember || !newMemberWalletAddress.trim()}
                          className="flex-1 bg-primary-500 text-brand-fg py-2 rounded-lg text-sm font-medium hover:bg-brand disabled:opacity-50 flex items-center justify-center gap-1"
                        >
                          {isAddingMember ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                          {t('common.add')}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAddMemberGroupId(null); setNewMemberWalletAddress(''); setNewMemberRelationship(''); }}
                          className="flex-1 border border-border py-2 rounded-lg text-sm text-content-muted hover:bg-surface-sunken"
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
