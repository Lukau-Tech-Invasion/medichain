/**
 * Badge Component
 */

import { type HTMLAttributes } from 'react';
import { clsx } from 'clsx';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'outline';
  size?: 'sm' | 'md';
}

export function Badge({
  children,
  variant = 'default',
  size = 'sm',
  className,
  ...props
}: BadgeProps) {
  const variants = {
    default: 'bg-surface-sunken text-content-secondary',
    primary: 'bg-notice-subtle text-notice-subtle-fg',
    success: 'bg-ok-subtle text-ok-subtle-fg',
    warning: 'bg-caution-subtle text-caution-subtle-fg',
    danger: 'bg-critical-subtle text-critical-subtle-fg',
    outline: 'bg-transparent border border-border-strong text-content-secondary',
  };

  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
  };

  return (
    <span
      className={clsx(
        'inline-flex items-center font-medium rounded-full',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/**
 * Role Badge - styled for user roles
 */

import type { Role } from '../types';

export interface RoleBadgeProps extends Omit<BadgeProps, 'variant'> {
  role: Role;
}

export function RoleBadge({ role, ...props }: RoleBadgeProps) {
  const roleVariants: Record<Role, BadgeProps['variant']> = {
    Admin: 'danger',
    Doctor: 'primary',
    Nurse: 'success',
    LabTechnician: 'warning',
    Pharmacist: 'default',
    Patient: 'outline',
  };

  return (
    <Badge variant={roleVariants[role]} {...props}>
      {role}
    </Badge>
  );
}

/**
 * Status Badge - for active/suspended states
 */

export interface StatusBadgeProps extends Omit<BadgeProps, 'variant'> {
  status: 'Active' | 'Suspended' | 'Revoked' | 'Pending';
}

export function StatusBadge({ status, ...props }: StatusBadgeProps) {
  const statusVariants: Record<StatusBadgeProps['status'], BadgeProps['variant']> = {
    Active: 'success',
    Suspended: 'warning',
    Revoked: 'danger',
    Pending: 'default',
  };

  return (
    <Badge variant={statusVariants[status]} {...props}>
      {status}
    </Badge>
  );
}
