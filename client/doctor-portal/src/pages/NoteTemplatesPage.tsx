import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';
import { getNoteTemplates, useTranslation } from '@medichain/shared';
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
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { showSuccess, showWarning } = useToastActions();
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
      setError(t('docNoteTemplates.errorLoad'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleCreateTemplate = () => {
    if (!newTemplate.name || !newTemplate.description || !newTemplate.sections?.length) {
      showWarning(t('docNoteTemplates.warningCreateFields'));
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
    showSuccess(t('docNoteTemplates.createdSuccess'));
  };

  const handleAddSectionToTemplate = () => {
    if (!newSection.title || !newSection.content) {
      showWarning(t('docNoteTemplates.warningSectionFields'));
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
      name: `${template.name}${t('docNoteTemplates.copySuffix')}`,
      createdBy: user?.userId || 'UNKNOWN',
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      usageCount: 0,
    };

    setTemplates([...templates, duplicated]);
    showSuccess(t('docNoteTemplates.duplicatedSuccess'));
  };

  const handleDeleteTemplate = (templateId: string) => {
    if (confirm(t('docNoteTemplates.confirmDelete'))) {
      setTemplates(templates.filter((t) => t.templateId !== templateId));
    }
  };

  const getTypeBadge = (type: TemplateType) => {
    switch (type) {
      case 'soap':
        return 'bg-notice-subtle text-notice-subtle-fg';
      case 'history-physical':
        return 'bg-surface-sunken text-content-secondary';
      case 'discharge-summary':
        return 'bg-ok-subtle text-ok-subtle-fg';
      case 'consult':
        return 'bg-surface-sunken text-content-secondary';
      case 'procedure':
        return 'bg-surface-sunken text-content-secondary';
      case 'progress-note':
        return 'bg-surface-sunken text-content-secondary';
      case 'op-note':
        return 'bg-critical-subtle text-critical-subtle-fg';
      default:
        return 'bg-surface-sunken text-content-secondary';
    }
  };

  const getCategoryBadge = (category: TemplateCategory) => {
    switch (category) {
      case 'emergency':
        return 'bg-critical-subtle text-critical-subtle-fg';
      case 'surgery':
        return 'bg-surface-sunken text-content-secondary';
      case 'medicine':
        return 'bg-notice-subtle text-notice-subtle-fg';
      case 'pediatrics':
        return 'bg-surface-sunken text-content-secondary';
      case 'psychiatry':
        return 'bg-surface-sunken text-content-secondary';
      default:
        return 'bg-surface-sunken text-content-secondary';
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
            <h1 className="text-3xl font-bold">{t('docNoteTemplates.title')}</h1>
            <p className="text-indigo-50 mt-1">{t('docNoteTemplates.subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-6 border-b border-border-strong">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'all'
              ? 'border-b-2 border-indigo-600 text-content-secondary'
              : 'text-content-muted hover:text-content'
          }`}
        >
          {t('docNoteTemplates.tabAllTemplates', { count: templates.length })}
        </button>
        <button
          onClick={() => setActiveTab('new')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'new'
              ? 'border-b-2 border-indigo-600 text-content-secondary'
              : 'text-content-muted hover:text-content'
          }`}
        >
          {t('docNoteTemplates.tabNewTemplate')}
        </button>
        <button
          onClick={() => setActiveTab('macros')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'macros'
              ? 'border-b-2 border-indigo-600 text-content-secondary'
              : 'text-content-muted hover:text-content'
          }`}
        >
          {t('docNoteTemplates.tabMacros')}
        </button>
      </div>

      {activeTab === 'all' && (
        <div className="space-y-6">
          <div className="bg-surface rounded-lg shadow p-6">
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="col-span-2">
                <label htmlFor="notetmpl-search" className="block text-sm font-medium text-content-secondary mb-2">{t('docNoteTemplates.searchTemplatesLabel')}</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-content-muted w-5 h-5" />
                  <input
                    id="notetmpl-search"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={t('docNoteTemplates.searchTemplatesPh')}
                    className="w-full pl-10 pr-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="notetmpl-filter-type" className="block text-sm font-medium text-content-secondary mb-2">{t('docNoteTemplates.filterByTypeLabel')}</label>
                <select
                  id="notetmpl-filter-type"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as TemplateType | 'all')}
                  className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="all">{t('docNoteTemplates.allTypes')}</option>
                  <option value="soap">{t('docNoteTemplates.type_soap')}</option>
                  <option value="history-physical">{t('docNoteTemplates.type_history-physical')}</option>
                  <option value="discharge-summary">{t('docNoteTemplates.type_discharge-summary')}</option>
                  <option value="consult">{t('docNoteTemplates.type_consult')}</option>
                  <option value="procedure">{t('docNoteTemplates.type_procedure')}</option>
                  <option value="progress-note">{t('docNoteTemplates.type_progress-note')}</option>
                  <option value="op-note">{t('docNoteTemplates.type_op-note')}</option>
                </select>
              </div>
            </div>
          </div>

          {filteredTemplates.length > 0 ? (
            <div className="space-y-4">
              {filteredTemplates.map((template, index) => (
                <div key={`${template.templateId}-${index}`} className="bg-surface rounded-lg shadow p-6 border border-border-strong hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-start gap-3">
                      <FileText className="w-6 h-6 text-content-secondary mt-1" />
                      <div>
                        <h3 className="text-xl font-bold text-content">{template.name}</h3>
                        <div className="flex gap-2 mt-2">
                          <span className={`px-2 py-1 rounded-md text-xs font-medium ${getTypeBadge(template.type)}`}>
                            {t(`docNoteTemplates.type_${template.type}`).toUpperCase()}
                          </span>
                          <span className={`px-2 py-1 rounded-md text-xs font-medium ${getCategoryBadge(template.category)}`}>
                            {t(`docNoteTemplates.category_${template.category}`).toUpperCase()}
                          </span>
                          {!template.isActive && (
                            <span className="px-2 py-1 rounded-md text-xs font-medium bg-surface-sunken text-content-muted">
                              {t('docNoteTemplates.inactiveBadge')}
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
                        {t('docNoteTemplates.duplicateButton')}
                      </button>
                      <button
                        onClick={() => setSelectedTemplate(template)}
                        className="px-3 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors flex items-center gap-2 text-sm"
                      >
                        <Edit className="w-4 h-4" />
                        {t('docNoteTemplates.editButton')}
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(template.templateId)}
                        className="px-3 py-2 bg-red-500 text-critical-fg rounded-lg hover:bg-critical transition-colors flex items-center gap-2 text-sm"
                      >
                        <Trash2 className="w-4 h-4" />
                        {t('docNoteTemplates.deleteButton')}
                      </button>
                    </div>
                  </div>

                  <p className="text-content-muted mb-4">{template.description}</p>

                  <div className="flex items-center gap-4 text-sm text-content-muted mb-4">
                    <div className="flex items-center gap-1">
                      <Clipboard className="w-4 h-4" />
                      <span>{t('docNoteTemplates.sectionsCount', { count: template.sections.length })}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <User className="w-4 h-4" />
                      <span>{t('docNoteTemplates.createdByLine', { name: template.createdBy })}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <FileCheck className="w-4 h-4" />
                      <span>{t('docNoteTemplates.usedTimesLine', { count: template.usageCount })}</span>
                    </div>
                  </div>

                  {template.macros.length > 0 && (
                    <div className="bg-surface-sunken border border-indigo-200 rounded p-3 mb-4">
                      <div className="font-medium text-content-secondary text-sm mb-2">{t('docNoteTemplates.availableMacrosLabel')}</div>
                      <div className="flex flex-wrap gap-2">
                        {template.macros.map((macro, idx) => (
                          <span key={idx} className="px-2 py-1 bg-surface-sunken text-content-secondary rounded text-xs font-mono">
                            {macro}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="border-t border-border pt-4">
                    <div className="font-medium text-content-secondary mb-3">{t('docNoteTemplates.templateSectionsCount', { count: template.sections.length })}</div>
                    <div className="space-y-2">
                      {template.sections.map((section, index) => (
                        <div key={`${section.sectionId ?? 'section'}-${index}`} className="bg-surface-sunken rounded p-3 border border-border">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-medium text-content">{section.order}. {section.title}</span>
                            {section.required && (
                              <span className="px-2 py-0.5 bg-critical-subtle text-critical-subtle-fg rounded text-xs font-medium">
                                {t('docNoteTemplates.requiredBadge')}
                              </span>
                            )}
                          </div>
                          <pre className="text-sm text-content-muted font-mono whitespace-pre-wrap">{section.content}</pre>
                        </div>
                      ))}
                    </div>
                  </div>

                  {template.tags.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-border">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-content-secondary">{t('docNoteTemplates.tagsLabel')}</span>
                        {template.tags.map((tag, idx) => (
                          <span key={idx} className="px-2 py-1 bg-surface-sunken text-content-secondary rounded-md text-xs">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 gap-4 text-sm">
                    <div className="bg-notice-subtle rounded p-2">
                      <div className="flex items-center gap-1 text-notice-subtle-fg">
                        <Clock className="w-4 h-4" />
                        <span className="font-medium">{t('docNoteTemplates.createdLabel')}</span>
                      </div>
                      <div className="text-notice-subtle-fg ml-5">{formatDate(template.createdAt)}</div>
                    </div>
                    <div className="bg-ok-subtle rounded p-2">
                      <div className="flex items-center gap-1 text-ok-subtle-fg">
                        <Clock className="w-4 h-4" />
                        <span className="font-medium">{t('docNoteTemplates.lastModifiedLabel')}</span>
                      </div>
                      <div className="text-ok-subtle-fg ml-5">{formatDate(template.lastModified)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-surface rounded-lg shadow p-12 text-center">
              <FileText className="w-16 h-16 text-content-muted mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-content mb-2">{t('docNoteTemplates.noTemplatesFoundHeading')}</h3>
              <p className="text-content-muted">{t('docNoteTemplates.noTemplatesFoundMessage')}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'new' && (
        <div className="bg-surface rounded-lg shadow p-6">
          <h2 className="text-2xl font-bold text-content mb-6">{t('docNoteTemplates.createNewTemplateHeading')}</h2>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="notetmpl-name" className="block text-sm font-medium text-content-secondary mb-2">
                  {t('docNoteTemplates.templateNameRequired')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <input
                  id="notetmpl-name"
                  type="text"
                  value={newTemplate.name}
                  onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                  placeholder={t('docNoteTemplates.templateNamePh')}
                  className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="notetmpl-type" className="block text-sm font-medium text-content-secondary mb-2">
                  {t('docNoteTemplates.templateTypeRequired')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <select
                  id="notetmpl-type"
                  value={newTemplate.type}
                  onChange={(e) => setNewTemplate({ ...newTemplate, type: e.target.value as TemplateType })}
                  className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="soap">{t('docNoteTemplates.type_soap')}</option>
                  <option value="history-physical">{t('docNoteTemplates.type_history-physical')}</option>
                  <option value="discharge-summary">{t('docNoteTemplates.type_discharge-summary')}</option>
                  <option value="consult">{t('docNoteTemplates.type_consult')}</option>
                  <option value="procedure">{t('docNoteTemplates.type_procedure')}</option>
                  <option value="progress-note">{t('docNoteTemplates.type_progress-note')}</option>
                  <option value="op-note">{t('docNoteTemplates.type_op-note')}</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="notetmpl-category" className="block text-sm font-medium text-content-secondary mb-2">
                  {t('docNoteTemplates.categoryRequired')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <select
                  id="notetmpl-category"
                  value={newTemplate.category}
                  onChange={(e) => setNewTemplate({ ...newTemplate, category: e.target.value as TemplateCategory })}
                  className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="general">{t('docNoteTemplates.category_general')}</option>
                  <option value="emergency">{t('docNoteTemplates.category_emergency')}</option>
                  <option value="surgery">{t('docNoteTemplates.category_surgery')}</option>
                  <option value="medicine">{t('docNoteTemplates.category_medicine')}</option>
                  <option value="pediatrics">{t('docNoteTemplates.category_pediatrics')}</option>
                  <option value="psychiatry">{t('docNoteTemplates.category_psychiatry')}</option>
                </select>
              </div>
              <div>
                <label htmlFor="notetmpl-tags" className="block text-sm font-medium text-content-secondary mb-2">{t('docNoteTemplates.tagsFieldLabel')}</label>
                <input
                  id="notetmpl-tags"
                  type="text"
                  value={newTemplate.tags?.join(', ')}
                  onChange={(e) => setNewTemplate({ ...newTemplate, tags: e.target.value.split(',').map(t => t.trim()) })}
                  placeholder={t('docNoteTemplates.tagsFieldPh')}
                  className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label htmlFor="notetmpl-description" className="block text-sm font-medium text-content-secondary mb-2">
                {t('docNoteTemplates.descriptionRequired')} <span className="text-critical-subtle-fg">*</span>
              </label>
              <textarea
                id="notetmpl-description"
                value={newTemplate.description}
                onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
                placeholder={t('docNoteTemplates.descriptionPh')}
                rows={3}
                className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            <div className="border-t border-border pt-6">
              <h3 className="text-lg font-bold text-content mb-4">
                {t('docNoteTemplates.templateSectionsRequired')} <span className="text-critical-subtle-fg">*</span>
              </h3>

              {newTemplate.sections && newTemplate.sections.length > 0 && (
                <div className="space-y-2 mb-4">
                  {newTemplate.sections.map((section) => (
                    <div key={section.sectionId} className="bg-surface-sunken rounded p-3 border border-border">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-content">{section.order}. {section.title}</span>
                          {section.required && (
                            <span className="px-2 py-0.5 bg-critical-subtle text-critical-subtle-fg rounded text-xs font-medium">
                              {t('docNoteTemplates.requiredBadge')}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteSection(section.sectionId)}
                          className="text-critical-subtle-fg hover:text-critical-subtle-fg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <pre className="text-sm text-content-muted font-mono whitespace-pre-wrap">{section.content}</pre>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-surface-sunken border border-indigo-200 rounded p-4">
                <h4 className="font-medium text-content-secondary mb-3">{t('docNoteTemplates.addSectionHeading')}</h4>
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label htmlFor="notetmpl-section-title" className="block text-sm font-medium text-content-secondary mb-1">{t('docNoteTemplates.sectionTitleLabel')}</label>
                      <input
                        id="notetmpl-section-title"
                        type="text"
                        value={newSection.title}
                        onChange={(e) => setNewSection({ ...newSection, title: e.target.value })}
                        placeholder={t('docNoteTemplates.sectionTitlePh')}
                        className="w-full px-3 py-2 border border-border-strong rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                    </div>
                    <div className="flex items-end">
                      <label htmlFor="notetmpl-section-required" className="flex items-center gap-2 cursor-pointer">
                        <input
                          id="notetmpl-section-required"
                          type="checkbox"
                          checked={newSection.required}
                          onChange={(e) => setNewSection({ ...newSection, required: e.target.checked })}
                          className="w-4 h-4 text-content-secondary rounded focus:ring-2 focus:ring-indigo-500"
                        />
                        <span className="text-sm font-medium text-content-secondary">{t('docNoteTemplates.requiredCheckbox')}</span>
                      </label>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="notetmpl-section-content" className="block text-sm font-medium text-content-secondary mb-1">{t('docNoteTemplates.sectionContentLabel')}</label>
                    <textarea
                      id="notetmpl-section-content"
                      value={newSection.content}
                      onChange={(e) => setNewSection({ ...newSection, content: e.target.value })}
                      placeholder={t('docNoteTemplates.sectionContentPh')}
                      rows={4}
                      className="w-full px-3 py-2 border border-border-strong rounded focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono text-sm"
                    />
                  </div>
                  <button
                    onClick={handleAddSectionToTemplate}
                    className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    {t('docNoteTemplates.addSectionButton')}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-border">
              <button
                onClick={handleCreateTemplate}
                className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-semibold flex items-center gap-2"
              >
                <Plus className="w-5 h-5" />
                {t('docNoteTemplates.createTemplateButton')}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'macros' && (
        <div className="bg-surface rounded-lg shadow p-6">
          <h2 className="text-2xl font-bold text-content mb-4">{t('docNoteTemplates.macroLibraryHeading')}</h2>
          <p className="text-content-muted mb-6">
            {t('docNoteTemplates.macroLibraryIntro')}
          </p>

          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-bold text-content mb-3">{t('docNoteTemplates.vitalSignsHeading')}</h3>
              <div className="space-y-3">
                <div className="bg-surface-sunken rounded p-4 border border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-surface-sunken text-content-secondary rounded font-mono text-sm">@vitals</code>
                    <span className="text-sm text-content-muted">- {t('docNoteTemplates.macroDesc_vitals')}</span>
                  </div>
                  <pre className="text-sm text-content-muted font-mono whitespace-pre-wrap bg-surface p-3 rounded border border-border">
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
              <h3 className="text-lg font-bold text-content mb-3">{t('docNoteTemplates.reviewOfSystemsHeading')}</h3>
              <div className="space-y-3">
                <div className="bg-surface-sunken rounded p-4 border border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-surface-sunken text-content-secondary rounded font-mono text-sm">@ros-neg</code>
                    <span className="text-sm text-content-muted">- {t('docNoteTemplates.macroDesc_rosNeg')}</span>
                  </div>
                  <pre className="text-sm text-content-muted font-mono whitespace-pre-wrap bg-surface p-3 rounded border border-border">
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

                <div className="bg-surface-sunken rounded p-4 border border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-surface-sunken text-content-secondary rounded font-mono text-sm">@fullros</code>
                    <span className="text-sm text-content-muted">- {t('docNoteTemplates.macroDesc_fullRos')}</span>
                  </div>
                  <pre className="text-sm text-content-muted font-mono whitespace-pre-wrap bg-surface p-3 rounded border border-border">
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
              <h3 className="text-lg font-bold text-content mb-3">{t('docNoteTemplates.physicalExamHeading')}</h3>
              <div className="space-y-3">
                <div className="bg-surface-sunken rounded p-4 border border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-surface-sunken text-content-secondary rounded font-mono text-sm">@pe-normal</code>
                    <span className="text-sm text-content-muted">- {t('docNoteTemplates.macroDesc_peNormal')}</span>
                  </div>
                  <pre className="text-sm text-content-muted font-mono whitespace-pre-wrap bg-surface p-3 rounded border border-border">
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
              <h3 className="text-lg font-bold text-content mb-3">{t('docNoteTemplates.medsAllergiesHeading')}</h3>
              <div className="space-y-3">
                <div className="bg-surface-sunken rounded p-4 border border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-surface-sunken text-content-secondary rounded font-mono text-sm">@meds</code>
                    <span className="text-sm text-content-muted">- {t('docNoteTemplates.macroDesc_meds')}</span>
                  </div>
                  <pre className="text-sm text-content-muted font-mono whitespace-pre-wrap bg-surface p-3 rounded border border-border">
Current Medications:
1. [Drug name] [Dose] [Route] [Frequency] - [Indication]
2. [Drug name] [Dose] [Route] [Frequency] - [Indication]
                  </pre>
                </div>

                <div className="bg-surface-sunken rounded p-4 border border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-surface-sunken text-content-secondary rounded font-mono text-sm">@allergies</code>
                    <span className="text-sm text-content-muted">- {t('docNoteTemplates.macroDesc_allergies')}</span>
                  </div>
                  <pre className="text-sm text-content-muted font-mono whitespace-pre-wrap bg-surface p-3 rounded border border-border">
Allergies:
- [Drug/Substance]: [Reaction/Severity]
- NKDA (No Known Drug Allergies)
                  </pre>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-bold text-content mb-3">{t('docNoteTemplates.labsDiagnosticsHeading')}</h3>
              <div className="space-y-3">
                <div className="bg-surface-sunken rounded p-4 border border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-surface-sunken text-content-secondary rounded font-mono text-sm">@labs</code>
                    <span className="text-sm text-content-muted">- {t('docNoteTemplates.macroDesc_labs')}</span>
                  </div>
                  <pre className="text-sm text-content-muted font-mono whitespace-pre-wrap bg-surface p-3 rounded border border-border">
Laboratory Results:
CBC: WBC ___, Hgb ___, Plt ___
BMP: Na ___, K ___, Cl ___, CO2 ___, BUN ___, Cr ___, Glucose ___
LFTs: AST ___, ALT ___, Alk Phos ___, Total bili ___
                  </pre>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-bold text-content mb-3">{t('docNoteTemplates.dischargeInstructionsHeading')}</h3>
              <div className="space-y-3">
                <div className="bg-surface-sunken rounded p-4 border border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-surface-sunken text-content-secondary rounded font-mono text-sm">@discharge-meds</code>
                    <span className="text-sm text-content-muted">- {t('docNoteTemplates.macroDesc_dischargeMeds')}</span>
                  </div>
                  <pre className="text-sm text-content-muted font-mono whitespace-pre-wrap bg-surface p-3 rounded border border-border">
Discharge Medications:
1. [Drug] [Dose] [Route] [Frequency]
   - Take for: [Indication]
   - Duration: [Days/Ongoing]
   - Special instructions: [Instructions]
                  </pre>
                </div>

                <div className="bg-surface-sunken rounded p-4 border border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-surface-sunken text-content-secondary rounded font-mono text-sm">@instructions</code>
                    <span className="text-sm text-content-muted">- {t('docNoteTemplates.macroDesc_instructions')}</span>
                  </div>
                  <pre className="text-sm text-content-muted font-mono whitespace-pre-wrap bg-surface p-3 rounded border border-border">
Discharge Instructions:
Activity: [Level]
Diet: [Type]
Wound Care: [Instructions if applicable]
Medications: Take as prescribed
Return to ED if: fever greater than 101°F, worsening symptoms, new concerning symptoms
                  </pre>
                </div>

                <div className="bg-surface-sunken rounded p-4 border border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="px-2 py-1 bg-surface-sunken text-content-secondary rounded font-mono text-sm">@followup</code>
                    <span className="text-sm text-content-muted">- {t('docNoteTemplates.macroDesc_followup')}</span>
                  </div>
                  <pre className="text-sm text-content-muted font-mono whitespace-pre-wrap bg-surface p-3 rounded border border-border">
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
