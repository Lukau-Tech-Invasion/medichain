import React, { useEffect, useState } from 'react';
import { getMyFamilyGroups, createFamilyGroup } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';

export function FamilyGroupPage() {
  const { patient } = usePatientAuthStore();
  const { showSuccess, showError } = useToastActions();
  const [groups, setGroups] = useState<any[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [loading, setLoading] = useState(true); 

  useEffect(() => {
    loadGroups();
  }, []);

  const loadGroups = () => {
    // @ts-ignore
    getMyFamilyGroups()
      .then((res: any) => setGroups(res.groups || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patient?.healthId) return;
    try {
      // @ts-ignore
      await createFamilyGroup({
        group_name: newGroupName,
        primary_contact_id: patient.healthId
      });
      setNewGroupName('');
      loadGroups();
    } catch (err) {
      console.error(err);
      showError('Failed to create group');
    }
  };

  if (loading) return <div className="p-4">Loading family groups...</div>;

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Family Groups</h1>
      
      <form onSubmit={handleCreateGroup} className="mb-6 flex gap-2">
        <label htmlFor="family-group-name" className="sr-only">Group Name</label>
        <input 
          id="family-group-name"
          value={newGroupName}
          onChange={e => setNewGroupName(e.target.value)}
          placeholder="New Group Name"
          className="flex-1 border p-2 rounded"
          required
        />
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded">
          Create Group
        </button>
      </form>

      <div className="space-y-4">
        {groups.length === 0 ? (
          <p className="text-gray-500">No family groups found.</p>
        ) : (
          groups.map(group => (
            <div key={group.group_id} className="bg-white p-4 rounded shadow border border-gray-200">
              <h3 className="font-bold text-lg">{group.group_name}</h3>
              <p className="text-sm text-gray-600">ID: {group.group_id}</p>
              <div className="mt-2 text-sm">
                <p>Members: {group.members?.length || 0}</p>
                <p>Delegates: {group.delegates?.length || 0}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
