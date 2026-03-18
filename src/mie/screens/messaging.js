// Messaging Recommendations Screen
var MESSAGING_RECS = [
  {
    id: 'msg-1',
    trigger: 'Borrower likely rejected at 2+ competitors',
    angle: 'Accessibility & Acceptance',
    headline: 'Get approved even without a perfect credit history',
    description: 'Target borrowers who have been rejected or expect rejection from major lenders. Emphasize GradBridge\'s flexible underwriting and inclusive criteria.',
    status: 'approved',
  },
  {
    id: 'msg-2',
    trigger: 'Top competitor dominates on rate',
    angle: 'Approval Certainty + Support',
    headline: 'A rate means nothing if you can\'t get approved. Here\'s what else matters.',
    description: 'When a competitor offers lower rates but has strict approval criteria, shift the conversation to approval probability and support quality.',
    status: 'approved',
  },
  {
    id: 'msg-3',
    trigger: 'Borrower has no cosigner',
    angle: 'Cosigner-Free Path',
    headline: 'You don\'t always need a cosigner. Here\'s how we\'re different.',
    description: 'For the large segment of borrowers without cosigner access, position GradBridge as the lender that believes in the individual borrower.',
    status: 'approved',
  },
  {
    id: 'msg-4',
    trigger: 'Competitor has strong negative sentiment',
    angle: 'Implicit Contrast',
    headline: 'We built everything borrowers said was missing from the alternatives',
    description: 'When competitor sentiment drops in specific categories, create messaging that addresses those exact pain points without naming competitors directly.',
    status: 'pending',
  },
  {
    id: 'msg-5',
    trigger: 'Borrower is nervous, first-time borrowing',
    angle: 'Trust & Clarity',
    headline: 'Simple terms. No hidden fees. Real humans when you need them.',
    description: 'First-time borrowers need reassurance. Lead with transparency and human support to reduce anxiety and build trust before the application.',
    status: 'approved',
  },
  {
    id: 'msg-6',
    trigger: 'Borrower is rate-sensitive, strong profile',
    angle: 'Competitive Rate + Perks',
    headline: 'Strong credit deserves strong terms. Here\'s ours.',
    description: 'For prime borrowers who could go anywhere, compete on rate directly and layer in differentiators like faster approval and better support.',
    status: 'pending',
  },
  {
    id: 'msg-7',
    trigger: 'Part-time or community college student',
    angle: 'Inclusion & Access',
    headline: 'Your path is yours. We lend to real students, not just ideal ones.',
    description: 'Non-traditional students face systemic rejection. Position GradBridge as the lender that serves the reality of modern education.',
    status: 'approved',
  },
  {
    id: 'msg-8',
    trigger: 'Graduate or professional degree borrower',
    angle: 'Investment Framing + ROI',
    headline: 'Your degree is an investment. We make sure the financing makes sense.',
    description: 'Graduate borrowers think in ROI terms. Frame the loan as an investment with clear terms and a partner who understands the payoff timeline.',
    status: 'pending',
  },
]

export function renderMessaging(container) {
  var html = ''
  html += '<div style="margin-bottom:18px;font-size:13px;color:var(--mie-text-secondary);line-height:1.6">'
  html += 'AI-generated messaging recommendations based on current competitive conditions. Approve or reject to add to the experiment queue.'
  html += '</div>'

  // Stats
  var approved = MESSAGING_RECS.filter(function (r) { return r.status === 'approved' }).length
  var pending = MESSAGING_RECS.filter(function (r) { return r.status === 'pending' }).length
  html += '<div class="mie-kpi-row" style="margin-bottom:20px">'
  html += '<div class="mie-kpi"><div class="mie-kpi-val" style="color:#00E676">' + approved + '</div><div class="mie-kpi-label">Approved</div></div>'
  html += '<div class="mie-kpi"><div class="mie-kpi-val" style="color:#FFD600">' + pending + '</div><div class="mie-kpi-label">Pending Review</div></div>'
  html += '<div class="mie-kpi"><div class="mie-kpi-val" style="color:#7C4DFF">' + MESSAGING_RECS.length + '</div><div class="mie-kpi-label">Total Variants</div></div>'
  html += '</div>'

  for (var i = 0; i < MESSAGING_RECS.length; i++) {
    var rec = MESSAGING_RECS[i]
    html += '<div class="mie-msg-card" data-idx="' + i + '">'
    html += '<div class="mie-msg-trigger">Trigger: ' + rec.trigger + '</div>'
    html += '<div class="mie-msg-headline">"' + rec.headline + '"</div>'
    html += '<div class="mie-msg-angle">' + rec.angle + '</div>'
    html += '<div style="font-size:12px;color:var(--mie-text-secondary);margin-top:6px;line-height:1.5">' + rec.description + '</div>'
    html += '<div class="mie-msg-status">'
    html += '<button class="mie-msg-status-btn' + (rec.status === 'approved' ? ' approved' : '') + '" data-action="approve" data-idx="' + i + '">Approve</button>'
    html += '<button class="mie-msg-status-btn' + (rec.status === 'rejected' ? ' rejected' : '') + '" data-action="reject" data-idx="' + i + '">Reject</button>'
    html += '<button class="mie-msg-status-btn" data-action="pending" data-idx="' + i + '">Reset</button>'
    html += '</div>'
    html += '</div>'
  }

  container.innerHTML = html

  // Status toggle handlers
  container.addEventListener('click', function (e) {
    var btn = e.target.closest('.mie-msg-status-btn')
    if (!btn) return
    var idx = parseInt(btn.dataset.idx, 10)
    var action = btn.dataset.action
    MESSAGING_RECS[idx].status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'pending'
    renderMessaging(container)
  })
}
