// components/collab/ui.tsx
// Shared presentational primitives for the collaboration workspace.
// Light "paper" surface, restrained styling, accessible contrast.

import React, { useCallback, useEffect, useState } from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cx('rounded-xl border border-stone-200 bg-white shadow-sm', className)}>
      {children}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cx('p-4 sm:p-5', className)}>{children}</div>;
}

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={cx('text-sm font-semibold uppercase tracking-wide text-slate-700', className)}>
      {children}
    </h3>
  );
}

type Tone = 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'teal';

const toneClasses: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-800 border-slate-300',
  green: 'bg-green-50 text-green-900 border-green-300',
  amber: 'bg-amber-50 text-amber-900 border-amber-300',
  red: 'bg-red-50 text-red-900 border-red-300',
  blue: 'bg-blue-50 text-blue-900 border-blue-300',
  purple: 'bg-purple-50 text-purple-900 border-purple-300',
  teal: 'bg-teal-50 text-teal-900 border-teal-300',
};

export function Badge({
  tone = 'slate',
  children,
  title,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium leading-5',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-6 text-slate-700">
      <span
        aria-hidden
        className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700"
      />
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center">
      <p className="text-base font-semibold text-slate-900">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">{hint}</p>}
      {children && <div className="mt-4 flex justify-center gap-2">{children}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red-300 bg-red-50 p-6 text-center">
      <p className="text-sm font-semibold text-red-900">Something went wrong</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-red-800">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg border border-red-400 bg-white px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-100"
        >
          Retry
        </button>
      )}
    </div>
  );
}

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'subtle';

const btnVariants: Record<BtnVariant, string> = {
  primary: 'bg-slate-900 text-white hover:bg-slate-700 border-slate-900',
  ghost: 'bg-white text-slate-900 border-stone-300 hover:bg-stone-100',
  danger: 'bg-white text-red-800 border-red-300 hover:bg-red-50',
  subtle: 'bg-stone-100 text-slate-800 border-stone-200 hover:bg-stone-200',
};

export function Btn({
  variant = 'ghost',
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        btnVariants[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-700">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-600">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, 'min-h-[5rem]', props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, props.className)} />;
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={cx('max-h-[90vh] w-full overflow-y-auto rounded-xl bg-white shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg px-2 py-1 text-xl leading-none text-slate-600 hover:bg-stone-100 hover:text-slate-900"
          >
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-stone-200"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
      >
        <div className="h-full rounded-full bg-slate-800 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-600">
        {value} of {max} ({pct}%){label ? ` — ${label}` : ''}
      </p>
    </div>
  );
}

/** Small data-fetching hook: { data, loading, error, reload }. */
export function useCollab<T>(fn: () => Promise<T>, deps: React.DependencyList): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Request failed');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, error, reload };
}

export function fmtDate(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function fmtDue(iso: string | undefined): string {
  if (!iso) return 'No due date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const overdue = d.getTime() < now.setHours(0, 0, 0, 0);
  const label = d.toLocaleDateString();
  return overdue ? `${label} (overdue)` : label;
}
