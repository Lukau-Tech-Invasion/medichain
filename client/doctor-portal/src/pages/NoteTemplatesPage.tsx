import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { getNoteTemplates } from '@medichain/shared';
import { FileText, Plus, Search, Edit, Copy, Trash2, User, Clock, FileCheck, Clipboard, RefreshCw, AlertCircle } from 'lucide-react';

type TemplateType = 'history-physical' | 'progress-note' | 'discharge-summary' | 'consult' | 'procedure' | 'soap' | 'op-note';
type TemplateCategory = 'general' | 'emergency' | 'surgery' | 'medicine' | 'pediatrics' | 'psychiatry';

interface TemplateSection {
  sectionId: string;
  title: string;
  content: string;
  required: boolean;
  order: number;
}

interface NoteTemplate {
  templateId: string;
  name: string;
  type: TemplateType;
  category: TemplateCategory;
  description: string;
  sections: TemplateSection[];
  macros: string[];
  createdBy: string;
  createdAt: string;
  lastModified: string;
  usageCount: number;
  isActive: boolean;
  tags: string[];
}

/**
 * NoteTemplatesPage
 * 
 * Page for managing clinical documentation templates.
 */
const NoteTemplatesPage: React.FC = () => {
  const { user } = useAuthStore();
  const [templates, setTemplates] = useState<NoteTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'new' | 'macros'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<TemplateType | 'all'>('all');
  const [_selectedTemplate, setSelectedTemplate] = useState<NoteTemplate | null>(null);
  const [_showEditModal, _setShowEditModal] = useState(false);
  const [newTemplate, setNewTemplate] = useState<Partial<NoteTemplate>>({
    name: '',
    type: 'soap',
    category: 'general',
    description: '',
    sections: [],
    macros: [],
    tags: [],
    isActive: true,
  });
  const [newSection, setNewSection] = useState<Partial<TemplateSection>>({
    title: '',
    content: '',
    required: false,
    order: 0,
  });

  const fetchTemplates = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await getNoteTemplates();
      if (response && Array.isArray(response)) {
        setTemplates(response as NoteTemplate[]);
      } else if (response && typeof response === 'object' && 'items' in response) {
        setTemplates((response as { items: NoteTemplate[] }).items);
      }
    } catch (err) {
      console.error('Error fetching note templates:', err);
      setError('Failed to load note templates');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleCreateTemplate = () => {
    if (!newTemplate.name || !newTemplate.description || !newTemplate.sections?.length) {
      alert('Please fill all required fields and add at least one section');
      return;
    }

    const template: NoteTemplate = {
      templateId: `TMP-${String(templates.length + 1).padStart(3, '0')}`,
      name: newTemplate.name!,
      type: newTemplate.type!,
      category: newTemplate.category!,
      description: newTemplate.description!,
      sections: newTemplate.sections!,
      macros: newTemplate.macros || [],
      createdBy: user?.userId || 'UNKNOWN',
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      usageCount: 0,
      isActive: true,
      tags: newTemplate.tags || [],
    };

    setTemplates([...templates, template]);
    setNewTemplate({
      name: '',
      type: 'soap',
      category: 'general',
      description: '',
      sections: [],
      macros: [],
      tags: [],
      isActive: true,
    });
    setActiveTab('all');
    alert('Template created successfully!');
  };

  const handleAddSectionToTemplate = () => {
    if (!newSection.title || !newSection.content) {
      alert('Please enter section title and content');
      return;
    }

    const section: TemplateSection = {
      sectionId: `S-${String((newTemplate.sections?.length || 0) + 1).padStart(3, '0')}`,
      title: newSection.title!,
      content: newSection.content!,
      required: newSection.required || false,
      order: (newTemplate.sections?.length || 0) + 1,
    };

    setNewTemplate({
      ...newTemplate,
      sections: [...(newTemplate.sections || []), section],
    });

    setNewSection({
      title: '',
      content: '',
      required: false,
      order: 0,
    });
  };

  const handleDeleteSection = (sectionId: string) => {
    setNewTemplate({
      ...newTemplate,
      sections: (newTemplate.sections || []).filter((s) => s.sectionId !== sectionId),
    });
  };

  const handleDuplicateTemplate = (template: NoteTemplate) => {
    const duplicated: NoteTemplate = {
      ...template,
      templateId: `TMP-${String(templates.length + 1).padStart(3, '0')}`,
      name: `${template.name} (Copy)`,
      createdBy: user?.userId || 'UNKNOWN',
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      usageCount: 0,
    };

    setTemplates([...templates, duplicated]);
    alert('Template duplicated successfully!');
  };

  const handleDeleteTemplate = (templateId: string) => {
    if (confirm('Are you sure you want to delete this template?')) {
      setTemplates(templates.filter((t) => t.templateId !== templateId));
    }
  };

  const getTypeBadge = (type: TemplateType) => {
    switch (type) {
      case 'soap':
        return 'bg-blue-100 text-blue-800';
      case 'history-physical':
        return 'bg-purple-100 text-purple-800';
      case 'discharge-summary':
        return 'bg-green-100 text-green-800';
      case 'consult':
        return 'bg-orange-100 text-orange-800';
      case 'procedure':
        return 'bg-pink-100 text-pink-800';
      case 'progress-note':
        return 'bg-indigo-100 text-indigo-800';
      case 'op-note':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getCategoryBadge = (category: TemplateCategory) => {
    switch (category) {
      case 'emergency':
        return 'bg-red-100 text-red-800';
      case 'surgery':
        return 'bg-purple-100 text-purple-800';
      case 'medicine':
        return 'bg-blue-100 text-blue-800';
      case 'pediatrics':
        return 'bg-pink-100 text-pink-800';
      case 'psychiatry':
        return 'bg-indigo-100 text-indigo-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredTemplates = templates.filter((template) => {
    const matchesSearch =
      template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      template.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      template.tags.some((tag) => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesType = typeFilter === 'all' || template.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleString();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="bg-gradient-to-r from-indigo-600 to-blue-500 text-white rounded-lg shadow-lg p-6 mb-6">
        <div className="flex items-center gap-3">
          <FileCheck className="w-10 h-10" />
          <div>
            <h1 className="text-3xl font-bold">Note Templates</h1>
            <p className="text-indigo-50 mt-1">Clinical documentation templates with macros and auto-text</p>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-6 border-b border-gray-300">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'all'
              ? 'border-b-2 border-indigo-600 text-indigo-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          All Templates ({templates.length})
        </button>
        <button
          onClick={() => setActiveTab('new')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'new'
              ? 'border-b-2 border-indigo-600 text-indigo-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          New Template
        </button>
        <button
          onClick={() => setActiveTab('macros')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'macros'
              ? 'border-b-2 border-indigo-600 text-indigo-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Macros
        </button>
      </div>

      {activeTab === 'all' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Search templates</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by name, description, or tags..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Filter by type</label>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as TemplateType | 'all')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="all">All Types</option>
                  <option value="soap">SOAP Note</option>
                  <option value="history-physical">History & Physical</option>
                  <option value="discharge-summary">Discharge Summary</option>
                  <option value="consult">Consultation</option>
                  <option value="procedure">Procedure Note</option>
                  <option value="progress-note">Progress Note</option>
                  <option value="op-note">Operative Note</option>
                </select>
              </div>
            </div>
          </div>

          {filteredTemplates.length > 0 ? (
            <div className="space-y-4">
              {filteredTemplates.map((template) => (
                <div key={template.templateId} className="bg-white rounded-lg shadow p-6 border border-gray-300 hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-start gap-3">
                      <FileText className="w-6 h-6 text-indigo-600 mt-1" />
                      <div>
                        <h3 className="text-xl font-bold text-gray-900">{template.name}</h3>
                        <div className="flex gap-2 mt-2">
                          <span className={`px-2 py-1 rounded-md text-xs font-medium ${getTypeBadge(template.type)}`}>
                            {template.type.replace('-', ' ').toUpperCase()}
                          </span>
                          <span className={`px-2 py-1 rounded-md text-xs font-medium ${getCategoryBadge(template.category)}`}>
                            {template.category.toUpperCase()}
                          </span>
                          {!template.isActive && (
                            <span className="px-2 py-1 rounded-md text-xs font-medium bg-gray-200 text-gray-600">
                              INACTIVE
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDuplicateTemplate(template)}
                        className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2 text-sm"
                      >
                        <Copy className="w-4 h-4" />
                        Duplicate
                      </button>
                      <button
                        onClick={() => setSelectedTemplate(template)}
                        className="px-3 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors flex items-center gap-2 text-sm"
                      >
                        <Edit className="w-4 h-4" />
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(template.templateId)}
                        className="px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center gap-2 text-sm"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  </div>

                  <p className="text-gray-600 mb-4">{template.description}</p>

                  <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
                    <div className="flex items-center gap-1">
                      <Clipboard className="w-4 h-4" />
                      <span>{template.sections.length} sections</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <User className="w-4 h-4" />
                      <span>Created by {template.createdBy}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <FileCheck className="w-4 h-4" />
                      <span>Used {template.usageCount} times</span>
                    </div>
                  </div>

                  {template.macros.length > 0 && (
                    <div className="bg-indigo-50 border border-indigo-200 rounded p-3 mb-4">
                      <div className="font-medium text-indigo-900 text-sm mb-2">Available Macros:</div>
                      <div className="flex flex-wrap gap-2">
                        {template.macros.map((macro, idx) => (
                          <span key={idx} className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded text-xs font-mono">
                            {macro}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="border-t border-gray-200 pt-4">
                    <div className="font-medium text-gray-700 mb-3">Template Sections ({template.sections.length}):</div>
                    <div className="space-y-2">
                      {template.sections.map((section) => (
                        <div key={section.sectionId} className="bg-gray-50 rounded p-3 border border-gray-200">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-medium text-gray-900">{section.order}. {section.title}</span>
                            {section.required && (
                              <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded text-xs font-medium">
                                REQUIRED
                              </span>
                            )}
                          </div>
                          <pre className="text-sm text-gray-600 font-mono whitespace-pre-wrap">{section.content}</pre>
                        </div>
                      ))}
                    </div>
                  </div>

                  {template.tags.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-700">Tags:</span>
                        {template.tags.map((tag, idx) => (
                          <span key={idx} className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded-md text-xs">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-2 gap-4 text-sm">
                    <div className="bg-blue-50 rounded p-2">
                      <div className="flex items-center gap-1 text-blue-700">
                        <Clock className="w-4 h-4" />
                        <span className="font-medium">Created:</span>
                      </div>
                      <div className="text-blue-900 ml-5">{formatDate(template.createdAt)}</div>
                    </div>
                    <div className="bg-green-50 rounded p-2">
                      <div className="flex items-center gap-1 text-green-700">
                        <Clock className="w-4 h-4" />
                        <span className="font-medium">Last Modified:</span>
                      </div>
                      <div className="text-green-900 ml-5">{formatDate(template.lastModified)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No templates found</h3>
              <p className="text-gray-600">Try adjusting your search or create a new template.</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'new' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Create New Template</h2>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Template Name <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={newTemplate.name}
                  onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                  placeholder="e.g., Emergency Department SOAP Note"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Template Type <span className="text-red-600">*</span>
                </label>
                <select
                  value={newTemplate.type}
                  onChange={(e) => setNewTemplate({ ...newTemplate, type: e.target.value as TemplateType })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="soap">SOAP Note</option>
                  <option value="history-physical">History & Physical</option>
                  <option value="discharge-summary">Discharge Summary</option>
                  <option value="consult">Consultation</option>
                  <option value="procedure">Procedure Note</option>
                  <option value="progress-note">Progress Note</option>
                  <option value="op-note">Operative Note</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Category <span className="text-red-600">*</span>
                </label>
                <select
                  value={newTemplate.category}
                  onChange={(e) => setNewTemplate({ ...newTemplate, category: e.target.value as TemplateCategory })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="general">General</option>
                  <option value="emergency">Emergency</option>
                  <option value="surgery">Surgery</option>
                  <option value="medicine">Medicine</option>
                  <option value="pediatrics">Pediatrics</option>
                  <option value="psychiatry">Psychiatry</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Tags</label>
                <input
                  type="text"
                  value={newTemplate.tags?.join(', ')}
                  onChange={(e) => setNewTemplate({ ...newTemplate, tags: e.target.value.split(',').map(t => t.trim()) })}
                  placeholder="e.g., emergency, soap, general (comma-separated)"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description <span className="text-red-600">*</span>
              </label>
              <textarea
                value={newTemplate.description}
                onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
                placeholder="Brief description of when to use this template..."
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            <div className="border-t border-gray-200 pt-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">
                Template Sections <span className="text-red-600">*</span>
              </h3>

              {newTemplate.sections && newTemplate.sections.length > 0 && (
                <div className="space-y-2 mb-4">
                  {newTemplate.sections.map((section) => (
                    <div key={section.sectionId} className="bg-gray-50 rounded p-3 border border-gray-200">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{section.order}. {section.title}</span>
                          {section.required && (
                            <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded text-xs font-medium">
                              REQUIRED
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteSection(section.sectionId)}
                          className="text-red-600 hover:text-red-800"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <pre className="text-sm text-gray-600 font-mono whitespace-pre-wrap">{section.content}</pre>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-indigo-50 border border-indigo-200 rounded p-4">
                <h4 className="font-medium text-indigo-900 mb-3">Add Section</h4>
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Section Title</label>
                      <input
                        type="text"
                        value={newSection.title}
                        onChange={(e) => setNewSection({ ...newSection, title: e.target.value })}
                        placeholder="e.g., Chief Complaint"
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newSection.required}
                          onChange={(e) => setNewSection({ ...newSection, required: e.target.checked })}
                          className="w-4 h-4 text-indigo-600 rounded focus:ring-2 focus:ring-indigo-500"
                        />
                        <span className="text-sm font-medium text-gray-700">Required</span>
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Section Content</label>
                    <textarea
                      value={newSection.content}
                      onChange={(e) => setNewSection({ ...newSection, content: e.target.value })}
                      placeholder="Enter the template text for this section..."
                      rows={4}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono text-sm"
                    />
                  </div>
                  <button
                    onClick={handleAddSectionToTemplate}
                    className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add Section
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-gray-200">
              <button
                onClick={handleCreateTemplate}
                className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-semibold flex items-center gap-2"
              >
                <Plus className="w-5 h-5" />
                Create Template
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'macros' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Macro Library</h2>
          <p className="text-gray-600 mb-6">
            Use these macros in your templates to insert commonly used text snippets. Type the macro code in your template content.
          </p>

          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-3">Vital Signs</h3>
              <div className="space-y-3">
                <div className="bg-gray-50 rounded p-4 border border-gray-200">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded font-mono text-sm">@vitals</code>
                    <span className="text-sm text-gray-600">- Complete vital signs template</span>
                  </div>
                  <pre className="text-sm text-gray-600 font-mono whitespace-pre-wrap bg-white p-3 rounded border border-gray-200">
Vital Signs:
Temperature: ___ °F (___ °C)
Blood Pressure: ___ / ___ mmHg
Heart Rate: ___ bpm
Respiratory Rate: ___ breaths/min
Oxygen Saturation: ___ % on [RA/O2 ___L]
                  </pre>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-3">Review of Systems</h3>
              <div className="space-y-3">
                <div className="bg-gray-50 rounded p-4 border border-gray-200">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded font-mono text-sm">@ros-neg</code>
                    <span className="text-sm text-gray-600">- All negative review of systems</span>
                  </div>
                  <pre className="text-sm text-gray-600 font-mono whitespace-pre-wrap bg-white p-3 rounded border border-gray-200">
Complete review of systems negative except as noted in HPI. Specifically denies:
Constitutional: fever, chills, weight changes
HEENT: vision changes, hearing loss
Cardiovascular: chest pain, palpitations
Respiratory: shortness of breath, cough
GI: nausea, vomiting, diarrhea, abdominal pain
GU: dysuria, hematuria
Neurological: headache, dizziness, weakness
Musculoskeletal: joint pain, swelling
Skin: rash, lesions
                  </pre>
                </div>

                <div className="bg-gray-50 rounded p-4 border border-gray-200">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded font-mono text-sm">@fullros</code>
                    <span className="text-sm text-gray-600">- Detailed ROS template</span>
                  </div>
                  <pre className="text-sm text-gray-600 font-mono whitespace-pre-wrap bg-white p-3 rounded border border-gray-200">
Constitutional: [ ] fever [ ] chills [ ] weight change [ ] fatigue
HEENT: [ ] vision changes [ ] hearing loss [ ] sore throat
Cardiovascular: [ ] chest pain [ ] palpitations [ ] edema
Respiratory: [ ] shortness of breath [ ] cough [ ] wheezing
Gastrointestinal: [ ] nausea [ ] vomiting [ ] diarrhea [ ] constipation
Genitourinary: [ ] dysuria [ ] hematuria [ ] frequency
Musculoskeletal: [ ] joint pain [ ] muscle aches [ ] weakness
Neurological: [ ] headache [ ] dizziness [ ] numbness [ ] tingling
Psychiatric: [ ] depression [ ] anxiety [ ] insomnia
Skin: [ ] rash [ ] lesions [ ] itching
                  </pre>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-3">Physical Exam</h3>
              <div className="space-y-3">
                <div className="bg-gray-50 rounded p-4 border border-gray-200">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded font-mono text-sm">@pe-normal</code>
                    <span className="text-sm text-gray-600">- Normal physical exam findings</span>
                  </div>
                  <pre className="text-sm text-gray-600 font-mono whitespace-pre-wrap bg-white p-3 rounded border border-gray-200">
General: Alert and oriented x3, in no acute distress, appears stated age
HEENT: Normocephalic, atraumatic. PERRLA, EOMI. TMs clear bilaterally. Oropharynx clear.
Neck: Supple, no lymphadenopathy, no JVD
Cardiovascular: Regular rate and rhythm, no murmurs/rubs/gallops
Respiratory: Clear to auscultation bilaterally, no wheezes/rales/rhonchi
Abdomen: Soft, non-tender, non-distended, normoactive bowel sounds
Extremities: No cyanosis, clubbing, or edema. Pulses 2+ throughout.
Neurological: CN II-XII intact, strength 5/5 in all extremities, sensation intact
Skin: Warm, dry, no rash or lesions
                  </pre>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-3">Medications & Allergies</h3>
              <div className="space-y-3">
                <div className="bg-gray-50 rounded p-4 border border-gray-200">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded font-mono text-sm">@meds</code>
                    <span className="text-sm text-gray-600">- Medication list template</span>
                  </div>
                  <pre className="text-sm text-gray-600 font-mono whitespace-pre-wrap bg-white p-3 rounded border border-gray-200">
Current Medications:
1. [Drug name] [Dose] [Route] [Frequency] - [Indication]
2. [Drug name] [Dose] [Route] [Frequency] - [Indication]
                  </pre>
                </div>

                <div className="bg-gray-50 rounded p-4 border border-gray-200">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded font-mono text-sm">@allergies</code>
                    <span className="text-sm text-gray-600">- Allergy documentation</span>
                  </div>
                  <pre className="text-sm text-gray-600 font-mono whitespace-pre-wrap bg-white p-3 rounded border border-gray-200">
Allergies:
- [Drug/Substance]: [Reaction/Severity]
- NKDA (No Known Drug Allergies)
                  </pre>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-3">Labs & Diagnostics</h3>
              <div className="space-y-3">
                <div className="bg-gray-50 rounded p-4 border border-gray-200">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded font-mono text-sm">@labs</code>
                    <span className="text-sm text-gray-600">- Common lab results template</span>
                  </div>
                  <pre className="text-sm text-gray-600 font-mono whitespace-pre-wrap bg-white p-3 rounded border border-gray-200">
Laboratory Results:
CBC: WBC ___, Hgb ___, Plt ___
BMP: Na ___, K ___, Cl ___, CO2 ___, BUN ___, Cr ___, Glucose ___
LFTs: AST ___, ALT ___, Alk Phos ___, Total bili ___
                  </pre>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-3">Discharge Instructions</h3>
              <div className="space-y-3">
                <div className="bg-gray-50 rounded p-4 border border-gray-200">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded font-mono text-sm">@discharge-meds</code>
                    <span className="text-sm text-gray-600">- Discharge medication instructions</span>
                  </div>
                  <pre className="text-sm text-gray-600 font-mono whitespace-pre-wrap bg-white p-3 rounded border border-gray-200">
Discharge Medications:
1. [Drug] [Dose] [Route] [Frequency]
   - Take for: [Indication]
   - Duration: [Days/Ongoing]
   - Special instructions: [Instructions]
                  </pre>
                </div>

                <div className="bg-gray-50 rounded p-4 border border-gray-200">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded font-mono text-sm">@instructions</code>
                    <span className="text-sm text-gray-600">- General discharge instructions</span>
                  </div>
                  <pre className="text-sm text-gray-600 font-mono whitespace-pre-wrap bg-white p-3 rounded border border-gray-200">
Discharge Instructions:
Activity: [Level]
Diet: [Type]
Wound Care: [Instructions if applicable]
Medications: Take as prescribed
Return to ED if: fever greater than 101°F, worsening symptoms, new concerning symptoms
                  </pre>
                </div>

                <div className="bg-gray-50 rounded p-4 border border-gray-200">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded font-mono text-sm">@followup</code>
                    <span className="text-sm text-gray-600">- Follow-up appointment template</span>
                  </div>
                  <pre className="text-sm text-gray-600 font-mono whitespace-pre-wrap bg-white p-3 rounded border border-gray-200">
Follow-up:
- Primary Care: [Provider name] in [timeframe]
- Specialist: [Provider name/specialty] in [timeframe]
- Lab work: [Tests] in [timeframe]
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NoteTemplatesPage;