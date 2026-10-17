// Public-safe research summaries. This registry contains no private PDF text or holdings.
// checkedAt records an attempted review, not successful source retrieval.
const attemptedAt = '2026-10-16'; // UTC date; no exact retrieval instant asserted.

export const sources = [
  {
    id: 'nobel-2013', name: 'Nobel Prize: empirical analysis of asset prices',
    type: 'Primary research overview',
    url: 'https://www.nobelprize.org/prizes/economic-sciences/2013/summary/',
    status: 'Retained review only', rightsStatus: 'Link and original summary only; no source PDFs served',
    checkedAt: attemptedAt, verificationScope: 'Local handoff records a primary-source spot check. Current live retrieval returned HTTP 403. Full bibliography coverage is unverified.'
  },
  {
    id: 'nobel-2011-sims', name: 'Christopher A. Sims: Statistical Modeling of Monetary Policy and its Effects',
    type: 'Nobel lecture',
    url: 'https://www.nobelprize.org/uploads/2018/06/sims_lecture.pdf',
    status: 'Retained page-level review', rightsStatus: 'Link and original summary only; no source PDFs served',
    checkedAt: attemptedAt, verificationScope: 'Local handoff spot check: PDF page 18 conclusion. Current live retrieval returned HTTP 403. No full lecture review claimed.'
  },
  {
    id: 'nobel-2022-diamond', name: 'Douglas W. Diamond: Nobel lecture',
    type: 'Nobel lecture',
    url: 'https://www.nobelprize.org/uploads/2025/03/diamond-lecture.pdf',
    status: 'Retained page-level review', rightsStatus: 'Link and original summary only; no source PDFs served',
    checkedAt: attemptedAt, verificationScope: 'Local handoff spot check: PDF page 20, printed page 237. Current live retrieval returned HTTP 403. No full lecture review claimed.'
  },
  {
    id: 'nobel-2021-angrist', name: 'Joshua D. Angrist: Empirical Strategies in Economics',
    type: 'Nobel lecture', url: 'https://www.nobelprize.org/uploads/2024/11/angrist-lecture.pdf',
    status: 'Bibliography reviewed; primary text unverified', rightsStatus: 'Link and original summary only; no source PDFs served',
    checkedAt: attemptedAt, verificationScope: 'Retained bibliography pages 10 and 11 reviewed through Library. Current primary-text retrieval returned HTTP 403.'
  },
  {
    id: 'nobel-2017-thaler', name: 'Richard H. Thaler: From Cashews to Nudges',
    type: 'Nobel lecture', url: 'https://www.nobelprize.org/uploads/2018/01/thaler-lecture.pdf',
    status: 'Bibliography reviewed; primary text unverified', rightsStatus: 'Link and original summary only; no source PDFs served',
    checkedAt: attemptedAt, verificationScope: 'Retained bibliography page 13 reviewed through Library. Current primary-text retrieval returned HTTP 403.'
  },
  {
    id: 'nobel-2016-holmstrom', name: 'Bengt Holmström: Pay for Performance and Beyond',
    type: 'Nobel lecture', url: 'https://www.nobelprize.org/uploads/2018/06/holmstrom-lecture.pdf',
    status: 'Bibliography reviewed; primary text unverified', rightsStatus: 'Link and original summary only; no source PDFs served',
    checkedAt: attemptedAt, verificationScope: 'Retained bibliography page 14 reviewed through Library. Current primary-text retrieval returned HTTP 403.'
  },
  {
    id: 'nobel-2014-tirole', name: 'Jean Tirole: Market Failures and Public Policy',
    type: 'Nobel lecture', url: 'https://www.nobelprize.org/uploads/2018/06/tirole-lecture.pdf',
    status: 'Bibliography reviewed; primary text unverified', rightsStatus: 'Link and original summary only; no source PDFs served',
    checkedAt: attemptedAt, verificationScope: 'Retained bibliography page 15 reviewed through Library. Current primary-text retrieval returned HTTP 403.'
  },
  {
    id: 'fred-alfred', name: 'FRED / ALFRED', type: 'Economic time series',
    url: 'https://fred.stlouisfed.org/legal/', status: 'Permission gated',
    rightsStatus: 'Unknown for automated AI ingestion, storage, transformation and display. Each operation requires review.',
    checkedAt: null, verificationScope: 'No FRED or ALFRED data fetched or stored by this interface. Original agency sources need their own rights review.'
  },
  {
    id: 'sec-edgar', name: 'SEC EDGAR', type: 'Issuer filings',
    url: 'https://www.sec.gov/edgar/search/', status: 'Adapter review in progress',
    rightsStatus: 'Source and operation review required; a public link alone does not approve ingestion.',
    checkedAt: null, verificationScope: 'Use the individual filing card for exact issuer, period, units, acceptance time and capture provenance. No live feed is claimed.'
  },

];

