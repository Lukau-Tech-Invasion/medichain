/**
 * A provider's working hours.
 *
 * `PUT`/`GET /api/providers/{id}/schedule` landed with no screen, which is the
 * "designed, not adopted" class the endpoint audit exists to catch: a working
 * feature nobody can reach is indistinguishable from a missing one.
 *
 * Why it matters that this exists at all:
 * `GET /api/appointments/slots/{provider}/{date}` offered the same ten times
 * for every provider, because nothing stored when anyone works. It excluded
 * real bookings, so it could not double-book — but it could offer 09:00 with a
 * surgeon whose list starts at 14:00, and the patient app rendered that as
 * availability.
 *
 * The preview at the bottom reads slots back from the server rather than
 * computing them here. A page that previews its own arithmetic proves only that
 * the page agrees with itself; this proves the save landed and the booking
 * screen will show the same thing.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  LoadingSpinner,
  getAvailableSlots,
  getProviderSchedule,
  providerScheduleSchema,
  setProviderSchedule,
  useTranslation,
  formatTimestamp,
} from '@medichain/shared';
import type { ProviderBlockedTime, ProviderWorkingDay } from '@medichain/shared';
import { CalendarClock, Clock, Plus, Save, Trash2 } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';
import StaffSelect from '../components/StaffSelect';

/** ISO-8601 weekdays, in the order a week is read. */
const WEEKDAYS: Array<{ weekday: number; label: string }> = [
  { weekday: 1, label: 'Monday' },
  { weekday: 2, label: 'Tuesday' },
  { weekday: 3, label: 'Wednesday' },
  { weekday: 4, label: 'Thursday' },
  { weekday: 5, label: 'Friday' },
  { weekday: 6, label: 'Saturday' },
  { weekday: 7, label: 'Sunday' },
];

interface DayRow {
  enabled: boolean;
  start: string;
  end: string;
  breakStart: string;
  breakEnd: string;
}

interface BlockedRow {
  date: string;
  start: string;
  end: string;
  reason: string;
}

/**
 * Every weekday, unticked and empty.
 *
 * Nothing is pre-filled with a plausible 09:00–17:00: a provider who ticks
 * Tuesday and saves without looking would publish hours they never chose, and
 * the booking screen would offer them. An untouched field stays empty and the
 * schema asks for it.
 */
