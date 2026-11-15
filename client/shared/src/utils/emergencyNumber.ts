/** Resolve this deployment's emergency phone number independently of UI language.
 * Configure VITE_EMERGENCY_NUMBER for deployments outside South Africa.
 * Invalid or missing configuration uses South Africa's cellphone emergency service.
 */
export function getEmergencyNumber(configured: unknown = (import.meta as unknown as { env?: Record<string, unknown> }).env?.VITE_EMERGENCY_NUMBER): string {
  return typeof configured === 'string' && /^\d{2,8}$/.test(configured.trim())
    ? configured.trim()
    : '112';
}
