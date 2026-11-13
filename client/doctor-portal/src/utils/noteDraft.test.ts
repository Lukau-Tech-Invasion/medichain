import { describe, it, expect, beforeEach } from 'vitest';
import { stashNoteDraft, takeNoteDraft, templateAsText, toSoapDraft } from './noteDraft';

/** A template's rendered sections land in the note's S/O/A/P fields, once. */
describe('noteDraft', () => {
  beforeEach(() => sessionStorage.clear());

  const sections = [
    { title: 'Subjective', content: 'Night symptoms twice a week' },
    { title: 'Objective', content: 'PEF 380 L/min' },
    { title: 'Assessment', content: 'Partly controlled asthma' },
    { title: 'Plan', content: 'Review in 2 weeks' },
    { title: 'Education', content: 'Inhaler technique checked' },
  ];

  it('maps sections to SOAP, keeping an unnamed one under its own title in the plan', () => {
    const draft = toSoapDraft('Asthma review', sections);
    expect(draft.subjective).toBe('Night symptoms twice a week');
    expect(draft.objective).toBe('PEF 380 L/min');
    expect(draft.assessment).toBe('Partly controlled asthma');
    expect(draft.plan).toBe('Review in 2 weeks\n\nEducation:\nInhaler technique checked');
  });

  it('hands the draft over once', () => {
    stashNoteDraft('Asthma review', sections);
    expect(takeNoteDraft()?.templateName).toBe('Asthma review');
    expect(takeNoteDraft()).toBeNull();
  });

  it('copies as plain text with titles', () => {
    expect(templateAsText(sections.slice(0, 2))).toBe('Subjective\nNight symptoms twice a week\n\nObjective\nPEF 380 L/min');
  });
});