export const nobelLibrary = [
  {
    id: 'asset-pricing', year: 2013, title: 'Asset prices need a time horizon',
    laureates: ['Eugene F. Fama', 'Lars Peter Hansen', 'Robert J. Shiller'],
    topic: 'Asset pricing',
    mechanism: 'Empirical asset-pricing research studies how prices relate to information, risk and the horizon over which they are measured.',
    takeaway: 'State the prediction horizon and the benchmark before evaluating a price hypothesis. The Nobel award is research context, not validation of a Cribscore signal.',
    limits: 'No daily, weekly or monthly return forecast has been validated here. Historical research does not establish a usable stock-selection edge after costs.',
    sourceId: 'nobel-2013', sourceUrl: 'https://www.nobelprize.org/prizes/economic-sciences/2013/summary/',
    checkedAt: attemptedAt, verificationStatus: 'Retained spot check',
    verificationScope: 'The local handoff records a primary-source spot check of the 2013 award. Current live source review is blocked by HTTP 403; the complete source text has not been rechecked in this build.'
  },
  {
    id: 'monetary-identification', year: 2011, title: 'A policy move is not an isolated experiment',
    laureates: ['Thomas J. Sargent', 'Christopher A. Sims'],
    topic: 'Macroeconomic causality',
    mechanism: 'Policy, output and prices can respond to each other. Identifying a monetary shock requires explicit model assumptions.',
    takeaway: 'Treat macro effects as model- and horizon-dependent. Keep the assumptions visible when developing a hypothesis.',
    limits: 'Do not assume one universal six-quarter output lag. Macro identification and uncertain responses do not establish stock-selection alpha.',
    sourceId: 'nobel-2011-sims', sourceUrl: 'https://www.nobelprize.org/uploads/2018/06/sims_lecture.pdf',
    checkedAt: attemptedAt, verificationStatus: 'Retained page-level check',
    verificationScope: 'Sims lecture conclusion, PDF page 18, as recorded in the local reviewed handoff. This card does not summarize all of Sargent’s work. Current live retrieval returned HTTP 403.'
  },
  {
    id: 'bank-fragility', year: 2022, title: 'Bank fragility has a specific mechanism',
    laureates: ['Ben S. Bernanke', 'Douglas W. Diamond', 'Philip H. Dybvig'],
    topic: 'Banks and financial crises',
    mechanism: 'Bank models distinguish financial intermediaries from ordinary firms. Their assumptions matter before a liquidity argument is applied to a company.',
    takeaway: 'Check the business model and funding structure before transferring a bank-run explanation into issuer research.',
    limits: 'The bank model does not establish that ordinary companies never face refinancing stress. It supplies no company-specific failure forecast or trading rule.',
    sourceId: 'nobel-2022-diamond', sourceUrl: 'https://www.nobelprize.org/uploads/2025/03/diamond-lecture.pdf',
    checkedAt: attemptedAt, verificationStatus: 'Retained page-level check',
    verificationScope: 'Diamond lecture PDF page 20, printed page 237, as recorded in the local reviewed handoff. Current live retrieval returned HTTP 403. This card is not a complete review of all three laureates.'
  },
  {
    id: 'causal-inference', year: 2021, title: 'A correlation needs an identification argument',
    laureates: ['David Card', 'Joshua D. Angrist', 'Guido W. Imbens'], topic: 'Causal inference',
    mechanism: 'The retained bibliography distinguishes Card’s empirical labour research from Angrist and Imbens’ methods for causal analysis when random assignment is unavailable.',
    takeaway: 'Research application: describe the comparison, identifying assumptions and competing explanations before calling an association causal.',
    limits: 'This is a methodological checklist, not a causal estimate for any issuer. Primary lecture text is not verified in this build; natural experiments do not automatically validate a trading signal.',
    sourceId: 'nobel-2021-angrist', sourceUrl: 'https://www.nobelprize.org/uploads/2024/11/angrist-lecture.pdf',
    checkedAt: attemptedAt, verificationStatus: 'Bibliography only',
    verificationScope: 'Original summary based on retained bibliography pages 10 and 11. Live primary-text retrieval returned HTTP 403. No full lecture review claimed.'
  },
  {
    id: 'behavioral-economics', year: 2017, title: 'Decision rules need room for human behaviour',
    laureates: ['Richard H. Thaler'], topic: 'Behavioural economics',
    mechanism: 'The retained bibliography describes limited rationality, social preferences and self-control as part of Thaler’s economic analysis.',
    takeaway: 'Research application: write the decision rule and invalidation condition before seeing the desired outcome, then retain the original version.',
    limits: 'This application is an editorial design choice. Behavioural research supplies no measured mispricing, sentiment score or forecast accuracy for the companies shown here.',
    sourceId: 'nobel-2017-thaler', sourceUrl: 'https://www.nobelprize.org/uploads/2018/01/thaler-lecture.pdf',
    checkedAt: attemptedAt, verificationStatus: 'Bibliography only',
    verificationScope: 'Original summary based on retained bibliography page 13. Live primary-text retrieval returned HTTP 403. No full lecture review claimed.'
  },
  {
    id: 'contracts-and-control', year: 2016, title: 'Incentives and control need separate questions',
    laureates: ['Oliver Hart', 'Bengt Holmström'], topic: 'Contract theory',
    mechanism: 'The retained bibliography connects contract theory to incentives, imperfectly observable performance, incomplete contracts, ownership and control.',
    takeaway: 'Research application: inspect what management is rewarded for, who holds control rights and which outcomes are actually observable.',
    limits: 'No issuer compensation contract has been evaluated here. Contract theory alone does not establish governance quality, a valuation discount or future returns.',
    sourceId: 'nobel-2016-holmstrom', sourceUrl: 'https://www.nobelprize.org/uploads/2018/06/holmstrom-lecture.pdf',
    checkedAt: attemptedAt, verificationStatus: 'Bibliography only',
    verificationScope: 'Original summary based on retained bibliography page 14. Live primary-text retrieval returned HTTP 403. This is not a full review of Hart’s or Holmström’s lectures.'
  },
  {
    id: 'market-power', year: 2014, title: 'Market power depends on the industry',
    laureates: ['Jean Tirole'], topic: 'Industrial organisation',
    mechanism: 'The retained bibliography presents Tirole’s research on market power and regulation in industries with strategic interaction among firms.',
    takeaway: 'Research application: describe the industry, customer alternatives, competitive response and relevant regulatory constraint before asserting pricing power.',
    limits: 'No industry concentration or company pricing power is measured here. A research mechanism is not evidence that a named issuer has a durable advantage.',
    sourceId: 'nobel-2014-tirole', sourceUrl: 'https://www.nobelprize.org/uploads/2018/06/tirole-lecture.pdf',
    checkedAt: attemptedAt, verificationStatus: 'Bibliography only',
    verificationScope: 'Original summary based on retained bibliography page 15. Live primary-text retrieval returned HTTP 403. No full lecture review claimed.'
  }
];

