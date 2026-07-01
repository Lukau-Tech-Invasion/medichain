import React, { useState, useRef, useEffect } from 'react';
import {
  Stethoscope,
  Send,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  Clock,
  User,
  Bot,
  Plus,
  X,
  ChevronRight,
  Phone,
  MapPin,
  Heart,
  Thermometer,
  Activity,
  Brain,
  Bone,
  Eye,
  Ear,
  Loader2
} from 'lucide-react';
import { analyzeSymptoms as analyzeSymptomAPI, useTranslation } from '@medichain/shared';

/**
 * SymptomCheckerPage
 * 
 * AI-driven symptom checking interface with chat-like experience.
 * Provides triage recommendations based on reported symptoms.
 */

type Severity = 'emergency' | 'urgent' | 'moderate' | 'mild' | 'self-care';
type BodyPart = 'head' | 'chest' | 'abdomen' | 'back' | 'limbs' | 'skin' | 'general';

interface Symptom {
  id: string;
  name: string;
  bodyPart: BodyPart;
  duration?: string;
  severity?: 'mild' | 'moderate' | 'severe';
}

interface ChatMessage {
  id: string;
  type: 'user' | 'bot';
  content: string;
  timestamp: Date;
  options?: string[];
  symptoms?: Symptom[];
}

interface TriageResult {
  severity: Severity;
  title: string;
  description: string;
  recommendations: string[];
  possibleConditions: string[];
}

