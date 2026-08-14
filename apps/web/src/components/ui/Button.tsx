import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'brand' | 'secondary' | 'ghost' | 'danger';
const variantClass: Record<Variant, string> = {
  brand: 'btn-brand', secondary: 'btn-secondary', ghost: 'btn-ghost', danger: 'btn-danger',
};
const sizeClass = { sm: 'px-3 py-1.5 text-xs gap-1.5', md: 'px-4 py-2 gap-2', lg: 'px-5 py-2.5 text-base gap-2' };

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; children: ReactNode;
}

export function Button({ variant = 'brand', size = 'md', loading, children, className, ...props }: Props) {
  return (
    <button className={`${variantClass[variant]} ${sizeClass[size]} ${className || ''}`} disabled={loading} {...props}>
      {loading && (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
          <path d="M8 2a6 6 0 0 1 5.2 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
      {children}
    </button>
  );
}
