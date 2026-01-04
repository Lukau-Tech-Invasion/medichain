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
    default: 'bg-gray-100 text-gray-800',
    primary: 'bg-blue-100 text-blue-800',
    success: 'bg-green-100 text-green-800',
    warning: 'bg-yellow-100 text-yellow-800',
    danger: 'bg-red-100 text-red-800',
    outline: 'bg-transparent border border-gray-300 text-gray-700',
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
