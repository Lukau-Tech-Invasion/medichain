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
import { analyzeSymptoms as analyzeSymptomAPI } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';

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
  const [step, setStep] = useState<'intro' | 'chat' | 'result'>('intro');
  const [selectedSymptoms, setSelectedSymptoms] = useState<Symptom[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | 'other' | ''>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
        content: "Hello! I'm your symptom checker assistant. I'll help you understand your symptoms and recommend next steps. This is not a diagnosis - always consult a healthcare provider for medical advice.",
        timestamp: new Date()
      }
    ]);
    addBotMessage("Let's start by selecting your symptoms. You can tap on common symptoms below or type to describe how you're feeling.", undefined, 1500);
  };

  const handleSymptomSelect = (symptom: Symptom) => {
    if (selectedSymptoms.find(s => s.id === symptom.id)) {
      setSelectedSymptoms(prev => prev.filter(s => s.id !== symptom.id));
    } else {
      setSelectedSymptoms(prev => [...prev, symptom]);
      setMessages(prev => [...prev, {
        id: `user-${Date.now()}`,
        type: 'user',
        content: `Added symptom: ${symptom.name}`,
        timestamp: new Date()
      }]);
      
      // Bot response
      const responses = [
        `I've noted ${symptom.name}. How long have you been experiencing this?`,
        `Understood, ${symptom.name}. Are there any other symptoms you're experiencing?`,
        `Got it. Is the ${symptom.name.toLowerCase()} constant or does it come and go?`
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
      addBotMessage("Thank you for that information. Can you tell me more about your symptoms? Try selecting from the common symptoms below or describe what you're feeling.");
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
        case 'emergency': return 'Seek Emergency Care Immediately';
        case 'urgent_care': return 'Seek Medical Attention';
        case 'schedule_appointment': return 'Schedule an Appointment';
        case 'self_care': return 'Self-Care May Be Appropriate';
        default: return 'Consider Medical Consultation';
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
          title: 'Seek Medical Attention',
          description: 'Your symptoms may require prompt medical evaluation.',
          recommendations: [
            'Visit an urgent care or emergency room today',
            'Do not drive yourself if symptoms worsen',
            'Call 911 if you experience severe chest pain or difficulty breathing'
          ],
          possibleConditions: ['Respiratory infection', 'Anxiety', 'Cardiac issues', 'Asthma exacerbation']
        };
      } else if (hasFever && hasCough) {
        result = {
          severity: 'moderate',
          title: 'Schedule an Appointment',
          description: 'Your symptoms suggest you may benefit from seeing a healthcare provider.',
          recommendations: [
            'Schedule an appointment within 24-48 hours',
            'Rest and stay hydrated',
            'Monitor your temperature',
            'Take over-the-counter fever reducers as directed'
          ],
          possibleConditions: ['Common cold', 'Flu', 'COVID-19', 'Bronchitis']
        };
      } else if (selectedSymptoms.length >= 3) {
        result = {
          severity: 'moderate',
          title: 'Consider Medical Consultation',
          description: 'Multiple symptoms present. A healthcare provider can help determine the cause.',
          recommendations: [
            'Schedule an appointment this week',
            'Keep track of your symptoms',
            'Note any triggers or patterns',
            'Rest and maintain good hydration'
          ],
          possibleConditions: ['Viral illness', 'Seasonal allergies', 'Stress-related symptoms']
        };
      } else {
        result = {
          severity: 'self-care',
          title: 'Self-Care May Be Appropriate',
          description: 'Your symptoms appear mild and may improve with self-care measures.',
          recommendations: [
            'Get plenty of rest',
            'Stay hydrated',
            'Use over-the-counter medications as needed',
            'Monitor for worsening symptoms',
            'Seek care if symptoms persist beyond 7 days'
          ],
          possibleConditions: ['Minor viral illness', 'Mild tension headache', 'General fatigue']
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
          <h1 className="text-2xl font-bold">Symptom Checker</h1>
        </div>
        <p className="text-purple-100">AI-assisted symptom assessment</p>
      </div>

      {/* Intro Screen */}
      {step === 'intro' && (
        <div className="flex-1 p-4">
          <div className="bg-white rounded-lg shadow p-6 mb-4">
            <div className="text-center mb-6">
              <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Bot className="w-10 h-10 text-purple-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">How are you feeling?</h2>
              <p className="text-gray-600">
                Describe your symptoms and I'll help you understand what might be happening and suggest next steps.
              </p>
            </div>

            {/* Basic Info */}
            <div className="space-y-4 mb-6">
              <div>
                <label htmlFor="symptom-checker-age" className="block text-sm font-medium text-gray-700 mb-1">Your Age</label>
                <input
                  type="number"
                  id="symptom-checker-age"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  placeholder="Enter your age"
                  className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>
              <div>
                <label id="symptom-checker-gender-label" className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                <div className="flex gap-3" role="group" aria-labelledby="symptom-checker-gender-label">
                  {(['male', 'female', 'other'] as const).map(g => (
                    <button
                      key={g}
                      onClick={() => setGender(g)}
                      className={`flex-1 py-2 px-4 rounded-lg border-2 capitalize transition-all ${
                        gender === g
                          ? 'border-purple-500 bg-purple-50 text-purple-700'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {g}
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
              Start Assessment
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <div className="bg-yellow-50 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-yellow-900">Important Disclaimer</h4>
                <p className="text-sm text-yellow-700 mt-1">
                  This tool provides general information only and is not a substitute for professional medical advice, diagnosis, or treatment. In case of emergency, call 911 immediately.
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
                <span className="text-xs text-gray-500">Selected:</span>
                {selectedSymptoms.map(s => (
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-1 bg-purple-100 text-purple-700 text-xs px-2 py-1 rounded-full"
                  >
                    {s.name}
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
            <p className="text-xs text-gray-500 mb-2">Common symptoms:</p>
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
                  {symptom.name}
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
                placeholder="Describe your symptoms..."
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
                Analyze My Symptoms ({selectedSymptoms.length})
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
            <h3 className="font-semibold text-gray-900 mb-3">Your Reported Symptoms</h3>
            <div className="flex flex-wrap gap-2">
              {selectedSymptoms.map(s => (
                <span key={s.id} className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-sm">
                  {s.name}
                </span>
              ))}
            </div>
          </div>

          {/* Recommendations */}
          <div className="bg-white rounded-lg shadow p-4 mb-4">
            <h3 className="font-semibold text-gray-900 mb-3">Recommendations</h3>
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
            <h3 className="font-semibold text-gray-900 mb-3">Possible Conditions</h3>
            <p className="text-sm text-gray-500 mb-2">These are possibilities, not diagnoses:</p>
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
                Call 911
              </a>
            )}
            <button className="w-full py-3 bg-purple-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2">
              <Clock className="w-5 h-5" />
              Schedule Appointment
            </button>
            <button className="w-full py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold flex items-center justify-center gap-2">
              <MapPin className="w-5 h-5" />
              Find Nearby Care
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
              Start New Assessment
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SymptomCheckerPage;