export const studyState = {
  status: 'unvalidated', label: 'Research only',
  headline: 'Evidence first. An investment edge remains unproven.',
  description: 'This workspace presents dated source observations and research mechanisms. Direction, confidence, price targets and return claims are withheld.',
  validatedInvestmentEdge: false,
  refreshCadence: 'A daily source check is an operational cadence. It does not create a daily return forecast or imply new company evidence.',
  horizons: [
    { id: 'weekly', label: 'Weekly', status: 'Unvalidated', description: 'A distinct research horizon. No tested weekly forecast is available.' },
    { id: 'monthly', label: 'Monthly', status: 'Unvalidated', description: 'A distinct research horizon. No tested monthly forecast is available.' }
  ],
  gates: [
    { id: 'calibration', label: 'Statistical calibration', state: 'Failed', detail: 'The retained synthetic interval test falsely supported 40 of 1,000 boundary cases. No empirical forecast skill is established.' },
    { id: 'rights', label: 'Source operations', state: 'Review required', detail: 'Rights are checked separately for fetch, store, transform and display. FRED / ALFRED remain permission gated.' },
    { id: 'earnings', label: 'Next earnings time', state: 'Unknown', detail: 'Unknown timing withholds only dependent investment actions. It does not erase valid, dated historical facts.' },
    { id: 'study', label: 'Prospective study', state: 'Not run', detail: 'Target, loss, baseline, sample attrition, materiality and confirmation looks must be frozen before any validation claim.' }
  ]
};
