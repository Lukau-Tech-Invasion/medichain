/**
 * Sample insurance data for IS_DEMO mode only. Split into its own module
 * (dynamically imported from InsurancePage) so Rollup/esbuild can tree-shake
 * it out of production bundles — the `if (IS_DEMO)` check alone can't prove
 * that to the bundler when the data lives inline in the page component.
 */
import type { InsuranceCard, InsuranceClaim } from './InsurancePage';

export function getDemoInsuranceCards(): InsuranceCard[] {
  return [
    {
      id: 'INS-001',
      type: 'medical',
      providerName: 'Blue Cross Blue Shield',
      planName: 'PPO Gold Plan',
      memberId: 'XYZ123456789',
      groupNumber: 'GRP-98765',
      subscriberName: 'John Doe',
      subscriberId: 'SUB-001',
      effectiveDate: '2024-01-01',
      terminationDate: null,
      status: 'active',
      currency: 'USD',
      copay: {
        primaryCare: 25,
        specialist: 50,
        urgentCare: 75,
        emergency: 250
      },
      deductible: {
        individual: 1500,
        family: 3000,
        met: 850
      },
      outOfPocketMax: {
        individual: 6000,
        family: 12000,
        met: 2100
      },
      frontImageUrl: null,
      backImageUrl: null,
      customerServicePhone: '1-800-555-BCBS',
      providerPortalUrl: 'https://member.bcbs.com',
      isPrimary: true,
      lastVerified: '2024-12-01'
    },
    {
      id: 'INS-002',
      type: 'dental',
      providerName: 'Delta Dental',
      planName: 'Premium Plus',
      memberId: 'DD-987654321',
      groupNumber: 'DG-54321',
      subscriberName: 'John Doe',
      subscriberId: 'SUB-001',
      effectiveDate: '2024-01-01',
      terminationDate: null,
      status: 'active',
      currency: 'USD',
      copay: {
        primaryCare: 0,
        specialist: 0,
        urgentCare: 0,
        emergency: 0
      },
      deductible: {
        individual: 50,
        family: 150,
        met: 50
      },
      outOfPocketMax: {
        individual: 1500,
        family: 3000,
        met: 200
      },
      frontImageUrl: null,
      backImageUrl: null,
      customerServicePhone: '1-800-555-DENT',
      providerPortalUrl: 'https://member.deltadental.com',
      isPrimary: false,
      lastVerified: '2024-11-15'
    },
    {
      id: 'INS-003',
      type: 'vision',
      providerName: 'VSP Vision Care',
      planName: 'Enhanced Vision',
      memberId: 'VSP-456789123',
      groupNumber: 'VG-11111',
      subscriberName: 'John Doe',
      subscriberId: 'SUB-001',
      effectiveDate: '2024-01-01',
      terminationDate: null,
      status: 'active',
      currency: 'USD',
      copay: {
        primaryCare: 10,
        specialist: 10,
        urgentCare: 0,
        emergency: 0
      },
      deductible: {
        individual: 0,
        family: 0,
        met: 0
      },
      outOfPocketMax: {
        individual: 0,
        family: 0,
        met: 0
      },
      frontImageUrl: null,
      backImageUrl: null,
      customerServicePhone: '1-800-555-EYES',
      providerPortalUrl: 'https://member.vsp.com',
      isPrimary: false,
      lastVerified: '2024-10-20'
    }
  ];
}

export function getDemoInsuranceClaims(): InsuranceClaim[] {
  return [
    {
      id: 'CLM-001',
      insuranceId: 'INS-001',
      claimNumber: 'C-2024-001234',
      serviceDate: '2024-11-15',
      provider: 'City Medical Center',
      description: 'Annual Physical Examination',
      billedAmount: 350.00,
      allowedAmount: 280.00,
      insurancePaid: 255.00,
      patientResponsibility: 25.00,
      currency: 'USD',
      status: 'approved',
      submittedDate: '2024-11-16',
      processedDate: '2024-11-25',
      eobUrl: '/docs/eob-001.pdf'
    },
    {
      id: 'CLM-002',
      insuranceId: 'INS-001',
      claimNumber: 'C-2024-001567',
      serviceDate: '2024-12-01',
      provider: 'LabCorp',
      description: 'Comprehensive Metabolic Panel',
      billedAmount: 125.00,
      allowedAmount: 95.00,
      insurancePaid: 95.00,
      patientResponsibility: 0,
      currency: 'USD',
      status: 'approved',
      submittedDate: '2024-12-02',
      processedDate: '2024-12-10',
      eobUrl: '/docs/eob-002.pdf'
    },
    {
      id: 'CLM-003',
      insuranceId: 'INS-001',
      claimNumber: 'C-2024-002345',
      serviceDate: '2024-12-20',
      provider: 'Specialist Associates',
      description: 'Cardiology Consultation',
      billedAmount: 450.00,
      allowedAmount: 380.00,
      insurancePaid: 0,
      patientResponsibility: 380.00,
      currency: 'USD',
      status: 'processing',
      submittedDate: '2024-12-21',
      processedDate: null,
      eobUrl: null
    },
    {
      id: 'CLM-004',
      insuranceId: 'INS-002',
      claimNumber: 'D-2024-000789',
      serviceDate: '2024-10-15',
      provider: 'Smile Dental Care',
      description: 'Routine Cleaning & X-Rays',
      billedAmount: 200.00,
      allowedAmount: 180.00,
      insurancePaid: 180.00,
      patientResponsibility: 0,
      currency: 'USD',
      status: 'approved',
      submittedDate: '2024-10-16',
      processedDate: '2024-10-25',
      eobUrl: '/docs/eob-003.pdf'
    }
  ];
}
