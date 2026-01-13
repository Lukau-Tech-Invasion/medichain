import React, { useState } from 'react';
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
  const [step, setStep] = useState<SurveyStep>('intro');
  const [responses, setResponses] = useState<SurveyResponse[]>([]);
  const [overallRating, setOverallRating] = useState<RatingType>(0);
  const [wouldRecommend, setWouldRecommend] = useState<boolean | null>(null);
  const [additionalComments, setAdditionalComments] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hoveredStar, setHoveredStar] = useState<number>(0);

  const visitQuestions: SurveyQuestion[] = [
    { id: 'v1', category: 'visit', question: 'How would you rate your overall visit experience?', type: 'stars', required: true },
    { id: 'v2', category: 'visit', question: 'Was your appointment on time?', type: 'yesno', required: true },
    { id: 'v3', category: 'visit', question: 'Was the purpose of your visit fully addressed?', type: 'yesno', required: true },
    { id: 'v4', category: 'visit', question: 'How clear was the information provided about your treatment?', type: 'stars', required: true }
  ];

  const staffQuestions: SurveyQuestion[] = [
    { id: 's1', category: 'staff', question: 'How would you rate the courtesy of the staff?', type: 'stars', required: true },
    { id: 's2', category: 'staff', question: 'Did your doctor listen carefully to your concerns?', type: 'yesno', required: true },
    { id: 's3', category: 'staff', question: 'How would you rate the professionalism of your care team?', type: 'stars', required: true },
    { id: 's4', category: 'staff', question: 'Did staff explain things in a way you could understand?', type: 'yesno', required: true }
  ];

  const facilityQuestions: SurveyQuestion[] = [
    { id: 'f1', category: 'facility', question: 'How would you rate the cleanliness of the facility?', type: 'stars', required: true },
    { id: 'f2', category: 'facility', question: 'Was it easy to find your way around?', type: 'yesno', required: false },
    { id: 'f3', category: 'facility', question: 'How comfortable was the waiting area?', type: 'stars', required: false },
    { id: 'f4', category: 'facility', question: 'Were you satisfied with the available parking?', type: 'yesno', required: false }
  ];

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

  const handleSubmit = () => {
    setIsSubmitting(true);
    // Simulate submission
    setTimeout(() => {
      setIsSubmitting(false);
      setStep('submitted');
    }, 1500);
  };

  const renderStarRating = (questionId: string, currentRating?: RatingType) => {
    const rating = currentRating || 0;
    return (
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map(star => (
          <button
            key={star}
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
          onClick={() => setResponse(questionId, { yesNo: true })}
          className={`flex items-center gap-2 px-6 py-3 rounded-lg border-2 transition-all ${
            currentValue === true
              ? 'border-green-500 bg-green-50 text-green-700'
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <ThumbsUp className={`w-5 h-5 ${currentValue === true ? 'text-green-500' : 'text-gray-400'}`} />
          <span className="font-medium">Yes</span>
        </button>
        <button
          onClick={() => setResponse(questionId, { yesNo: false })}
          className={`flex items-center gap-2 px-6 py-3 rounded-lg border-2 transition-all ${
            currentValue === false
              ? 'border-red-500 bg-red-50 text-red-700'
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <ThumbsDown className={`w-5 h-5 ${currentValue === false ? 'text-red-500' : 'text-gray-400'}`} />
          <span className="font-medium">No</span>
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
            <div key={q.id} className="bg-white rounded-lg shadow p-4">
              <p className="font-medium text-gray-900 mb-3">
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-pink-500 to-rose-500 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <ClipboardList className="w-8 h-8" />
          <h1 className="text-2xl font-bold">Patient Feedback</h1>
        </div>
        <p className="text-pink-100">Help us improve your care experience</p>
      </div>

      {/* Progress Bar */}
      {step !== 'intro' && step !== 'submitted' && (
        <div className="px-4 py-3 bg-white border-b">
          <div className="flex justify-between mb-2">
            {progressSteps.map((s, idx) => (
              <div
                key={s}
                className={`flex items-center gap-1 text-xs font-medium ${
                  idx <= currentStepIndex ? 'text-pink-600' : 'text-gray-400'
                }`}
              >
                {getStepIcon(s as SurveyStep)}
                <span className="hidden sm:inline capitalize">{s}</span>
              </div>
            ))}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
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
            <div className="bg-white rounded-lg shadow p-6 text-center">
              <Heart className="w-16 h-16 text-pink-500 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-gray-900 mb-2">We Value Your Feedback</h2>
              <p className="text-gray-600 mb-6">
                Your opinions help us provide better care. This survey takes about 3 minutes to complete.
              </p>
              
              <div className="bg-pink-50 rounded-lg p-4 mb-6">
                <h3 className="font-medium text-pink-900 mb-2">Recent Visit</h3>
                <div className="text-sm text-pink-700">
                  <p>Dr. Sarah Chen - Primary Care</p>
                  <p className="flex items-center justify-center gap-1 mt-1">
                    <Clock className="w-4 h-4" />
                    January 10, 2025
                  </p>
                </div>
              </div>

              <button
                onClick={() => setStep('visit')}
                className="w-full py-3 bg-pink-500 text-white rounded-lg font-semibold hover:bg-pink-600 flex items-center justify-center gap-2"
              >
                Start Survey
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-blue-50 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5" />
                <div>
                  <h4 className="font-medium text-blue-900">Anonymous Feedback</h4>
                  <p className="text-sm text-blue-700 mt-1">
                    Your responses are confidential and will be used to improve our services.
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
              <h2 className="text-lg font-bold text-gray-900">Your Visit Experience</h2>
            </div>
            {renderQuestionSet(visitQuestions)}
            <button
              onClick={() => setStep('staff')}
              disabled={!isStepComplete(visitQuestions)}
              className={`w-full py-3 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                isStepComplete(visitQuestions)
                  ? 'bg-pink-500 text-white hover:bg-pink-600'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              Continue
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Staff Questions */}
        {step === 'staff' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-6 h-6 text-pink-500" />
              <h2 className="text-lg font-bold text-gray-900">Our Staff</h2>
            </div>
            {renderQuestionSet(staffQuestions)}
            <div className="flex gap-3">
              <button
                onClick={() => setStep('visit')}
                className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={() => setStep('facility')}
                disabled={!isStepComplete(staffQuestions)}
                className={`flex-1 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                  isStepComplete(staffQuestions)
                    ? 'bg-pink-500 text-white hover:bg-pink-600'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                Continue
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
              <h2 className="text-lg font-bold text-gray-900">Our Facility</h2>
            </div>
            {renderQuestionSet(facilityQuestions)}
            <div className="flex gap-3">
              <button
                onClick={() => setStep('staff')}
                className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={() => setStep('feedback')}
                className="flex-1 py-3 bg-pink-500 text-white rounded-lg font-semibold hover:bg-pink-600 flex items-center justify-center gap-2"
              >
                Continue
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
              <h2 className="text-lg font-bold text-gray-900">Final Thoughts</h2>
            </div>

            {/* Overall Rating */}
            <div className="bg-white rounded-lg shadow p-4">
              <p className="font-medium text-gray-900 mb-3">
                Overall, how would you rate your experience? <span className="text-red-500">*</span>
              </p>
              <div className="flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map(star => (
                  <button
                    key={star}
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
                <p className="text-center text-sm text-gray-500 mt-2">
                  {overallRating === 5 ? 'Excellent!' : overallRating === 4 ? 'Very Good' : overallRating === 3 ? 'Good' : overallRating === 2 ? 'Fair' : 'Poor'}
                </p>
              )}
            </div>

            {/* Would Recommend */}
            <div className="bg-white rounded-lg shadow p-4">
              <p className="font-medium text-gray-900 mb-3">
                Would you recommend us to friends and family? <span className="text-red-500">*</span>
              </p>
              <div className="flex gap-4 justify-center">
                <button
                  onClick={() => setWouldRecommend(true)}
                  className={`flex items-center gap-2 px-8 py-4 rounded-lg border-2 transition-all ${
                    wouldRecommend === true
                      ? 'border-green-500 bg-green-50 text-green-700'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <ThumbsUp className={`w-6 h-6 ${wouldRecommend === true ? 'text-green-500' : 'text-gray-400'}`} />
                  <span className="font-medium">Yes</span>
                </button>
                <button
                  onClick={() => setWouldRecommend(false)}
                  className={`flex items-center gap-2 px-8 py-4 rounded-lg border-2 transition-all ${
                    wouldRecommend === false
                      ? 'border-red-500 bg-red-50 text-red-700'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <ThumbsDown className={`w-6 h-6 ${wouldRecommend === false ? 'text-red-500' : 'text-gray-400'}`} />
                  <span className="font-medium">No</span>
                </button>
              </div>
            </div>

            {/* Additional Comments */}
            <div className="bg-white rounded-lg shadow p-4">
              <p className="font-medium text-gray-900 mb-3">
                Any additional comments or suggestions?
              </p>
              <textarea
                value={additionalComments}
                onChange={(e) => setAdditionalComments(e.target.value)}
                placeholder="Share your thoughts with us..."
                rows={4}
                className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('facility')}
                className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={overallRating === 0 || wouldRecommend === null || isSubmitting}
                className={`flex-1 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                  overallRating > 0 && wouldRecommend !== null && !isSubmitting
                    ? 'bg-pink-500 text-white hover:bg-pink-600'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                {isSubmitting ? (
                  <>Submitting...</>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    Submit Feedback
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Submitted Confirmation */}
        {step === 'submitted' && (
          <div className="text-center py-12">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10 text-green-500" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Thank You!</h2>
            <p className="text-gray-600 mb-8">
              Your feedback has been submitted successfully. We appreciate you taking the time to help us improve.
            </p>
            <button
              onClick={() => {
                setStep('intro');
                setResponses([]);
                setOverallRating(0);
                setWouldRecommend(null);
                setAdditionalComments('');
              }}
              className="px-6 py-3 bg-pink-500 text-white rounded-lg font-semibold hover:bg-pink-600"
            >
              Submit Another Response
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SatisfactionSurveyPage;
