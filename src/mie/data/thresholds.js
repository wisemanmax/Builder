// Competitor approval threshold rules for the match engine
export const THRESHOLDS = {
  'sallie-mae': {
    minCredit: 650,
    cosignerRequired: 'often', // 'always' | 'often' | 'sometimes' | 'never'
    cosignerCreditFloor: 670,
    enrollmentTypes: ['full-time'],
    schoolTypes: ['4-year-public', '4-year-private'],
    citizenshipTypes: ['us-citizen', 'permanent-resident'],
    degreeLevels: ['undergraduate', 'graduate', 'professional'],
    minLoan: 1000,
    maxLoan: 999999,
    minIncome: 0, // no stated minimum
    gpaRequired: false,
  },
  discover: {
    minCredit: 680,
    cosignerRequired: 'often',
    cosignerCreditFloor: 700,
    enrollmentTypes: ['full-time', 'half-time'],
    schoolTypes: ['4-year-public', '4-year-private'],
    citizenshipTypes: ['us-citizen', 'permanent-resident'],
    degreeLevels: ['undergraduate', 'graduate', 'professional'],
    minLoan: 1000,
    maxLoan: 999999,
    minIncome: 0,
    gpaRequired: false,
  },
  sofi: {
    minCredit: 700,
    cosignerRequired: 'sometimes',
    cosignerCreditFloor: 720,
    enrollmentTypes: ['full-time'],
    schoolTypes: ['4-year-public', '4-year-private'],
    citizenshipTypes: ['us-citizen', 'permanent-resident'],
    degreeLevels: ['undergraduate', 'graduate', 'professional'],
    minLoan: 5000,
    maxLoan: 200000,
    minIncome: 25000,
    gpaRequired: true,
  },
  'college-ave': {
    minCredit: 630,
    cosignerRequired: 'sometimes',
    cosignerCreditFloor: 650,
    enrollmentTypes: ['full-time', 'half-time', 'part-time'],
    schoolTypes: ['4-year-public', '4-year-private', 'community-college'],
    citizenshipTypes: ['us-citizen', 'permanent-resident', 'daca'],
    degreeLevels: ['undergraduate', 'graduate'],
    minLoan: 1000,
    maxLoan: 999999,
    minIncome: 0,
    gpaRequired: false,
  },
  gradbridge: {
    minCredit: 600,
    cosignerRequired: 'sometimes',
    cosignerCreditFloor: 620,
    enrollmentTypes: ['full-time', 'half-time', 'part-time'],
    schoolTypes: ['4-year-public', '4-year-private', 'community-college', 'trade-school', 'online'],
    citizenshipTypes: ['us-citizen', 'permanent-resident', 'daca', 'f1-visa'],
    degreeLevels: ['undergraduate', 'graduate', 'professional', 'certificate'],
    minLoan: 1000,
    maxLoan: 150000,
    minIncome: 0,
    gpaRequired: false,
  },
}

// Credit score range midpoints for scoring
export const CREDIT_RANGES = {
  poor: { label: 'Poor (300-579)', min: 300, max: 579, mid: 520 },
  fair: { label: 'Fair (580-619)', min: 580, max: 619, mid: 600 },
  good: { label: 'Good (620-679)', min: 620, max: 679, mid: 650 },
  'very-good': { label: 'Very Good (680-739)', min: 680, max: 739, mid: 710 },
  excellent: { label: 'Excellent (740+)', min: 740, max: 850, mid: 790 },
}

export const ENROLLMENT_TYPES = [
  { value: 'full-time', label: 'Full-time' },
  { value: 'half-time', label: 'Half-time' },
  { value: 'part-time', label: 'Part-time' },
]

export const SCHOOL_TYPES = [
  { value: '4-year-public', label: '4-Year Public University' },
  { value: '4-year-private', label: '4-Year Private University' },
  { value: 'community-college', label: 'Community College' },
  { value: 'trade-school', label: 'Trade / Vocational School' },
  { value: 'online', label: 'Online University' },
]

export const DEGREE_LEVELS = [
  { value: 'undergraduate', label: 'Undergraduate' },
  { value: 'graduate', label: 'Graduate' },
  { value: 'professional', label: 'Professional (Law, Med, etc.)' },
  { value: 'certificate', label: 'Certificate Program' },
]

export const CITIZENSHIP_TYPES = [
  { value: 'us-citizen', label: 'U.S. Citizen' },
  { value: 'permanent-resident', label: 'Permanent Resident' },
  { value: 'daca', label: 'DACA Recipient' },
  { value: 'f1-visa', label: 'F-1 Visa (International)' },
  { value: 'other', label: 'Other' },
]

export const LOAN_RANGES = [
  { value: 'under-5k', label: 'Under $5,000', min: 1000, max: 5000 },
  { value: '5k-15k', label: '$5,000 - $15,000', min: 5000, max: 15000 },
  { value: '15k-30k', label: '$15,000 - $30,000', min: 15000, max: 30000 },
  { value: '30k-50k', label: '$30,000 - $50,000', min: 30000, max: 50000 },
  { value: '50k-plus', label: '$50,000+', min: 50000, max: 100000 },
]

export const INCOME_RANGES = [
  { value: 'none', label: 'No income', mid: 0 },
  { value: '1-20k', label: '$1 - $20,000', mid: 10000 },
  { value: '20-40k', label: '$20,000 - $40,000', mid: 30000 },
  { value: '40k-plus', label: '$40,000+', mid: 60000 },
]

export const US_STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'DC',
  'PR',
]
