// GradBridge MIE — Competitor Data (Phase 1: Hardcoded)
export const COMPETITORS = [
  {
    id: 'sallie-mae',
    name: 'Sallie Mae',
    slug: 'sallie-mae',
    segment: 'incumbent',
    color: '#1E88E5',
    isSelf: false,
    marketShareProxy: 72,
    products: [
      {
        name: 'Undergraduate Private Loan',
        degreeLevel: 'undergraduate',
        fixedAprMin: 4.50, fixedAprMax: 15.49,
        variableAprMin: 6.37, variableAprMax: 16.70,
        loanMin: 1000, loanMax: null, // Full COA
        repaymentTermsMin: 10, repaymentTermsMax: 20,
        originationFee: 0, autopayDiscount: 0.25,
        cosignerReleaseMonths: 12,
        inSchoolDeferment: true, gracePeriodMonths: 6,
        hardshipForbearanceMonths: 12,
      },
      {
        name: 'Graduate Private Loan',
        degreeLevel: 'graduate',
        fixedAprMin: 5.00, fixedAprMax: 15.99,
        variableAprMin: 6.37, variableAprMax: 16.70,
        loanMin: 1000, loanMax: null,
        repaymentTermsMin: 10, repaymentTermsMax: 20,
        originationFee: 0, autopayDiscount: 0.25,
        cosignerReleaseMonths: 12,
        inSchoolDeferment: true, gracePeriodMonths: 6,
        hardshipForbearanceMonths: 12,
      }
    ],
    scores: {
      accessibility: 58, value: 44, pricing: 52, ux: 38, trust: 41,
      composite: 47
    },
    experience: {
      applicationComplexity: 4,
      mobileScore: 5,
      rateTransparency: 4,
      approvalSpeed: 6,
      prequalification: true,
      supportQuality: 4,
      digitalAccountScore: 5,
      personalization: 'basic',
      timeToComplete: 25,
    },
  },
  {
    id: 'discover',
    name: 'Discover',
    slug: 'discover',
    segment: 'premium',
    color: '#FF6D00',
    isSelf: false,
    marketShareProxy: 55,
    products: [
      {
        name: 'Undergraduate Private Loan',
        degreeLevel: 'undergraduate',
        fixedAprMin: 4.99, fixedAprMax: 14.99,
        variableAprMin: 5.74, variableAprMax: 15.74,
        loanMin: 1000, loanMax: null,
        repaymentTermsMin: 10, repaymentTermsMax: 20,
        originationFee: 0, autopayDiscount: 0.25,
        cosignerReleaseMonths: 24,
        inSchoolDeferment: true, gracePeriodMonths: 6,
        hardshipForbearanceMonths: 6,
      }
    ],
    scores: {
      accessibility: 35, value: 72, pricing: 74, ux: 68, trust: 70,
      composite: 64
    },
    experience: {
      applicationComplexity: 7,
      mobileScore: 7,
      rateTransparency: 7,
      approvalSpeed: 7,
      prequalification: true,
      supportQuality: 7,
      digitalAccountScore: 7,
      personalization: 'basic',
      timeToComplete: 15,
    },
  },
  {
    id: 'sofi',
    name: 'SoFi',
    slug: 'sofi',
    segment: 'fintech',
    color: '#7C4DFF',
    isSelf: false,
    marketShareProxy: 48,
    products: [
      {
        name: 'Undergraduate Private Loan',
        degreeLevel: 'undergraduate',
        fixedAprMin: 4.99, fixedAprMax: 14.99,
        variableAprMin: 5.74, variableAprMax: 15.74,
        loanMin: 5000, loanMax: 200000,
        repaymentTermsMin: 5, repaymentTermsMax: 15,
        originationFee: 0, autopayDiscount: 0.25,
        cosignerReleaseMonths: 24,
        inSchoolDeferment: true, gracePeriodMonths: 6,
        hardshipForbearanceMonths: 3,
      }
    ],
    scores: {
      accessibility: 28, value: 78, pricing: 76, ux: 82, trust: 72,
      composite: 67
    },
    experience: {
      applicationComplexity: 8,
      mobileScore: 9,
      rateTransparency: 8,
      approvalSpeed: 8,
      prequalification: true,
      supportQuality: 7,
      digitalAccountScore: 9,
      personalization: 'advanced',
      timeToComplete: 10,
    },
  },
  {
    id: 'college-ave',
    name: 'College Ave',
    slug: 'college-ave',
    segment: 'flexible',
    color: '#00BFA5',
    isSelf: false,
    marketShareProxy: 35,
    products: [
      {
        name: 'Undergraduate Private Loan',
        degreeLevel: 'undergraduate',
        fixedAprMin: 4.44, fixedAprMax: 16.99,
        variableAprMin: 5.49, variableAprMax: 16.85,
        loanMin: 1000, loanMax: null,
        repaymentTermsMin: 5, repaymentTermsMax: 15,
        originationFee: 0, autopayDiscount: 0.25,
        cosignerReleaseMonths: 24,
        inSchoolDeferment: true, gracePeriodMonths: 6,
        hardshipForbearanceMonths: 3,
      }
    ],
    scores: {
      accessibility: 62, value: 63, pricing: 58, ux: 65, trust: 55,
      composite: 61
    },
    experience: {
      applicationComplexity: 7,
      mobileScore: 6,
      rateTransparency: 6,
      approvalSpeed: 8,
      prequalification: true,
      supportQuality: 6,
      digitalAccountScore: 6,
      personalization: 'basic',
      timeToComplete: 12,
    },
  },
  {
    id: 'gradbridge',
    name: 'GradBridge',
    slug: 'gradbridge',
    segment: 'accessible-fintech',
    color: '#FF3CAC',
    isSelf: true,
    marketShareProxy: 15,
    products: [
      {
        name: 'GradBridge Private Student Loan',
        degreeLevel: 'undergraduate',
        fixedAprMin: 4.75, fixedAprMax: 14.49,
        variableAprMin: 5.50, variableAprMax: 15.25,
        loanMin: 1000, loanMax: 150000,
        repaymentTermsMin: 5, repaymentTermsMax: 20,
        originationFee: 0, autopayDiscount: 0.25,
        cosignerReleaseMonths: 12,
        inSchoolDeferment: true, gracePeriodMonths: 6,
        hardshipForbearanceMonths: 12,
      },
      {
        name: 'GradBridge Graduate Loan',
        degreeLevel: 'graduate',
        fixedAprMin: 4.99, fixedAprMax: 13.99,
        variableAprMin: 5.74, variableAprMax: 14.99,
        loanMin: 1000, loanMax: 200000,
        repaymentTermsMin: 5, repaymentTermsMax: 20,
        originationFee: 0, autopayDiscount: 0.25,
        cosignerReleaseMonths: 12,
        inSchoolDeferment: true, gracePeriodMonths: 6,
        hardshipForbearanceMonths: 12,
      }
    ],
    scores: {
      accessibility: 74, value: 69, pricing: 70, ux: 72, trust: 68,
      composite: 71
    },
    experience: {
      applicationComplexity: 8,
      mobileScore: 8,
      rateTransparency: 9,
      approvalSpeed: 8,
      prequalification: true,
      supportQuality: 8,
      digitalAccountScore: 8,
      personalization: 'advanced',
      timeToComplete: 8,
    },
  },
]