function emptyWeek(): Record<number, DayRow> {
  const week: Record<number, DayRow> = {};
  for (const { weekday } of WEEKDAYS) {
    week[weekday] = { enabled: false, start: '', end: '', breakStart: '', breakEnd: '' };
  }
  return week;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const ProviderSchedulePage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { showSuccess, showError } = useToastActions();

  const isAdmin = user?.role === 'Admin';
  const [providerId, setProviderId] = useState(user?.walletAddress ?? '');
  const [week, setWeek] = useState<Record<number, DayRow>>(emptyWeek);
  const [blocked, setBlocked] = useState<BlockedRow[]>([]);
  const [slotMinutes, setSlotMinutes] = useState('');
  const [hasSchedule, setHasSchedule] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [previewDate, setPreviewDate] = useState(today);
  const [previewSlots, setPreviewSlots] = useState<string[] | null>(null);
  const [previewSource, setPreviewSource] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const loadSchedule = useCallback(
    async (id: string) => {
      if (!id) return;
      setIsLoading(true);
      setFormError(null);
      try {
        const response = await getProviderSchedule(id);
        setHasSchedule(Boolean(response.has_schedule));
        const next = emptyWeek();
        if (response.has_schedule && response.schedule) {
          for (const day of response.schedule.working_days) {
            next[day.weekday] = {
              enabled: true,
              start: day.start ?? '',
              end: day.end ?? '',
              breakStart: day.break_start ?? '',
              breakEnd: day.break_end ?? '',
            };
          }
          setBlocked(
            response.schedule.blocked.map(block => ({
              date: block.date,
              start: block.start ?? '',
              end: block.end ?? '',
              reason: block.reason ?? '',
            }))
          );
          setSlotMinutes(String(response.schedule.slot_minutes));
          setUpdatedAt(response.schedule.updated_at ?? null);
          setUpdatedBy(response.schedule.updated_by ?? null);
        } else {
          setBlocked([]);
          setSlotMinutes('');
          setUpdatedAt(null);
          setUpdatedBy(null);
        }
        setWeek(next);
        setErrors({});
      } catch {
        setFormError(t('docProviderSchedule.loadFailed'));
      } finally {
        setIsLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    void loadSchedule(providerId);
  }, [providerId, loadSchedule]);

  const updateDay = (weekday: number, patch: Partial<DayRow>) => {
    setWeek(previous => ({ ...previous, [weekday]: { ...previous[weekday], ...patch } }));
    setErrors(previous => {
      const next = { ...previous };
      for (const key of Object.keys(patch)) delete next[`day-${weekday}-${key}`];
      return next;
    });
  };

  const updateBlocked = (index: number, patch: Partial<BlockedRow>) => {
    setBlocked(previous => previous.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setErrors(previous => {
      const next = { ...previous };
      for (const key of Object.keys(patch)) delete next[`blocked-${index}-${key}`];
      return next;
    });
  };

  /**
   * Build the payload from what was actually entered.
   *
   * An empty break is absent, not an empty string: the API refuses one end of a
   * break, and `''` is one end. Same for a blocked period with no times, which
   * is how "the whole day" is expressed.
   */
  const buildPayload = () => {
    const working_days: ProviderWorkingDay[] = WEEKDAYS.filter(({ weekday }) => week[weekday].enabled)
      .map(({ weekday }) => {
        const row = week[weekday];
        const day: ProviderWorkingDay = { weekday, start: row.start.trim(), end: row.end.trim() };
        if (row.breakStart.trim()) day.break_start = row.breakStart.trim();
        if (row.breakEnd.trim()) day.break_end = row.breakEnd.trim();
        return day;
      });

    const blockedOut: ProviderBlockedTime[] = blocked.map(row => {
      const block: ProviderBlockedTime = { date: row.date.trim() };
      if (row.start.trim()) block.start = row.start.trim();
      if (row.end.trim()) block.end = row.end.trim();
      if (row.reason.trim()) block.reason = row.reason.trim();
      return block;
    });

    return { working_days, blocked: blockedOut };
  };

  /**
   * Map a schema issue path back to the field that produced it.
   *
   * The payload indexes working days by position in the enabled subset, but the
   * form is keyed by weekday, so the mapping goes through the enabled list
   * rather than assuming the two line up.
   */
  const applyIssues = (issues: Array<{ path: PropertyKey[]; message: string }>, enabled: number[]) => {
    const next: Record<string, string> = {};
    let banner: string | null = null;
    const fieldNames: Record<string, string> = {
      start: 'start',
      end: 'end',
      break_start: 'breakStart',
      break_end: 'breakEnd',
    };
    for (const issue of issues) {
      const [group, index, field] = issue.path;
      if (group === 'working_days' && typeof index === 'number') {
        const weekday = enabled[index];
        const name = fieldNames[String(field)] ?? String(field);
        const key = `day-${weekday}-${name}`;
        if (!next[key]) next[key] = issue.message;
      } else if (group === 'blocked' && typeof index === 'number') {
        const key = `blocked-${index}-${String(field)}`;
        if (!next[key]) next[key] = issue.message;
      } else if (group === 'slot_minutes') {
        if (!next.slotMinutes) next.slotMinutes = issue.message;
      } else if (!banner) {
        banner = issue.message;
      }
    }
    setErrors(next);
    setFormError(banner ?? t('docProviderSchedule.fixErrors'));
  };

  const handleSave = async () => {
    const payload = buildPayload();
    const enabled = WEEKDAYS.filter(({ weekday }) => week[weekday].enabled).map(d => d.weekday);

    // Left blank means "use whatever the server uses", which is 30 minutes. It
    // is not sent, so the page is not the thing asserting the number.
    const entered = slotMinutes.trim();
    const parsed = entered === '' ? 30 : Number(entered);
    const result = providerScheduleSchema.safeParse({ ...payload, slot_minutes: parsed });
    if (!result.success) {
      applyIssues(result.error.issues as Array<{ path: PropertyKey[]; message: string }>, enabled);
      return;
    }

    setIsSaving(true);
    setFormError(null);
    try {
      await setProviderSchedule(providerId, {
        ...payload,
        ...(entered === '' ? {} : { slot_minutes: parsed }),
      });
      showSuccess(t('docProviderSchedule.saved'));
      setErrors({});
      await loadSchedule(providerId);
      // Refresh the preview against what was just published rather than leaving
      // the previous provider's slots on screen looking current.
      setPreviewSlots(null);
      setPreviewSource(null);
    } catch (error) {
      const message =
        error instanceof Error && error.message.includes('FORBIDDEN')
          ? t('docProviderSchedule.forbidden')
          : t('docProviderSchedule.saveFailed');
      setFormError(message);
      showError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreview = async () => {
    if (!providerId || !previewDate) return;
    setIsPreviewing(true);
    try {
      const response = await getAvailableSlots(providerId, previewDate);
      setPreviewSlots(response.available_slots ?? []);
      setPreviewSource(
        (response as { slots_source?: string }).slots_source ?? null
      );
    } catch {
      setPreviewSlots([]);
      setPreviewSource(null);
    } finally {
      setIsPreviewing(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <CalendarClock size={24} aria-hidden="true" />
          {t('docProviderSchedule.title')}
        </h1>
        <p className="text-sm text-content-secondary mt-1">{t('docProviderSchedule.subtitle')}</p>
      </header>

      {isAdmin && (
        <Card>
          <CardContent className="pt-6">
            <StaffSelect
              id="schedule-provider"
              label={t('docProviderSchedule.forProvider')}
              value={providerId}
              onChange={id => setProviderId(id)}
            />
            <p className="text-xs text-content-muted mt-1">{t('docProviderSchedule.forProviderHelp')}</p>
          </CardContent>
        </Card>
      )}

      {formError && <Alert variant="error">{formError}</Alert>}

      {isLoading ? (
        <div className="flex items-center gap-3 text-sm text-content-secondary">
          <LoadingSpinner size="md" />
          <span>{t('docProviderSchedule.loading')}</span>
        </div>
      ) : (
        <>
          {!hasSchedule && (
            <Alert variant="warning" title={t('docProviderSchedule.noScheduleHeading')}>
              {t('docProviderSchedule.noScheduleBody')}
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t('docProviderSchedule.weeklyHeading')}</CardTitle>
              <p className="text-sm text-content-secondary">{t('docProviderSchedule.weeklyHelp')}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {WEEKDAYS.map(({ weekday, label }) => {
                const row = week[weekday];
                return (
                  <div key={weekday} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-start border-b border-gray-100 pb-4 last:border-0">
                    <label className="flex items-center gap-2 pt-7 md:pt-7">
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        onChange={event => updateDay(weekday, { enabled: event.target.checked })}
                        aria-label={`${label} — ${t('docProviderSchedule.works')}`}
                      />
                      <span className="font-medium">{label}</span>
                    </label>
                    <Input
                      type="time"
                      label={t('docProviderSchedule.start')}
                      value={row.start}
                      disabled={!row.enabled}
                      error={errors[`day-${weekday}-start`]}
                      onChange={event => updateDay(weekday, { start: event.target.value })}
                    />
                    <Input
                      type="time"
                      label={t('docProviderSchedule.finish')}
                      value={row.end}
                      disabled={!row.enabled}
                      error={errors[`day-${weekday}-end`]}
                      onChange={event => updateDay(weekday, { end: event.target.value })}
                    />
                    <Input
                      type="time"
                      label={t('docProviderSchedule.breakStart')}
                      value={row.breakStart}
                      disabled={!row.enabled}
                      error={errors[`day-${weekday}-breakStart`]}
                      onChange={event => updateDay(weekday, { breakStart: event.target.value })}
                    />
                    <Input
                      type="time"
                      label={t('docProviderSchedule.breakEnd')}
                      value={row.breakEnd}
                      disabled={!row.enabled}
                      error={errors[`day-${weekday}-breakEnd`]}
                      onChange={event => updateDay(weekday, { breakEnd: event.target.value })}
                    />
                  </div>
                );
              })}

              <div className="max-w-xs">
                <Input
                  type="number"
                  min={5}
                  max={240}
                  label={t('docProviderSchedule.slotMinutes')}
                  helperText={t('docProviderSchedule.slotMinutesHelp')}
                  value={slotMinutes}
                  error={errors.slotMinutes}
                  onChange={event => {
                    setSlotMinutes(event.target.value);
                    setErrors(previous => {
                      const next = { ...previous };
                      delete next.slotMinutes;
                      return next;
                    });
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('docProviderSchedule.blockedHeading')}</CardTitle>
              <p className="text-sm text-content-secondary">{t('docProviderSchedule.blockedHelp')}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {blocked.length === 0 && (
                <p className="text-sm text-content-muted">{t('docProviderSchedule.blockedNone')}</p>
              )}
              {blocked.map((row, index) => (
                <div key={index} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-start">
                  <Input
                    type="date"
                    label={t('docProviderSchedule.blockedDate')}
                    value={row.date}
                    error={errors[`blocked-${index}-date`]}
                    onChange={event => updateBlocked(index, { date: event.target.value })}
                  />
                  <Input
                    type="time"
                    label={t('docProviderSchedule.blockedFrom')}
                    value={row.start}
                    error={errors[`blocked-${index}-start`]}
                    onChange={event => updateBlocked(index, { start: event.target.value })}
                  />
                  <Input
                    type="time"
                    label={t('docProviderSchedule.blockedUntil')}
                    value={row.end}
                    error={errors[`blocked-${index}-end`]}
                    onChange={event => updateBlocked(index, { end: event.target.value })}
                  />
                  <Input
                    label={t('docProviderSchedule.blockedReason')}
                    value={row.reason}
                    error={errors[`blocked-${index}-reason`]}
                    onChange={event => updateBlocked(index, { reason: event.target.value })}
                  />
                  <div className="pt-7">
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Trash2 size={16} />}
                      onClick={() => setBlocked(previous => previous.filter((_, i) => i !== index))}
                    >
                      {t('docProviderSchedule.blockedRemove')}
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Plus size={16} />}
                onClick={() =>
                  setBlocked(previous => [...previous, { date: '', start: '', end: '', reason: '' }])
                }
              >
                {t('docProviderSchedule.blockedAdd')}
              </Button>
            </CardContent>
          </Card>

          <div className="flex items-center gap-4">
            <Button onClick={handleSave} isLoading={isSaving} leftIcon={<Save size={16} />}>
              {isSaving ? t('docProviderSchedule.saving') : t('docProviderSchedule.save')}
            </Button>
            {updatedAt && (
              <span className="text-xs text-content-muted">
                {t('docProviderSchedule.lastUpdated', {
                  when: formatTimestamp(updatedAt * 1000),
                  who: updatedBy ?? '—',
                })}
              </span>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('docProviderSchedule.previewHeading')}</CardTitle>
              <p className="text-sm text-content-secondary">{t('docProviderSchedule.previewHelp')}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-end gap-3">
                <Input
                  type="date"
                  label={t('docProviderSchedule.previewDate')}
                  value={previewDate}
                  onChange={event => setPreviewDate(event.target.value)}
                />
                <Button
                  variant="secondary"
                  onClick={handlePreview}
                  isLoading={isPreviewing}
                  leftIcon={<Clock size={16} />}
                >
                  {t('docProviderSchedule.previewCheck')}
                </Button>
              </div>
              {previewSlots !== null && (
                <div>
                  {previewSlots.length === 0 ? (
                    <p className="text-sm text-content-muted">{t('docProviderSchedule.previewNone')}</p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {previewSlots.map(slot => (
                        <li key={slot} className="px-2 py-1 rounded bg-gray-100 text-sm">
                          {slot}
                        </li>
                      ))}
                    </ul>
                  )}
                  {previewSource && (
                    <p className="text-xs text-content-muted mt-2">
                      {t('docProviderSchedule.previewSource', { source: previewSource })}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default ProviderSchedulePage;
