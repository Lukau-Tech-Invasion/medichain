import { Link } from 'react-router-dom';
import { LucideIcon, ArrowRight } from 'lucide-react';

export interface QuickAction {
  id: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  href: string;
  color: 'primary' | 'emergency' | 'amber' | 'green' | 'purple' | 'blue' | 'teal' | 'pink';
  gradient?: boolean;
}

interface QuickActionsPanelProps {
  actions: QuickAction[];
  title?: string;
  columns?: 1 | 2 | 3 | 4;
}

const colorClasses = {
  primary: {
    bg: 'bg-gradient-to-r from-primary-500 to-primary-600',
    hover: 'hover:from-primary-600 hover:to-primary-700',
    text: 'text-primary-100',
  },
  emergency: {
    bg: 'bg-gradient-to-r from-emergency-500 to-emergency-600',
    hover: 'hover:from-emergency-600 hover:to-emergency-700',
    text: 'text-emergency-100',
  },
  amber: {
    bg: 'bg-gradient-to-r from-amber-500 to-orange-500',
    hover: 'hover:from-amber-600 hover:to-orange-600',
    text: 'text-amber-100',
  },
  green: {
    bg: 'bg-gradient-to-r from-green-500 to-emerald-500',
    hover: 'hover:from-green-600 hover:to-emerald-600',
    text: 'text-green-100',
  },
  purple: {
    bg: 'bg-gradient-to-r from-purple-500 to-violet-500',
    hover: 'hover:from-purple-600 hover:to-violet-600',
    text: 'text-purple-100',
  },
  blue: {
    bg: 'bg-gradient-to-r from-blue-500 to-indigo-500',
    hover: 'hover:from-blue-600 hover:to-indigo-600',
    text: 'text-blue-100',
  },
  teal: {
    bg: 'bg-gradient-to-r from-teal-500 to-cyan-500',
    hover: 'hover:from-teal-600 hover:to-cyan-600',
    text: 'text-teal-100',
  },
  pink: {
    bg: 'bg-gradient-to-r from-pink-500 to-rose-500',
    hover: 'hover:from-pink-600 hover:to-rose-600',
    text: 'text-pink-100',
  },
};

/**
 * Quick actions panel for dashboards
 * Displays shortcuts to common tasks with gradient styling
 */
export default function QuickActionsPanel({
  actions,
  title,
  columns = 3,
}: QuickActionsPanelProps) {
  const gridCols = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
  };

  return (
    <div className="mb-8">
      {title && (
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{title}</h2>
      )}
      <div className={`grid ${gridCols[columns]} gap-4`}>
        {actions.map((action) => {
          const Icon = action.icon;
          const colors = colorClasses[action.color];
          
          return (
            <Link
              key={action.id}
              to={action.href}
              className={`${colors.bg} ${colors.hover} rounded-xl p-6 text-white transition-all group`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Icon size={24} />
                  <div>
                    <h3 className="text-lg font-semibold">{action.label}</h3>
                    {action.description && (
                      <p className={`${colors.text} text-sm`}>
                        {action.description}
                      </p>
                    )}
                  </div>
                </div>
                <ArrowRight className="group-hover:translate-x-1 transition-transform" size={24} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
