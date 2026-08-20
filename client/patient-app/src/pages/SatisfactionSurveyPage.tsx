import React, { useEffect, useState } from 'react';
import {
  createSatisfactionSurvey,
  debugLog,
  getPatientAppointments,
  type Appointment,
  type SatisfactionSurveyResponseInput,
  useTranslation,
} from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import {
  Star,
  ThumbsUp,
  ThumbsDown,
  Send,
  CheckCircle,
  MessageSquare,
  Heart,
  Clock,
  Users,
  Building,
  Stethoscope,
  ClipboardList,
  ChevronRight,
  AlertCircle
} from 'lucide-react';

/**
 * SatisfactionSurveyPage
 * 
 * Full-featured page for patient feedback surveys.
 * Includes star ratings, yes/no questions, and free-text feedback.
 */

type RatingType = 0 | 1 | 2 | 3 | 4 | 5;
type SurveyStep = 'intro' | 'visit' | 'staff' | 'facility' | 'feedback' | 'submitted';

interface SurveyQuestion {
  id: string;
  category: string;
  question: string;
  type: 'stars' | 'yesno' | 'text' | 'scale';
  required: boolean;
}

interface SurveyResponse {
  questionId: string;
  rating?: RatingType;
  yesNo?: boolean;
  text?: string;
  scale?: number;
}

