/**
 * A link that opens its page through a View Transition (c10 "Open patient").
 *
 * With `opensPatient`, the part of the link marked `data-patient-identity`
 * (the name, or the row itself when nothing is marked) becomes the element
 * the chart banner grows out of. A click with a modifier key, or any button
 * but the first, is left to the browser: a new tab is not a transition.
 */
import type { MouseEvent } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { useMotionNavigate } from './useMotionNavigate';

export interface MotionLinkProps extends LinkProps {
  opensPatient?: boolean;
}

export function MotionLink({ opensPatient, onClick, to, state, replace, ...rest }: MotionLinkProps) {
  const navigate = useMotionNavigate();
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (rest.target && rest.target !== '_self') return;
    event.preventDefault();
    const link = event.currentTarget;
    const shared = opensPatient ? (link.querySelector<HTMLElement>('[data-patient-identity]') ?? link) : null;
    navigate(to, { state, replace, shared });
  };
  return <Link to={to} state={state} replace={replace} onClick={handle} {...rest} />;
}
