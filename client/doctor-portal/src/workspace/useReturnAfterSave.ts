/**
 * Where a form goes when it is finished (saved or cancelled).
 *
 * Thirteen forms sent the clinician to the dashboard after saving, so charting
 * a second thing for the same patient meant finding that patient again. Inside
 * a patient workspace the form now returns to that patient's chart, carrying
 * the workspace's own navigation state so "Close patient" still knows where the
 * clinician came from. Outside a workspace it returns to where the form was
 * opened from, and only failing that to the dashboard.
 */
import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { returnPathFrom } from '@medichain/shared';
import { usePatientWorkspace } from './PatientWorkspaceContext';
import { workspacePath } from './forms';

export function useReturnAfterSave(): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  const workspace = usePatientWorkspace();
  return useCallback(() => {
    if (workspace) {
      navigate(workspacePath(workspace.patientId), { state: location.state });
      return;
    }
    navigate(returnPathFrom(location.state, '/dashboard'));
  }, [navigate, location.state, workspace]);
}