const SatisfactionSurveyPage: React.FC = () => {
  const { t } = useTranslation();
  const patient = usePatientAuthStore(state => state.patient);
  const [step, setStep] = useState<SurveyStep>('intro');
  const [responses, setResponses] = useState<SurveyResponse[]>([]);
  const [overallRating, setOverallRating] = useState<RatingType>(0);
  const [wouldRecommend, setWouldRecommend] = useState<boolean | null>(null);
  const [additionalComments, setAdditionalComments] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [recentVisit, setRecentVisit] = useState<Appointment | null>(null);
  const [hoveredStar, setHoveredStar] = useState<number>(0);

  const visitQuestions: SurveyQuestion[] = [
    { id: 'v1', category: 'visit', question: t('survey.qV1'), type: 'stars', required: true },
    { id: 'v2', category: 'visit', question: t('survey.qV2'), type: 'yesno', required: true },
    { id: 'v3', category: 'visit', question: t('survey.qV3'), type: 'yesno', required: true },
    { id: 'v4', category: 'visit', question: t('survey.qV4'), type: 'stars', required: true }
  ];

  const staffQuestions: SurveyQuestion[] = [
    { id: 's1', category: 'staff', question: t('survey.qS1'), type: 'stars', required: true },
    { id: 's2', category: 'staff', question: t('survey.qS2'), type: 'yesno', required: true },
    { id: 's3', category: 'staff', question: t('survey.qS3'), type: 'stars', required: true },
    { id: 's4', category: 'staff', question: t('survey.qS4'), type: 'yesno', required: true }
  ];

  const facilityQuestions: SurveyQuestion[] = [
    { id: 'f1', category: 'facility', question: t('survey.qF1'), type: 'stars', required: true },
    { id: 'f2', category: 'facility', question: t('survey.qF2'), type: 'yesno', required: false },
    { id: 'f3', category: 'facility', question: t('survey.qF3'), type: 'stars', required: false },
    { id: 'f4', category: 'facility', question: t('survey.qF4'), type: 'yesno', required: false }
  ];

  useEffect(() => {
    if (!patient?.healthId) return;

    const loadRecentVisit = async () => {
      try {
        const result = await getPatientAppointments(patient.healthId);
        const latest = [...result.appointments]
          .filter(appointment => appointment.status.toLowerCase() === 'completed')
          .sort((left, right) => (right.scheduled_time ?? 0) - (left.scheduled_time ?? 0))[0];
        setRecentVisit(latest ?? null);
      } catch (error) {
        debugLog('SatisfactionSurveyPage', 'Could not load a recent completed visit:', error);
      }
    };

    void loadRecentVisit();
  }, [patient?.healthId]);

  const getResponse = (questionId: string): SurveyResponse | undefined => {
    return responses.find(r => r.questionId === questionId);
  };

  const setResponse = (questionId: string, value: Partial<SurveyResponse>) => {
    setResponses(prev => {
      const existing = prev.find(r => r.questionId === questionId);
      if (existing) {
        return prev.map(r => r.questionId === questionId ? { ...r, ...value } : r);
      }
      return [...prev, { questionId, ...value }];
    });
  };

  const isStepComplete = (questions: SurveyQuestion[]): boolean => {
    return questions.filter(q => q.required).every(q => {
      const response = getResponse(q.id);
      if (q.type === 'stars') return response?.rating && response.rating > 0;
      if (q.type === 'yesno') return response?.yesNo !== undefined;
      return true;
    });
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const questions = [...visitQuestions, ...staffQuestions, ...facilityQuestions];
      const apiResponses: SatisfactionSurveyResponseInput[] = responses.map(response => {
        const question = questions.find(candidate => candidate.id === response.questionId);
        const responseType = question?.type === 'yesno' ? 'YesNo' : 'Rating';
        const responseValue = question?.type === 'yesno'
          ? String(response.yesNo)
          : String(response.rating ?? response.scale ?? '');
        return {
          question_id: response.questionId,
          question_text: question?.question ?? response.questionId,
          response_type: responseType,
          response_value: responseValue,
        };
      });

      await createSatisfactionSurvey({
        visit_id: recentVisit?.appointment_id,
        visit_date: recentVisit?.scheduled_date ?? new Date().toISOString().slice(0, 10),
        department: recentVisit?.appointment_type ?? 'General care',
        survey_type: 'PostVisit',
        responses: apiResponses,
        overall_rating: overallRating,
        nps_score: wouldRecommend ? 10 : 0,
        comments: additionalComments,
        anonymous: false,
        follow_up_requested: false,
      });
      setStep('submitted');
    } catch (error) {
      debugLog('SatisfactionSurveyPage', 'Survey submission failed:', error);
      setSubmitError(t('survey.submitError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStarRating = (questionId: string, currentRating?: RatingType) => {
    const rating = currentRating || 0;
    return (
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map(star => (
          <button
            key={star}
            type="button"
            aria-label={`${questionId}: ${star} of 5`}
            onClick={() => setResponse(questionId, { rating: star as RatingType })}
            onMouseEnter={() => setHoveredStar(star)}
            onMouseLeave={() => setHoveredStar(0)}
            className="p-1 transition-transform hover:scale-110"
          >
            <Star
              className={`w-8 h-8 ${
                star <= (hoveredStar || rating)
                  ? 'fill-yellow-400 text-yellow-400'
                  : 'text-gray-300'
              }`}
            />
          </button>
        ))}
      </div>
    );
  };

  const renderYesNo = (questionId: string, currentValue?: boolean) => {
    return (
      <div className="flex gap-4">
        <button
          type="button"
          aria-label={`${questionId}: ${t('common.yes')}`}
          onClick={() => setResponse(questionId, { yesNo: true })}
          className={`flex items-center gap-2 px-6 py-3 rounded-lg border-2 transition-all ${
            currentValue === true
              ? 'border-green-500 bg-ok-subtle text-ok-subtle-fg'
              : 'border-border hover:border-border-strong'
          }`}
        >
          <ThumbsUp className={`w-5 h-5 ${currentValue === true ? 'text-green-500' : 'text-content-muted'}`} />
          <span className="font-medium">{t('common.yes')}</span>
        </button>
        <button
          type="button"
          aria-label={`${questionId}: ${t('common.no')}`}
          onClick={() => setResponse(questionId, { yesNo: false })}
          className={`flex items-center gap-2 px-6 py-3 rounded-lg border-2 transition-all ${
            currentValue === false
              ? 'border-red-500 bg-critical-subtle text-critical-subtle-fg'
              : 'border-border hover:border-border-strong'
          }`}
        >
          <ThumbsDown className={`w-5 h-5 ${currentValue === false ? 'text-red-500' : 'text-content-muted'}`} />
          <span className="font-medium">{t('common.no')}</span>
        </button>
      </div>
    );
  };

  const renderQuestionSet = (questions: SurveyQuestion[]) => {
    return (
      <div className="space-y-6">
        {questions.map(q => {
          const response = getResponse(q.id);
          return (
            <div key={q.id} className="bg-surface rounded-lg shadow p-4">
              <p className="font-medium text-content mb-3">
                {q.question}
                {q.required && <span className="text-red-500 ml-1">*</span>}
              </p>
              {q.type === 'stars' && renderStarRating(q.id, response?.rating)}
              {q.type === 'yesno' && renderYesNo(q.id, response?.yesNo)}
            </div>
          );
        })}
      </div>
    );
  };

  const getStepIcon = (s: SurveyStep) => {
    switch (s) {
      case 'visit': return <Stethoscope className="w-5 h-5" />;
      case 'staff': return <Users className="w-5 h-5" />;
      case 'facility': return <Building className="w-5 h-5" />;
      case 'feedback': return <MessageSquare className="w-5 h-5" />;
      default: return null;
    }
  };

  const progressSteps = ['visit', 'staff', 'facility', 'feedback'];
  const currentStepIndex = progressSteps.indexOf(step);

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-pink-500 to-rose-500 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <ClipboardList className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('survey.title')}</h1>
        </div>
        <p className="text-pink-100">{t('survey.subtitle')}</p>
      </div>

      {/* Progress Bar */}
      {step !== 'intro' && step !== 'submitted' && (
        <div className="px-4 py-3 bg-surface border-b">
          <div className="flex justify-between mb-2">
            {progressSteps.map((s, idx) => (
              <div
                key={s}
                className={`flex items-center gap-1 text-xs font-medium ${
                  idx <= currentStepIndex ? 'text-pink-600' : 'text-content-muted'
                }`}
              >
                {getStepIcon(s as SurveyStep)}
                <span className="hidden sm:inline">{t(`survey.step${s.charAt(0).toUpperCase()}${s.slice(1)}`)}</span>
              </div>
            ))}
          </div>
          <div className="w-full bg-surface-sunken rounded-full h-2">
            <div
              className="bg-pink-500 h-2 rounded-full transition-all"
              style={{ width: `${((currentStepIndex + 1) / progressSteps.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="p-4 pb-8">
        {/* Intro Step */}
        {step === 'intro' && (
          <div className="space-y-6">
            <div className="bg-surface rounded-lg shadow p-6 text-center">
              <Heart className="w-16 h-16 text-pink-500 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-content mb-2">{t('survey.valueTitle')}</h2>
              <p className="text-content-muted mb-6">
                {t('survey.valueBody')}
              </p>

              <div className="bg-pink-50 rounded-lg p-4 mb-6">
                <h3 className="font-medium text-pink-900 mb-2">{t('survey.recentVisit')}</h3>
                <div className="text-sm text-pink-700">
                  {recentVisit ? (
                    <>
                      <p>{recentVisit.provider_name} - {recentVisit.appointment_type}</p>
                      <p className="flex items-center justify-center gap-1 mt-1">
                        <Clock className="w-4 h-4" />
                        {recentVisit.scheduled_date}
                      </p>
                    </>
                  ) : (
                    <p>{t('survey.noRecentVisit')}</p>
                  )}
                </div>
              </div>

              <button
                onClick={() => setStep('visit')}
                className="w-full py-3 bg-pink-500 text-white rounded-lg font-semibold hover:bg-pink-600 flex items-center justify-center gap-2"
              >
                {t('survey.startSurvey')}
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-notice-subtle rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5" />
                <div>
                  <h4 className="font-medium text-notice-subtle-fg">{t('survey.anonTitle')}</h4>
                  <p className="text-sm text-notice-subtle-fg mt-1">
                    {t('survey.anonBody')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Visit Questions */}
        {step === 'visit' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Stethoscope className="w-6 h-6 text-pink-500" />
              <h2 className="text-lg font-bold text-content">{t('survey.visitHeader')}</h2>
            </div>
            {renderQuestionSet(visitQuestions)}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep('intro')}
                className="flex-1 py-3 border border-border-strong text-content-secondary rounded-lg font-semibold hover:bg-surface-sunken"
              >
                {t('common.back')}
              </button>
              <button
                type="button"
                onClick={() => setStep('staff')}
                disabled={!isStepComplete(visitQuestions)}
                className={`flex-1 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                  isStepComplete(visitQuestions)
                    ? 'bg-pink-500 text-white hover:bg-pink-600'
                    : 'bg-surface-sunken text-content-muted cursor-not-allowed'
                }`}
              >
                {t('survey.continue')}
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* Staff Questions */}
        {step === 'staff' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-6 h-6 text-pink-500" />
              <h2 className="text-lg font-bold text-content">{t('survey.staffHeader')}</h2>
            </div>
            {renderQuestionSet(staffQuestions)}
            <div className="flex gap-3">
              <button
                onClick={() => setStep('visit')}
                className="flex-1 py-3 border border-border-strong text-content-secondary rounded-lg font-semibold hover:bg-surface-sunken"
              >
                {t('common.back')}
              </button>
              <button
                onClick={() => setStep('facility')}
                disabled={!isStepComplete(staffQuestions)}
                className={`flex-1 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                  isStepComplete(staffQuestions)
                    ? 'bg-pink-500 text-white hover:bg-pink-600'
                    : 'bg-surface-sunken text-content-muted cursor-not-allowed'
                }`}
              >
                {t('survey.continue')}
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* Facility Questions */}
        {step === 'facility' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Building className="w-6 h-6 text-pink-500" />
              <h2 className="text-lg font-bold text-content">{t('survey.facilityHeader')}</h2>
            </div>
            {renderQuestionSet(facilityQuestions)}
            <div className="flex gap-3">
              <button
                onClick={() => setStep('staff')}
                className="flex-1 py-3 border border-border-strong text-content-secondary rounded-lg font-semibold hover:bg-surface-sunken"
              >
                {t('common.back')}
              </button>
              <button
                onClick={() => setStep('feedback')}
                className="flex-1 py-3 bg-pink-500 text-white rounded-lg font-semibold hover:bg-pink-600 flex items-center justify-center gap-2"
              >
                {t('survey.continue')}
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* Final Feedback */}
        {step === 'feedback' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare className="w-6 h-6 text-pink-500" />
              <h2 className="text-lg font-bold text-content">{t('survey.feedbackHeader')}</h2>
            </div>

            {/* Overall Rating */}
            <div className="bg-surface rounded-lg shadow p-4">
              <p className="font-medium text-content mb-3">
                {t('survey.overallQuestion')} <span className="text-red-500">*</span>
              </p>
              <div className="flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map(star => (
                  <button
                    key={star}
                    type="button"
                    aria-label={`overall: ${star} of 5`}
                    onClick={() => setOverallRating(star as RatingType)}
                    className="p-2 transition-transform hover:scale-110"
                  >
                    <Star
                      className={`w-10 h-10 ${
                        star <= overallRating
                          ? 'fill-yellow-400 text-yellow-400'
                          : 'text-gray-300'
                      }`}
                    />
                  </button>
                ))}
              </div>
              {overallRating > 0 && (
                <p className="text-center text-sm text-content-muted mt-2">
                  {overallRating === 5 ? t('survey.rate5') : overallRating === 4 ? t('survey.rate4') : overallRating === 3 ? t('survey.rate3') : overallRating === 2 ? t('survey.rate2') : t('survey.rate1')}
                </p>
              )}
            </div>

            {/* Would Recommend */}
            <div className="bg-surface rounded-lg shadow p-4">
              <p className="font-medium text-content mb-3">
                {t('survey.recommendQuestion')} <span className="text-red-500">*</span>
              </p>
              <div className="flex gap-4 justify-center">
                <button
                  type="button"
                  aria-label={`recommend: ${t('common.yes')}`}
                  onClick={() => setWouldRecommend(true)}
                  className={`flex items-center gap-2 px-8 py-4 rounded-lg border-2 transition-all ${
                    wouldRecommend === true
                      ? 'border-green-500 bg-ok-subtle text-ok-subtle-fg'
                      : 'border-border hover:border-border-strong'
                  }`}
                >
                  <ThumbsUp className={`w-6 h-6 ${wouldRecommend === true ? 'text-green-500' : 'text-content-muted'}`} />
                  <span className="font-medium">{t('common.yes')}</span>
                </button>
                <button
                  type="button"
                  aria-label={`recommend: ${t('common.no')}`}
                  onClick={() => setWouldRecommend(false)}
                  className={`flex items-center gap-2 px-8 py-4 rounded-lg border-2 transition-all ${
                    wouldRecommend === false
                      ? 'border-red-500 bg-critical-subtle text-critical-subtle-fg'
                      : 'border-border hover:border-border-strong'
                  }`}
                >
                  <ThumbsDown className={`w-6 h-6 ${wouldRecommend === false ? 'text-red-500' : 'text-content-muted'}`} />
                  <span className="font-medium">{t('common.no')}</span>
                </button>
              </div>
            </div>

            {/* Additional Comments */}
            <div className="bg-surface rounded-lg shadow p-4">
              <label htmlFor="survey-additional-comments" className="block font-medium text-content mb-3">
                {t('survey.commentsLabel')}
              </label>
              <textarea
                id="survey-additional-comments"
                value={additionalComments}
                onChange={(e) => setAdditionalComments(e.target.value)}
                placeholder={t('survey.commentsPlaceholder')}
                rows={4}
                className="w-full border border-border-strong rounded-lg p-3 focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
              />
            </div>

            {submitError && (
              <div role="alert" className="rounded-lg border border-critical bg-critical-subtle p-3 text-sm text-critical-subtle-fg">
                {submitError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setStep('facility')}
                className="flex-1 py-3 border border-border-strong text-content-secondary rounded-lg font-semibold hover:bg-surface-sunken"
              >
                {t('common.back')}
              </button>
              <button
                onClick={handleSubmit}
                disabled={overallRating === 0 || wouldRecommend === null || isSubmitting}
                className={`flex-1 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                  overallRating > 0 && wouldRecommend !== null && !isSubmitting
                    ? 'bg-pink-500 text-white hover:bg-pink-600'
                    : 'bg-surface-sunken text-content-muted cursor-not-allowed'
                }`}
              >
                {isSubmitting ? (
                  <>{t('survey.submitting')}</>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    {t('survey.submit')}
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Submitted Confirmation */}
        {step === 'submitted' && (
          <div className="text-center py-12">
            <div className="w-20 h-20 bg-ok-subtle rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10 text-green-500" />
            </div>
            <h2 className="text-2xl font-bold text-content mb-2">{t('survey.thankYou')}</h2>
            <p className="text-content-muted mb-8">
              {t('survey.thankYouBody')}
            </p>
            <button
              onClick={() => {
                setStep('intro');
                setResponses([]);
                setOverallRating(0);
                setWouldRecommend(null);
                setAdditionalComments('');
                setSubmitError(null);
              }}
              className="px-6 py-3 bg-pink-500 text-white rounded-lg font-semibold hover:bg-pink-600"
            >
              {t('survey.submitAnother')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SatisfactionSurveyPage;
