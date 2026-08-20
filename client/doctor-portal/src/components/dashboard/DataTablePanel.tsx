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
  default: 'bg-surface border-border',
  red: 'bg-critical-subtle border-critical',
  amber: 'bg-caution-subtle border-caution',
  green: 'bg-ok-subtle border-ok',
  blue: 'bg-notice-subtle border-notice',
  purple: 'bg-purple-50 border-purple-200',
};

const headerTextColors = {
  default: 'text-content',
  red: 'text-critical-subtle-fg',
  amber: 'text-caution-subtle-fg',
  green: 'text-ok-subtle-fg',
  blue: 'text-notice-subtle-fg',
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
            <span className={`${headerColor === 'default' ? 'bg-surface-sunken text-content-muted' : `bg-${headerColor}-100 text-${headerColor}-700`} text-xs px-2 py-0.5 rounded-full`}>
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
        <div className="p-8 text-center bg-surface">
          <Loader2 className="mx-auto mb-3 text-gray-300 animate-spin" size={48} />
          <p className="text-content-muted">Loading...</p>
        </div>
      ) : displayedData.length > 0 ? (
        <div className="bg-surface overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-surface-sunken">
              <tr>
                {columns.map((column) => (
                  <th 
                    key={String(column.key)}
                    className={`px-4 py-3 text-left text-xs font-medium text-content-muted uppercase tracking-wider ${column.className || ''}`}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {displayedData.map((row) => (
                <tr 
                  key={String(row[rowKey])}
                  className={`hover:bg-surface-sunken transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
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
        <div className="p-8 text-center text-content-muted bg-surface">
          {emptyIcon}
          <p className="mt-2">{emptyMessage}</p>
        </div>
      )}

      {/* Footer */}
      {!loading && remainingCount > 0 && viewAllLink && (
        <div className="p-3 bg-surface-sunken text-center border-t border-border">
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
