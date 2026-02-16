import { Link } from 'react-router-dom';
import { ArrowRight, Loader2 } from 'lucide-react';

export interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (value: T[keyof T], row: T) => React.ReactNode;
  className?: string;
}

interface DataTablePanelProps<T> {
  title: string;
  icon?: React.ReactNode;
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  maxRows?: number;
  viewAllLink?: string;
  viewAllLabel?: string;
  emptyIcon?: React.ReactNode;
  emptyMessage?: string;
  rowKey: keyof T;
  onRowClick?: (row: T) => void;
  headerColor?: 'default' | 'red' | 'amber' | 'green' | 'blue' | 'purple';
}

const headerColors = {
  default: 'bg-white border-gray-200',
  red: 'bg-red-50 border-red-200',
  amber: 'bg-amber-50 border-amber-200',
  green: 'bg-green-50 border-green-200',
  blue: 'bg-blue-50 border-blue-200',
  purple: 'bg-purple-50 border-purple-200',
};

const headerTextColors = {
  default: 'text-gray-900',
  red: 'text-red-800',
  amber: 'text-amber-800',
  green: 'text-green-800',
  blue: 'text-blue-800',
  purple: 'text-purple-800',
};

/**
 * Data table panel for dashboards
 * Displays tabular data with optional row actions
 */
export default function DataTablePanel<T extends Record<string, unknown>>({
  title,
  icon,
  columns,
  data,
  loading = false,
  maxRows = 5,
  viewAllLink,
  viewAllLabel = 'View all',
  emptyIcon,
  emptyMessage = 'No data available',
  rowKey,
  onRowClick,
  headerColor = 'default',
}: DataTablePanelProps<T>) {
  const displayedData = data.slice(0, maxRows);
  const remainingCount = data.length - maxRows;

  const getValue = (row: T, key: string): unknown => {
    if (key.includes('.')) {
      return key.split('.').reduce((obj: unknown, k: string) => {
        if (obj && typeof obj === 'object' && k in obj) {
          return (obj as Record<string, unknown>)[k];
        }
        return undefined;
      }, row);
    }
    return row[key as keyof T];
  };

  return (
    <div className={`rounded-xl border overflow-hidden ${headerColors[headerColor]}`}>
      {/* Header */}
      <div className={`p-4 border-b ${headerColors[headerColor]} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          {icon}
          <h3 className={`font-semibold ${headerTextColors[headerColor]}`}>{title}</h3>
          {!loading && data.length > 0 && (
            <span className={`${headerColor === 'default' ? 'bg-gray-100 text-gray-600' : `bg-${headerColor}-100 text-${headerColor}-700`} text-xs px-2 py-0.5 rounded-full`}>
              {data.length}
            </span>
          )}
        </div>
        {viewAllLink && (
          <Link 
            to={viewAllLink}
            className="text-primary-600 hover:text-primary-700 text-sm flex items-center gap-1"
          >
            {viewAllLabel} <ArrowRight size={14} />
          </Link>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="p-8 text-center bg-white">
          <Loader2 className="mx-auto mb-3 text-gray-300 animate-spin" size={48} />
          <p className="text-gray-500">Loading...</p>
        </div>
      ) : displayedData.length > 0 ? (
        <div className="bg-white overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {columns.map((column) => (
                  <th 
                    key={String(column.key)}
                    className={`px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${column.className || ''}`}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayedData.map((row) => (
                <tr 
                  key={String(row[rowKey])}
                  className={`hover:bg-gray-50 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((column) => {
                    const value = getValue(row, String(column.key));
                    return (
                      <td 
                        key={String(column.key)}
                        className={`px-4 py-3 text-sm ${column.className || ''}`}
                      >
                        {column.render 
                          ? column.render(value as T[keyof T], row) 
                          : String(value ?? '-')}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-8 text-center text-gray-500 bg-white">
          {emptyIcon}
          <p className="mt-2">{emptyMessage}</p>
        </div>
      )}

      {/* Footer */}
      {!loading && remainingCount > 0 && viewAllLink && (
        <div className="p-3 bg-gray-50 text-center border-t border-gray-200">
          <Link 
            to={viewAllLink}
            className="text-primary-600 hover:text-primary-700 text-sm"
          >
            + {remainingCount} more →
          </Link>
        </div>
      )}
    </div>
  );
}
