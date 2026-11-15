import { formatTimestamp } from '@medichain/shared';
import StaffName from './StaffName';

/** Render stored clinical values as text; never interpret note content as markup. */
export function StoredValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value == null || value === '') return <span>Not recorded</span>;
  if (depth > 5) return <span>Additional detail unavailable</span>;
  if (value instanceof Date) return <span>{formatTimestamp(value) || 'Not recorded'}</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if (typeof value !== 'object') return <span className="whitespace-pre-wrap">{String(value)}</span>;
  if (Array.isArray(value)) return value.length
    ? <ul className="space-y-2">{value.map((item, index) => <li key={index}><StoredValue value={item} depth={depth + 1} /></li>)}</ul>
    : <span>None recorded</span>;
  if (Object.keys(value).length === 0) return <span>Not recorded</span>;
  return <dl className="space-y-2">{Object.entries(value).map(([key, item]) => (
    <div key={key}><dt className="font-medium capitalize">{key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')}</dt>
      <dd className="pl-3"><StoredValue value={item} depth={depth + 1} /></dd></div>
  ))}</dl>;
}

/** Show the selected chart's existing SOAP record and append-only corrections. */
export function StoredSoapDetails({ note }: { note: Record<string, unknown> }) {
  const addenda = Array.isArray(note.addenda) ? note.addenda : [];
  return <details className="mt-3 rounded-lg border border-border-interactive p-3 text-sm text-content">
    <summary className="cursor-pointer font-medium">Read saved note and addenda</summary>
    <div className="mt-3 space-y-4">
      {['subjective', 'objective', 'assessment', 'plan'].map(section => (
        <section key={section}><h3 className="font-semibold capitalize">{section}</h3>
          <StoredValue value={note[section]} /></section>
      ))}
      <section><h3 className="font-semibold">Addenda ({addenda.length})</h3>
        {addenda.length === 0 ? <p>None recorded</p> : addenda.map((entry, index) => {
          const addendum = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
          const time = typeof addendum.created_at === 'number' ? formatTimestamp(addendum.created_at * 1000) : 'Not recorded';
          return <div key={index} className="mt-2 border-t border-border-interactive pt-2">
            <p className="whitespace-pre-wrap">{typeof addendum.content === 'string' ? addendum.content : 'Not recorded'}</p>
            <p className="text-xs text-content-muted">Author: {typeof addendum.author_id === 'string' ? <StaffName id={addendum.author_id} fallback={addendum.author_id} /> : 'Not recorded'} • {time}</p>
          </div>;
        })}
      </section>
    </div>
  </details>;
}