const SymptomCheckerPage: React.FC = () => {
  const { t } = useTranslation();
  const [step, setStep] = useState<'intro' | 'chat' | 'result'>('intro');
  const [selectedSymptoms, setSelectedSymptoms] = useState<Symptom[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | 'other' | ''>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Canonical English names are kept for API calls / detection logic; UI shows localized labels.
  const commonSymptoms: Symptom[] = [
    { id: 's1', name: 'Headache', bodyPart: 'head' },
    { id: 's2', name: 'Fever', bodyPart: 'general' },
    { id: 's3', name: 'Cough', bodyPart: 'chest' },
    { id: 's4', name: 'Sore throat', bodyPart: 'head' },
    { id: 's5', name: 'Fatigue', bodyPart: 'general' },
    { id: 's6', name: 'Nausea', bodyPart: 'abdomen' },
    { id: 's7', name: 'Chest pain', bodyPart: 'chest' },
    { id: 's8', name: 'Shortness of breath', bodyPart: 'chest' },
    { id: 's9', name: 'Dizziness', bodyPart: 'head' },
    { id: 's10', name: 'Back pain', bodyPart: 'back' },
    { id: 's11', name: 'Joint pain', bodyPart: 'limbs' },
    { id: 's12', name: 'Abdominal pain', bodyPart: 'abdomen' },
    { id: 's13', name: 'Skin rash', bodyPart: 'skin' },
    { id: 's14', name: 'Congestion', bodyPart: 'head' },
    { id: 's15', name: 'Difficulty sleeping', bodyPart: 'general' }
  ];

  const symptomLabels: Record<string, string> = {
    s1: t('symptomChecker.sympHeadache'),
    s2: t('symptomChecker.sympFever'),
    s3: t('symptomChecker.sympCough'),
    s4: t('symptomChecker.sympSoreThroat'),
    s5: t('symptomChecker.sympFatigue'),
    s6: t('symptomChecker.sympNausea'),
    s7: t('symptomChecker.sympChestPain'),
    s8: t('symptomChecker.sympShortBreath'),
    s9: t('symptomChecker.sympDizziness'),
    s10: t('symptomChecker.sympBackPain'),
    s11: t('symptomChecker.sympJointPain'),
    s12: t('symptomChecker.sympAbdominalPain'),
    s13: t('symptomChecker.sympSkinRash'),
    s14: t('symptomChecker.sympCongestion'),
    s15: t('symptomChecker.sympSleep'),
  };

  // Localized display label for a symptom (falls back to its canonical name).
  const symptomLabel = (s: Symptom): string => symptomLabels[s.id] || s.name;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const addBotMessage = (content: string, options?: string[], delay = 1000) => {
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      setMessages(prev => [...prev, {
        id: `bot-${Date.now()}`,
        type: 'bot',
        content,
        timestamp: new Date(),
        options
      }]);
    }, delay);
  };

  const startAssessment = () => {
    setStep('chat');
    setMessages([
      {
        id: 'welcome',
        type: 'bot',
        content: t('symptomChecker.welcome'),
        timestamp: new Date()
      }
    ]);
    addBotMessage(t('symptomChecker.startPrompt'), undefined, 1500);
  };

  const handleSymptomSelect = (symptom: Symptom) => {
    if (selectedSymptoms.find(s => s.id === symptom.id)) {
      setSelectedSymptoms(prev => prev.filter(s => s.id !== symptom.id));
    } else {
      setSelectedSymptoms(prev => [...prev, symptom]);
      const label = symptomLabel(symptom);
      setMessages(prev => [...prev, {
        id: `user-${Date.now()}`,
        type: 'user',
        content: t('symptomChecker.addedSymptom', { name: label }),
        timestamp: new Date()
      }]);

      // Bot response
      const responses = [
        t('symptomChecker.botNoted', { name: label }),
        t('symptomChecker.botUnderstood', { name: label }),
        t('symptomChecker.botConstant', { name: label.toLowerCase() })
      ];
      addBotMessage(responses[Math.floor(Math.random() * responses.length)]);
    }
  };

  const handleSendMessage = () => {
    if (!inputValue.trim()) return;
    
    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`,
      type: 'user',
      content: inputValue,
      timestamp: new Date()
    }]);
    
    const input = inputValue.toLowerCase();
    setInputValue('');

    // Simple symptom detection
    if (input.includes('chest pain') || input.includes('heart')) {
      if (!selectedSymptoms.find(s => s.id === 's7')) {
        handleSymptomSelect({ id: 's7', name: 'Chest pain', bodyPart: 'chest' });
      }
    } else if (input.includes('headache') || input.includes('head hurts')) {
      if (!selectedSymptoms.find(s => s.id === 's1')) {
        handleSymptomSelect({ id: 's1', name: 'Headache', bodyPart: 'head' });
      }
    } else if (input.includes('fever') || input.includes('temperature')) {
      if (!selectedSymptoms.find(s => s.id === 's2')) {
        handleSymptomSelect({ id: 's2', name: 'Fever', bodyPart: 'general' });
      }
    } else {
      addBotMessage(t('symptomChecker.botThanks'));
    }
  };

  const analyzeSymptoms = async () => {
    setIsTyping(true);
    
    // Helper to map API triage level to local severity
    const mapTriageToSeverity = (triage: string): Severity => {
      switch (triage) {
        case 'emergency': return 'emergency';
        case 'urgent_care': return 'urgent';
        case 'schedule_appointment': return 'moderate';
        case 'self_care': return 'self-care';
        default: return 'mild';
      }
    };

    // Helper to get title from triage level
    const getTriageTitle = (triage: string): string => {
      switch (triage) {
        case 'emergency': return t('symptomChecker.triageEmergency');
        case 'urgent_care': return t('symptomChecker.triageUrgent');
        case 'schedule_appointment': return t('symptomChecker.triageSchedule');
        case 'self_care': return t('symptomChecker.triageSelfCare');
        default: return t('symptomChecker.triageConsult');
      }
    };

    try {
      // Call the actual API
      const symptomNames = selectedSymptoms.map(s => s.name);
      const apiResult = await analyzeSymptomAPI({
        symptoms: symptomNames,
        patient_age: age ? parseInt(age, 10) : undefined,
        patient_gender: gender || undefined,
      });

      // Map API result to local TriageResult format
      const result: TriageResult = {
        severity: mapTriageToSeverity(apiResult.triage_level),
        title: getTriageTitle(apiResult.triage_level),
        description: apiResult.triage_message,
        recommendations: [
          ...apiResult.recommendations,
          ...apiResult.self_care_advice,
          ...apiResult.when_to_seek_care
        ],
        possibleConditions: apiResult.possible_conditions.map(c => c.condition_name)
      };

      setTriageResult(result);
      setStep('result');
    } catch (error) {
      console.error('API call failed, using fallback analysis:', error);
      // Fallback to local analysis if API fails
      let result: TriageResult;
      const hasChestPain = selectedSymptoms.some(s => s.name.toLowerCase().includes('chest'));
      const hasBreathing = selectedSymptoms.some(s => s.name.toLowerCase().includes('breath'));
      const hasFever = selectedSymptoms.some(s => s.name.toLowerCase().includes('fever'));
      const hasCough = selectedSymptoms.some(s => s.name.toLowerCase().includes('cough'));

      if (hasChestPain || hasBreathing) {
        result = {
          severity: 'urgent',
          title: t('symptomChecker.triageUrgent'),
          description: t('symptomChecker.fbUrgentDesc'),
          recommendations: [
            t('symptomChecker.fbUrgentRec1'),
            t('symptomChecker.fbUrgentRec2'),
            t('symptomChecker.fbUrgentRec3')
          ],
          possibleConditions: [
            t('symptomChecker.fbUrgentCond1'),
            t('symptomChecker.fbUrgentCond2'),
            t('symptomChecker.fbUrgentCond3'),
            t('symptomChecker.fbUrgentCond4')
          ]
        };
      } else if (hasFever && hasCough) {
        result = {
          severity: 'moderate',
          title: t('symptomChecker.triageSchedule'),
          description: t('symptomChecker.fbFeverDesc'),
          recommendations: [
            t('symptomChecker.fbFeverRec1'),
            t('symptomChecker.fbFeverRec2'),
            t('symptomChecker.fbFeverRec3'),
            t('symptomChecker.fbFeverRec4')
          ],
          possibleConditions: [
            t('symptomChecker.fbFeverCond1'),
            t('symptomChecker.fbFeverCond2'),
            t('symptomChecker.fbFeverCond3'),
            t('symptomChecker.fbFeverCond4')
          ]
        };
      } else if (selectedSymptoms.length >= 3) {
        result = {
          severity: 'moderate',
          title: t('symptomChecker.triageConsult'),
          description: t('symptomChecker.fbMultiDesc'),
          recommendations: [
            t('symptomChecker.fbMultiRec1'),
            t('symptomChecker.fbMultiRec2'),
            t('symptomChecker.fbMultiRec3'),
            t('symptomChecker.fbMultiRec4')
          ],
          possibleConditions: [
            t('symptomChecker.fbMultiCond1'),
            t('symptomChecker.fbMultiCond2'),
            t('symptomChecker.fbMultiCond3')
          ]
        };
      } else {
        result = {
          severity: 'self-care',
          title: t('symptomChecker.triageSelfCare'),
          description: t('symptomChecker.fbSelfDesc'),
          recommendations: [
            t('symptomChecker.fbSelfRec1'),
            t('symptomChecker.fbSelfRec2'),
            t('symptomChecker.fbSelfRec3'),
            t('symptomChecker.fbSelfRec4'),
            t('symptomChecker.fbSelfRec5')
          ],
          possibleConditions: [
            t('symptomChecker.fbSelfCond1'),
            t('symptomChecker.fbSelfCond2'),
            t('symptomChecker.fbSelfCond3')
          ]
        };
      }

      setTriageResult(result);
      setStep('result');
    } finally {
      setIsTyping(false);
    }
  };

  const getSeverityColor = (severity: Severity) => {
    switch (severity) {
      case 'emergency': return 'bg-red-500';
      case 'urgent': return 'bg-orange-500';
      case 'moderate': return 'bg-yellow-500';
      case 'mild': return 'bg-blue-500';
      case 'self-care': return 'bg-green-500';
    }
  };

  const getBodyPartIcon = (bodyPart: BodyPart) => {
    switch (bodyPart) {
      case 'head': return <Brain className="w-4 h-4" />;
      case 'chest': return <Heart className="w-4 h-4" />;
      case 'abdomen': return <Activity className="w-4 h-4" />;
      case 'back': return <Bone className="w-4 h-4" />;
      case 'limbs': return <Bone className="w-4 h-4" />;
      case 'skin': return <User className="w-4 h-4" />;
      case 'general': return <Thermometer className="w-4 h-4" />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <Stethoscope className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('symptomChecker.title')}</h1>
        </div>
        <p className="text-purple-100">{t('symptomChecker.subtitle')}</p>
      </div>

      {/* Intro Screen */}
      {step === 'intro' && (
        <div className="flex-1 p-4">
          <div className="bg-white rounded-lg shadow p-6 mb-4">
            <div className="text-center mb-6">
              <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Bot className="w-10 h-10 text-purple-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">{t('symptomChecker.introHeading')}</h2>
              <p className="text-gray-600">
                {t('symptomChecker.introDescription')}
              </p>
            </div>

            {/* Basic Info */}
            <div className="space-y-4 mb-6">
              <div>
                <label htmlFor="symptom-checker-age" className="block text-sm font-medium text-gray-700 mb-1">{t('symptomChecker.ageLabel')}</label>
                <input
                  type="number"
                  id="symptom-checker-age"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  placeholder={t('symptomChecker.agePlaceholder')}
                  className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>
              <div>
                <label id="symptom-checker-gender-label" className="block text-sm font-medium text-gray-700 mb-1">{t('symptomChecker.genderLabel')}</label>
                <div className="flex gap-3" role="group" aria-labelledby="symptom-checker-gender-label">
                  {(['male', 'female', 'other'] as const).map(g => (
                    <button
                      key={g}
                      onClick={() => setGender(g)}
                      className={`flex-1 py-2 px-4 rounded-lg border-2 transition-all ${
                        gender === g
                          ? 'border-purple-500 bg-purple-50 text-purple-700'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {g === 'male' ? t('symptomChecker.genderMale') : g === 'female' ? t('symptomChecker.genderFemale') : t('symptomChecker.genderOther')}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={startAssessment}
              disabled={!age || !gender}
              className={`w-full py-3 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                age && gender
                  ? 'bg-purple-600 text-white hover:bg-purple-700'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {t('symptomChecker.start')}
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <div className="bg-yellow-50 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-yellow-900">{t('symptomChecker.disclaimerTitle')}</h4>
                <p className="text-sm text-yellow-700 mt-1">
                  {t('symptomChecker.disclaimerBody')}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chat Screen */}
      {step === 'chat' && (
        <>
          {/* Selected Symptoms Bar */}
          {selectedSymptoms.length > 0 && (
            <div className="bg-white border-b px-4 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500">{t('symptomChecker.selected')}</span>
                {selectedSymptoms.map(s => (
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-1 bg-purple-100 text-purple-700 text-xs px-2 py-1 rounded-full"
                  >
                    {symptomLabel(s)}
                    <button onClick={() => handleSymptomSelect(s)}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`flex items-start gap-2 max-w-[85%] ${msg.type === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    msg.type === 'bot' ? 'bg-purple-100' : 'bg-gray-200'
                  }`}>
                    {msg.type === 'bot' ? (
                      <Bot className="w-5 h-5 text-purple-600" />
                    ) : (
                      <User className="w-5 h-5 text-gray-600" />
                    )}
                  </div>
                  <div className={`rounded-2xl px-4 py-2 ${
                    msg.type === 'bot'
                      ? 'bg-white border border-gray-200'
                      : 'bg-purple-600 text-white'
                  }`}>
                    <p className="text-sm">{msg.content}</p>
                  </div>
                </div>
              </div>
            ))}
            
            {isTyping && (
              <div className="flex justify-start">
                <div className="flex items-start gap-2">
                  <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                    <Bot className="w-5 h-5 text-purple-600" />
                  </div>
                  <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Common Symptoms */}
          <div className="bg-white border-t px-4 py-3">
            <p className="text-xs text-gray-500 mb-2">{t('symptomChecker.commonSymptoms')}</p>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {commonSymptoms.slice(0, 8).map(symptom => (
                <button
                  key={symptom.id}
                  onClick={() => handleSymptomSelect(symptom)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-all ${
                    selectedSymptoms.find(s => s.id === symptom.id)
                      ? 'bg-purple-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {getBodyPartIcon(symptom.bodyPart)}
                  {symptomLabel(symptom)}
                </button>
              ))}
            </div>
          </div>

          {/* Input Area */}
          <div className="bg-white border-t p-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={t('symptomChecker.inputPlaceholder')}
                className="flex-1 border border-gray-300 rounded-full px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
              <button
                onClick={handleSendMessage}
                className="p-2 bg-purple-600 text-white rounded-full hover:bg-purple-700"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
            {selectedSymptoms.length > 0 && (
              <button
                onClick={analyzeSymptoms}
                className="w-full mt-3 py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700"
              >
                {t('symptomChecker.analyze', { count: selectedSymptoms.length })}
              </button>
            )}
          </div>
        </>
      )}

      {/* Result Screen */}
      {step === 'result' && triageResult && (
        <div className="flex-1 p-4 pb-8">
          {/* Severity Banner */}
          <div className={`${getSeverityColor(triageResult.severity)} text-white rounded-lg p-4 mb-4`}>
            <div className="flex items-center gap-3">
              {triageResult.severity === 'emergency' || triageResult.severity === 'urgent' ? (
                <AlertTriangle className="w-8 h-8" />
              ) : triageResult.severity === 'self-care' ? (
                <CheckCircle className="w-8 h-8" />
              ) : (
                <AlertCircle className="w-8 h-8" />
              )}
              <div>
                <h2 className="text-xl font-bold">{triageResult.title}</h2>
                <p className="text-sm opacity-90">{triageResult.description}</p>
              </div>
            </div>
          </div>

          {/* Selected Symptoms Summary */}
          <div className="bg-white rounded-lg shadow p-4 mb-4">
            <h3 className="font-semibold text-gray-900 mb-3">{t('symptomChecker.reportedSymptoms')}</h3>
            <div className="flex flex-wrap gap-2">
              {selectedSymptoms.map(s => (
                <span key={s.id} className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-sm">
                  {symptomLabel(s)}
                </span>
              ))}
            </div>
          </div>

          {/* Recommendations */}
          <div className="bg-white rounded-lg shadow p-4 mb-4">
            <h3 className="font-semibold text-gray-900 mb-3">{t('symptomChecker.recommendations')}</h3>
            <ul className="space-y-2">
              {triageResult.recommendations.map((rec, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-700">{rec}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Possible Conditions */}
          <div className="bg-white rounded-lg shadow p-4 mb-4">
            <h3 className="font-semibold text-gray-900 mb-3">{t('symptomChecker.possibleConditions')}</h3>
            <p className="text-sm text-gray-500 mb-2">{t('symptomChecker.conditionsDisclaimer')}</p>
            <ul className="space-y-1">
              {triageResult.possibleConditions.map((cond, idx) => (
                <li key={idx} className="text-gray-700 flex items-center gap-2">
                  <span className="w-2 h-2 bg-purple-400 rounded-full" />
                  {cond}
                </li>
              ))}
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3">
            {(triageResult.severity === 'emergency' || triageResult.severity === 'urgent') && (
              <a
                href="tel:911"
                className="w-full py-3 bg-red-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2"
              >
                <Phone className="w-5 h-5" />
                {t('symptomChecker.call911')}
              </a>
            )}
            <button className="w-full py-3 bg-purple-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2">
              <Clock className="w-5 h-5" />
              {t('symptomChecker.schedule')}
            </button>
            <button className="w-full py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold flex items-center justify-center gap-2">
              <MapPin className="w-5 h-5" />
              {t('symptomChecker.findCare')}
            </button>
            <button
              onClick={() => {
                setStep('intro');
                setSelectedSymptoms([]);
                setMessages([]);
                setTriageResult(null);
              }}
              className="w-full py-3 text-purple-600 font-semibold"
            >
              {t('symptomChecker.startNew')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SymptomCheckerPage;