// Map dimension pairs for the market map
export const MAP_DIMENSIONS = [
  { id: 'accessibility-value', label: 'Accessibility vs Value', xKey: 'accessibility', yKey: 'value', xLabel: 'Approval Accessibility', yLabel: 'Borrower Value' },
  { id: 'pricing-trust', label: 'Pricing vs Trust', xKey: 'pricing', yKey: 'trust', xLabel: 'Pricing Competitiveness', yLabel: 'Brand Trust' },
  { id: 'ux-trust', label: 'Digital Experience vs Trust', xKey: 'ux', yKey: 'trust', xLabel: 'Digital Experience Quality', yLabel: 'Institutional Credibility' },
  { id: 'accessibility-pricing', label: 'Accessibility vs Pricing', xKey: 'accessibility', yKey: 'pricing', xLabel: 'Approval Accessibility', yLabel: 'Pricing Competitiveness' },
  { id: 'ux-value', label: 'UX vs Value', xKey: 'ux', yKey: 'value', xLabel: 'UX Quality', yLabel: 'Borrower Value' },
]

export const SCORE_DIMENSIONS = [
  { key: 'accessibility', label: 'Accessibility', color: '#00E5FF' },
  { key: 'value', label: 'Value', color: '#AAFF00' },
  { key: 'pricing', label: 'Pricing', color: '#FFD600' },
  { key: 'ux', label: 'UX Quality', color: '#7C4DFF' },
  { key: 'trust', label: 'Trust', color: '#FF3CAC' },
]

export const COMPETITIVE_ALERTS = [
  {
    id: 'alert-1',
    type: 'sentiment',
    severity: 'high',
    date: '2026-03-15',
    title: 'Sallie Mae fee transparency complaints spike',
    description: 'Rate & Fee Fairness score dropped from 3.2 to 2.4 over 30 days, driven by 47 new complaints about unexpected origination fees.',
    competitor: 'sallie-mae',
    action: 'Activate "rate transparency" messaging variant for Sallie Mae comparison keywords.',
  },
  {
    id: 'alert-2',
    type: 'rate_change',
    severity: 'medium',
    date: '2026-03-10',
    title: 'SoFi raised fixed APR minimum by 0.25%',
    description: 'SoFi adjusted their fixed APR floor from 4.74% to 4.99% for undergraduate loans.',
    competitor: 'sofi',
    action: 'GradBridge now has a pricing advantage at the low end. Update rate comparison materials.',
  },
  {
    id: 'alert-3',
    type: 'product',
    severity: 'low',
    date: '2026-03-05',
    title: 'College Ave launched expedited approval',
    description: 'College Ave now advertises same-day approval for pre-qualified borrowers with cosigners.',
    competitor: 'college-ave',
    action: 'Monitor impact on their approval speed score. Consider highlighting GradBridge speed for no-cosigner applicants.',
  },
]
