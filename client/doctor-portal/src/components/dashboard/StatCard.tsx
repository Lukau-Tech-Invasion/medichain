import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';

export interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
  loading?: boolean;
  link?: string;
  onClick?: () => void;
}

/**
 * Reusable stat card component for dashboards
 * Displays a metric with an icon, label, and value
 * Optionally links to a detail page
 */
export default function StatCard({ 
  icon, 
  label, 
  value, 
  color,
  loading = false,
  link,
  onClick,
}: StatCardProps) {
  const content = (
    <div className="bg-white rounded-xl shadow p-6 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${color}`}>
          {icon}
        </div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          {loading ? (
            <Loader2 className="animate-spin text-gray-400" size={24} />
          ) : (
            <p className="text-2xl font-bold text-gray-900">{value}</p>
          )}
        </div>
      </div>
    </div>
  );

  if (link) {
    return (
      <Link to={link} className="block">
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button onClick={onClick} className="block w-full text-left">
        {content}
      </button>
    );
  }

  return content;
}
