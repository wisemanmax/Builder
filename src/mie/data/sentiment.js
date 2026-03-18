// Hardcoded sentiment data for Phase 1
export const SENTIMENT_CATEGORIES = [
  'trust', 'approval_ease', 'application_friction', 'service_quality',
  'rate_fairness', 'repayment_experience', 'digital_experience', 'brand_reputation'
]

export const SENTIMENT_LABELS = {
  trust: 'Trust & Transparency',
  approval_ease: 'Ease of Approval',
  application_friction: 'Application Friction',
  service_quality: 'Customer Service',
  rate_fairness: 'Rate & Fee Fairness',
  repayment_experience: 'Repayment Experience',
  digital_experience: 'Digital Experience',
  brand_reputation: 'Brand Reputation',
}

// Scores 1.0-5.0 per category per competitor
export const SENTIMENT_SCORES = {
  'sallie-mae': {
    trust: 2.6, approval_ease: 3.4, application_friction: 2.8,
    service_quality: 2.8, rate_fairness: 2.4, repayment_experience: 3.0,
    digital_experience: 2.9, brand_reputation: 3.2,
    overall: 2.9, trend: 'down',
  },
  'discover': {
    trust: 3.8, approval_ease: 3.2, application_friction: 3.6,
    service_quality: 4.0, rate_fairness: 3.9, repayment_experience: 3.7,
    digital_experience: 3.5, brand_reputation: 4.0,
    overall: 3.7, trend: 'stable',
  },
  'sofi': {
    trust: 3.6, approval_ease: 2.8, application_friction: 3.9,
    service_quality: 3.4, rate_fairness: 3.7, repayment_experience: 3.5,
    digital_experience: 4.2, brand_reputation: 3.8,
    overall: 3.6, trend: 'up',
  },
  'college-ave': {
    trust: 3.3, approval_ease: 3.6, application_friction: 3.4,
    service_quality: 3.2, rate_fairness: 3.1, repayment_experience: 3.3,
    digital_experience: 3.0, brand_reputation: 3.1,
    overall: 3.3, trend: 'stable',
  },
  'gradbridge': {
    trust: 4.1, approval_ease: 4.2, application_friction: 4.0,
    service_quality: 4.3, rate_fairness: 3.8, repayment_experience: 4.0,
    digital_experience: 4.1, brand_reputation: 3.5,
    overall: 4.0, trend: 'up',
  },
}

export const SAMPLE_REVIEWS = {
  'sallie-mae': [
    { source: 'Google', rating: 1, polarity: 'negative', category: 'rate_fairness', date: '2026-02-28', text: 'The rate they advertised was nothing like what I actually got. Bait and switch. My actual APR was 4% higher than the "starting from" rate.', strength: 5, actionable: true },
    { source: 'Reddit', rating: null, polarity: 'negative', category: 'service_quality', date: '2026-03-01', text: 'Been on hold for 45 minutes trying to get a simple answer about my cosigner release. This is unacceptable for a company this size.', strength: 4, actionable: true },
    { source: 'Trustpilot', rating: 2, polarity: 'negative', category: 'application_friction', date: '2026-02-15', text: 'Application took forever. Had to upload the same documents three times because their portal kept crashing.', strength: 4, actionable: true },
    { source: 'Google', rating: 4, polarity: 'positive', category: 'approval_ease', date: '2026-02-10', text: 'Got approved pretty quickly with my cosigner. The school certification process was smooth.', strength: 3, actionable: false },
    { source: 'CFPB', rating: null, polarity: 'negative', category: 'trust', date: '2026-01-20', text: 'Filed complaint about undisclosed fees appearing on my statement. Three months of back-and-forth with no resolution.', strength: 5, actionable: true },
  ],
  'discover': [
    { source: 'Google', rating: 5, polarity: 'positive', category: 'service_quality', date: '2026-03-05', text: 'Customer service has always been top-notch. They answered all my questions about repayment options within minutes.', strength: 4, actionable: false },
    { source: 'Trustpilot', rating: 2, polarity: 'negative', category: 'approval_ease', date: '2026-02-20', text: 'Denied without a cosigner even though I have a 670 credit score and stable income. Their requirements are too strict.', strength: 4, actionable: true },
    { source: 'Reddit', rating: null, polarity: 'positive', category: 'rate_fairness', date: '2026-02-18', text: 'Actually got a rate close to what was advertised. The cash-back reward for good grades is a nice touch.', strength: 3, actionable: false },
  ],
  'sofi': [
    { source: 'Google', rating: 5, polarity: 'positive', category: 'digital_experience', date: '2026-03-08', text: 'The app is incredible. I can manage everything from my phone. Best fintech experience I have used.', strength: 4, actionable: false },
    { source: 'Reddit', rating: null, polarity: 'negative', category: 'approval_ease', date: '2026-02-25', text: 'Rejected because I am a part-time student at a state school. My income is 80k and credit is 720. Makes no sense.', strength: 5, actionable: true },
    { source: 'Trustpilot', rating: 3, polarity: 'neutral', category: 'rate_fairness', date: '2026-02-12', text: 'Rate was decent but not the best I could find. Career coaching membership is interesting but have not used it yet.', strength: 2, actionable: false },
  ],
  'college-ave': [
    { source: 'Google', rating: 4, polarity: 'positive', category: 'approval_ease', date: '2026-03-02', text: 'Got approved same day with a cosigner. Process was straightforward and quick.', strength: 3, actionable: false },
    { source: 'Trustpilot', rating: 3, polarity: 'neutral', category: 'brand_reputation', date: '2026-02-14', text: 'Never heard of them before my school recommended them. Seems fine so far, just wish they had more name recognition.', strength: 2, actionable: false },
    { source: 'Reddit', rating: null, polarity: 'negative', category: 'digital_experience', date: '2026-01-30', text: 'Their website feels outdated compared to SoFi. The payment portal is clunky and slow.', strength: 3, actionable: true },
  ],
  'gradbridge': [
    { source: 'Google', rating: 5, polarity: 'positive', category: 'approval_ease', date: '2026-03-10', text: 'Finally a lender that approved me without a cosigner. I was rejected by three other companies before finding GradBridge.', strength: 5, actionable: false },
    { source: 'Trustpilot', rating: 5, polarity: 'positive', category: 'trust', date: '2026-03-06', text: 'The match tool showed me exactly where I stood. No surprises, no hidden fees. Most transparent experience I have had.', strength: 4, actionable: false },
    { source: 'Reddit', rating: null, polarity: 'positive', category: 'service_quality', date: '2026-02-22', text: 'Spoke with an advisor who actually understood my situation as a part-time student. They did not just push me to apply.', strength: 4, actionable: false },
  ],
}
