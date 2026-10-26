// Plain-language versions of the long research passages on the Library, Method and Sources pages.
// The original wording stays in research.js and nobel-corpus.js, and the pages keep it one click away.
// Each group holds one checked plain text, the sha256 (hex, UTF-8) of the exact original it was checked
// against, and every passage id that shares that original. Ids are built from the data the views hold:
// library:<note id>:<field>, method:layer:<layer id>:<field>, gate:<gate id>:detail and
// registry:<source id>:<field>. A page shows a plain text only while its fingerprint matches the current
// original. When the research text changes, the plain text must be checked again and its fingerprint updated.

const groups = [
  {
    original_sha256: "41681602bbbdc51948a8a45bbc47246bc0733136999cd334d09fe18c886cb210",
    plain: "Policy and people’s expectations affect each other. Identifying a monetary or fiscal shock (a surprise change in central bank or government budget policy) requires assumptions. An observed interest rate change is not an exogenous experiment (a change made from outside, unrelated to economic conditions).",
    ids: ["library:nobel-2011:mechanism"]
  },
  {
    original_sha256: "cc429fbd8d9cc28176ab80e0ab1e01e535a359e2f27a2c38fac8daeacd91cc70",
    plain: "Research question: Suppose policy or demand shifts by surprise. How would that change cash flow (money a business takes in and pays out)? How would it change discount rates (rates used to convert future money into its value today)?",
    ids: ["library:nobel-2011:takeaway"]
  },
  {
    original_sha256: "f3bfb2d03b853f36d9755cbb8218cfe6f3a122d368d1cf40ceec232d383dc490",
    plain: "The way a shock is identified can reverse the direction of the estimated effect. Central-bank information effects (when a central bank’s move reveals its view of the economy) can do the same. Relationships seen across the whole economy can break after a policy regime change (a lasting shift in the rules policy makers follow). A VAR (a statistical model of how several measures move together over time) fitted to data does not guarantee that one thing causes another. It is not a profitable trading rule either. It is not established that output (an economy’s total production of goods and services) always responds with a six-quarter delay.",
    ids: ["library:nobel-2011:limits"]
  },
  {
    original_sha256: "78ef1b038eb20aa1a5f9659cd4354a61a7e6f5f11fbf053163418c8cbe71785f",
    plain: "The original public research summaries were read in full through Library on 2026-10-16. So was the source registry (a list of research sources and their details). In this round of work, the primary source PDFs were not independently reread. Labels about downloads and reviews were kept from earlier work. They record reported provenance (where a source came from and how it was saved). They do not count as a current check.",
    ids: ["library:nobel-2011:verificationScope", "library:nobel-2012:verificationScope", "library:nobel-2013:verificationScope", "library:nobel-2014:verificationScope", "library:nobel-2015:verificationScope", "library:nobel-2016:verificationScope", "library:nobel-2017:verificationScope", "library:nobel-2018:verificationScope", "library:nobel-2019:verificationScope", "library:nobel-2020:verificationScope", "library:nobel-2021:verificationScope", "library:nobel-2022:verificationScope", "library:nobel-2023:verificationScope", "library:nobel-2024:verificationScope", "library:nobel-2025:verificationScope"]
  },
  {
    original_sha256: "bb63a0ede973fdef156e1e29aadd74dd39d439dac6a180fdfee8a15d199e857d",
    plain: "A market’s rules affect its results. Some rules govern matching (how participants on each side are paired up). Others govern who takes part and how stable the matches are. A well-designed marketplace can create value. That value does not immediately imply equity outperformance (shares doing better than the stock market as a whole).",
    ids: ["library:nobel-2012:mechanism"]
  },
  {
    original_sha256: "e1a33213360939099b487cf0f26669161cd9ba2c2161a0155ff94a9dbe7735bd",
    plain: "Research question: Does the platform’s way of matching users improve the quality of its service? Does it lead more people to take part?",
    ids: ["library:nobel-2012:takeaway"]
  },
  {
    original_sha256: "4a9709f10a8a6dd770e81efb0bc82789d2240dbb0025b45e6ac09957e1f346ca",
    plain: "Data on how a business runs day to day are often private. Network effects (value that grows as more people use a service) differ from the formal stability of a system that pairs participants. A positive effect from a product does not have to mean the company’s shares are priced too low.",
    ids: ["library:nobel-2012:limits"]
  },
  {
    original_sha256: "2b049b84be8176e1596607852d584a847df23469017faedaa435380da71dd1f4",
    plain: "How well returns (the gain or loss from holding an investment) can be predicted is a statistical matter. It also depends on the horizon (the length of time over which returns are measured). Returns that seem above normal may be payment for bearing risk. Valuation (how a share price compares with the business behind it) matters. So does uncertainty. Model tests depend on which pricing model (a rule for how risk and return are linked) is chosen.",
    ids: ["library:nobel-2013:mechanism"]
  },
  {
    original_sha256: "46e87ad846dae2a786a02aed8a32cf9934b2afff6a5845d5a4b643180611af45",
    plain: "Research question: What is already reflected in the price? What risk could explain what looks like an opportunity?",
    ids: ["library:nobel-2013:takeaway"]
  },
  {
    original_sha256: "ec4eab702a9a0619df665e0493a9ec93c53fad9bfa955ee5089d4fe937365306",
    plain: "A low multiple (the share price divided by a measure such as earnings) can reflect financial trouble or worsening prospects. Patterns in valuation over long periods are weak tools for timing. Mispricing (a price out of line with what an asset is worth) has no simple proof. The joint-hypothesis problem (any test of mispricing also tests the pricing model it relies on) is one reason. Estimation uncertainty (error in numbers estimated from limited data) and data mining (testing many patterns until one fits by chance) are two more reasons.",
    ids: ["library:nobel-2013:limits"]
  },
  {
    original_sha256: "6d7c176ed42f7938e6bf418d08415a8de17ad795a0a583f5608d72a55ad376a6",
    plain: "Pricing power (a company’s ability to raise prices without losing many customers) is shaped by how rival firms react to each other. It is also shaped by asymmetric information (one side knowing more than the other) and by regulation. High margins (the share of sales kept as profit) alone do not show an edge over rivals that can be defended. They also do not show that such an edge would hold up legally over time.",
    ids: ["library:nobel-2014:mechanism"]
  },
  {
    original_sha256: "5cac948c9e52f049f8a00d6c7afdc9f7499049c0c09da47caffa96f7c10e0cc4",
    plain: "Research question: Can pricing power last against competition? Can it also last under measures regulators could plausibly order?",
    ids: ["library:nobel-2014:takeaway"]
  },
  {
    original_sha256: "08edeeced53f2342084b84b919699ec38f88b08e885191981071c477c5b223db",
    plain: "Market definition (deciding which products and rivals belong in one market) is hard. Markups in company accounts (how far prices sit above recorded costs) are imprecise stand-ins for economic market power. Outcomes of regulation and of antitrust action (enforcing laws against monopolies and unfair competition) are uncertain. They also vary by jurisdiction (the place whose laws and regulators apply).",
    ids: ["library:nobel-2014:limits"]
  },
  {
    original_sha256: "b911808d438a64e94d2ee1a39b68e018296097f3e0daf09479c29a697fb70a1f",
    plain: "Measuring spending and well-being one household at a time shows how households differ. Averages that combine everyone hide those differences. A spending total for the whole economy may not match a company’s customers.",
    ids: ["library:nobel-2015:mechanism"]
  },
  {
    original_sha256: "cccf5b65ede282b6dab601ee492af975a5ded715059a90ce3b408aae4f6a2a2a",
    plain: "Research question: Which households spend money on this company’s products? How exposed are their budgets?",
    ids: ["library:nobel-2015:takeaway"]
  },
  {
    original_sha256: "78d7c884154cf5c5bc0a743f18ae68644a23a2c8063286ea749748c7ed80ac5f",
    plain: "Survey data can contain errors. The figures can also be revised later. Adding up data on single units, such as households, into totals for the whole economy raises problems. Predictable revenue (money a company takes in from sales) does not mean returns (the gain or loss from owning its shares) are predictable.",
    ids: ["library:nobel-2015:limits"]
  },
  {
    original_sha256: "b1154d623fce08940d2ee02dad42c43f1d2425500cfed57f235880834c3b5389",
    plain: "Ownership and control rights (the power to decide how an asset gets used) affect behavior. Incomplete contracts (agreements that cannot cover every future event) and incentive design (how rewards are set up to steer choices) do too. Simple pay ratios (single numbers that compare pay with something else) do not sum up how these work.",
    ids: ["library:nobel-2016:mechanism"]
  },
  {
    original_sha256: "1618e1b9e2ef4cb77731326a2c14f9898bcd9df4f5525bbd71aa04c03daa619c",
    plain: "Research question: Do incentives and control rights help create long-term value? Or do they encourage risks that can be measured?",
    ids: ["library:nobel-2016:takeaway"]
  },
  {
    original_sha256: "30b525535b0c320eb0c37976d0b1f121f89737669f58195bc3c8007bffac4d5c",
    plain: "Contract terms are shaped by the firm’s risk and by the talent it needs. Disclosures (what companies publish about themselves) are incomplete. Governance associations (patterns tying how a firm is run to other measures) do not automatically show cause and effect. They also do not automatically identify alpha (returns beyond what the risk taken would explain).",
    ids: ["library:nobel-2016:limits"]
  },
  {
    original_sha256: "01fbc6da134e32f3e87a11cce5fb31e6453e229a9ac92b83d64d80088643a52b",
    plain: "Limited rationality (people cannot weigh all information perfectly) helps explain decisions. Self-control and social preferences (caring about fairness and about other people) do too. Behavioral explanations (accounts based on how people think and act in practice) support a better research process. They do not make every anomaly (a price pattern that usual market theory fails to explain) something one can trade on.",
    ids: ["library:nobel-2017:mechanism"]
  },
  {
    original_sha256: "0b31fa877e0339d81514eb3e1449bf435f1ac046cb047ed560d1397067e79c54",
    plain: "Research question: Is the thesis (the core argument behind an investment idea) driven by evidence? Or is it driven by anchoring (relying too much on a first number or view) and attention? Is selective updating (taking in facts that fit one’s view, discounting the rest) also driving it?",
    ids: ["library:nobel-2017:takeaway"]
  },
  {
    original_sha256: "af01f3c9d8a79876d366bdeeed866787720a72b337db7471f59faea5ae53b545",
    plain: "This hypothesis (an idea that still needs testing) is a new research proposal by this site. It is not a conclusion that the prize guarantees. Crowding (many investors making the same trade) and costs can remove effects. Publication decay (effects fading once research on them is published) can remove them as well. Behavioral narratives (stories about how people’s thinking drove an outcome) are easy to fit after the fact.",
    ids: ["library:nobel-2017:limits"]
  },
  {
    original_sha256: "970f56b7355687286e6ee9305bd8c0867f624a4fb60f205744b9f4f6d781168d",
    plain: "Ideas and innovation help drive growth. Climate is a macroeconomic externality (an economy-wide cost that those causing it do not pay). Neither idea, on its own, picks out a stock that will do well in the near term. Doing that would also need a judgment of the company’s worth against its price, and evidence about the specific firm.",
    ids: ["library:nobel-2018:mechanism"]
  },
  {
    original_sha256: "4503fa2ef86bdabf91e95792e206f97c645d7a369ea32967d80d15d104d5d907",
    plain: "Research question: What investment supports lasting productivity (how much output a firm gets from its inputs)? Which climate or policy scenarios threaten cash flow (the cash a business takes in minus what it pays out)?",
    ids: ["library:nobel-2018:takeaway"]
  },
  {
    original_sha256: "d34ea5b29c27d2114e820e34afbdcf0bd6d60e0d0b0a9e55d68624c333c102e8",
    plain: "R&D (money a company spends on research and development) is not the same as successful innovation. Patent counts vary by field. They also vary with legal strategy. Climate damage carries substantial model uncertainty (doubt about whether the models used are right). Discounting (how much less money in the future counts than today) and policy paths (how government policy may change over time) carry it too.",
    ids: ["library:nobel-2018:limits"]
  },
  {
    original_sha256: "02e0ad28703827be079650d812af675290b69e5328e20f4dc36e4ec3f66fb4c2",
    plain: "Randomized field experiments are real-world tests where chance decides who gets a program or policy. They can identify the effects of that program or policy in a defined setting. Evidence from programs that fight poverty does not turn into a formula for choosing stocks.",
    ids: ["library:nobel-2019:mechanism"]
  },
  {
    original_sha256: "a6456cd9b68a01a31889629b5ba575d9425dd1738dc4ea362e08fd117e5b5fb4",
    plain: "Research question: What changed because of the intervention (the program or action being studied), and for whom? What did it cost?",
    ids: ["library:nobel-2019:takeaway"]
  },
  {
    original_sha256: "ad72ff4646b92b3ff373b67574e7b9a306751443c2f7998f869a727caac61b1e",
    plain: "External validity (whether a result holds outside the tested setting) is a limit. Scale effects (results changing when a program grows larger) are another limit. The quality of an experiment is often not disclosed. A cause-and-effect impact on how a business runs can already be reflected in valuation (the price the market puts on the company).",
    ids: ["library:nobel-2019:limits"]
  },
  {
    original_sha256: "677a49398b52b189f77e54b4c70ee31a08857e890627d95510be6977da662e7b",
    plain: "Auction design and information affect who ends up with what, and at what price. This includes common-value uncertainty (doubt about a value that is the same for every bidder). It also includes the winner’s curse (the winner has often valued the item too highly). Winning an auction does not by itself create value.",
    ids: ["library:nobel-2020:mechanism"]
  },
  {
    original_sha256: "df460db6948c4ca9abd7602f8e4db03b61b45bb586802c0dc3b1441779e685e0",
    plain: "Research question: Did the acquired right or asset cost less than the extra value it brings, once risk is taken into account?",
    ids: ["library:nobel-2020:takeaway"]
  },
  {
    original_sha256: "c7439edabca1085005eb7268c10fd5f70a68152173a6571260bcaed93cd93c4d",
    plain: "Bids and private values (what an item is worth to one particular bidder) may not be possible to see. Financing matters. So do strategic spillovers (side effects that reach beyond the deal itself). Success seen after the fact must not be used to estimate value before the fact.",
    ids: ["library:nobel-2020:limits"]
  },
  {
    original_sha256: "8cebaebd2c5682eced76e1613d5f0f174f256e2dc87793cd435d109cb4586969",
    plain: "Natural experiments (real events that sort people into groups as if at random) can answer well-defined questions. So can causal inference (methods for working out what causes what). They do so under assumptions that are stated openly. Predicting the gain or loss from holding an investment is one task. Estimating causal effects (how much one thing changes another) is a different task.",
    ids: ["library:nobel-2021:mechanism"]
  },
  {
    original_sha256: "348b3221d8804a309e072e43069dd92960d66bdf57f5ab0b29546dc873f5142f",
    plain: "Research question: What is the estimand (the exact quantity a study sets out to measure)? What is the identification assumption (the condition needed to read a result as cause and effect)? What other explanation is plausible?",
    ids: ["library:nobel-2021:takeaway"]
  },
  {
    original_sha256: "6d9c7150a5b04bf0eaf8e0b44b4a8443153c6f858666cbc5b398893fa2385d16",
    plain: "An effect found for one group or setting may not hold for others. A study design can be made invalid by weak instruments (outside factors only loosely linked to the cause studied). Anticipation (people acting early because they expect the change) can do the same. So can spillovers (effects that leak over to the comparison group). Fitting a flexible model (one that can bend to match almost any data) does not, on its own, pin down cause and effect.",
    ids: ["library:nobel-2021:limits"]
  },
  {
    original_sha256: "5cd735d194f2c76a33aebb528cc568c5858354b028d2a5951650a6b4d8d253b4",
    plain: "Liquidity transformation (turning deposits that can be withdrawn anytime into long-term loans) provides useful services. So does delegated monitoring (checking on borrowers on behalf of many savers). They also create a risk of runs (many depositors pulling money out at once). Credit intermediation (passing savers’ money on to borrowers as loans) becomes fragile too. Capital (the owners’ own funds, which can absorb losses) must be evaluated together with liquidity (cash and assets that can be sold quickly). Depositor structure (who the depositors are and how much each holds) belongs in the same assessment.",
    ids: ["library:nobel-2022:mechanism"]
  },
  {
    original_sha256: "515a7a67d47dbbcadd20fba445f5df03c3d481e508e9a952fc50a79b99df88c4",
    plain: "Research question: Could withdrawals or credit losses (money lost when borrowers fail to repay) force expensive funding or asset sales? Could they force dilution (issuing new shares, which shrinks existing owners’ stakes)?",
    ids: ["library:nobel-2022:takeaway"]
  },
  {
    original_sha256: "bce99d9101f626c03b0d4359a3330d55bf3bf6b90cc76b48dad8fb258a062810",
    plain: "During a run, delays in reporting matter a lot. The categories used in accounting can hide economic losses. Policy responses are nonlinear (they are not in proportion to what sets them off). The same is true of depositor coordination (depositors reacting to what other depositors do). No model can reliably tell when a run will happen. The bank model does not show that ordinary firms never face refinancing stress (trouble replacing debt as it comes due).",
    ids: ["library:nobel-2022:limits"]
  },
  {
    original_sha256: "2949d1a0dd346df8db231640ab50bebb5ea3387e9a51337fab06f5e487531da0",
    plain: "Historical evidence on the labor market (the market for paid work) highlights mechanisms behind participation (whether people hold or seek paid work). It also highlights mechanisms behind careers and earnings. Use this to analyze aggregate labor supply (the total amount of work people are willing to offer) and skills. Also use it to analyze how work is designed. Do not turn it into a ranking of stocks by demographics (the makeup of a population by traits such as age).",
    ids: ["library:nobel-2023:mechanism"]
  },
  {
    original_sha256: "44930fb15f059b92db6c3fbd7dc51ae45037e9ddbc60a56841884a99f610d2f5",
    plain: "Research question: How does the availability of workers affect costs and execution (how well plans are carried out)? How do skill requirements and the way work is organized affect them?",
    ids: ["library:nobel-2023:takeaway"]
  },
  {
    original_sha256: "1997b42416172ec3cb11938f34ce30ecf2f1c3db9d6043b316cade5eec912990",
    plain: "Public figures about workforces (the people an employer has on staff) cannot be fairly compared with each other. Demographic composition (the mix of people by traits such as age) is not a factor that makes an investment gain or lose value. Do not infer the traits of individual people. Do not use protected characteristics (personal traits that anti-discrimination laws protect) to make employment decisions.",
    ids: ["library:nobel-2023:limits"]
  },
  {
    original_sha256: "393435f7e49e5f8fb3147279a8286e280091694023dc3e72744f7025482eb4c5",
    plain: "Institutions (the rules a society lives by, such as its laws) influence prosperity over the long run. Historical identification strategies (ways of using past events to separate cause from coincidence) help explain economic outcomes. They are not present-day stock factors (company traits used to explain how stocks perform). They are also not forecasts of how institutions will change.",
    ids: ["library:nobel-2024:mechanism"]
  },
  {
    original_sha256: "7e33c5cdfd123ffd692953fe7f2e72fd04622673f87266effb0f268844601aaf",
    plain: "Research question: Which institutional risks (dangers that come from how a country is governed) could harm operations or ownership rights? Could any of them hinder cash repatriation (moving money earned abroad back to the home country)?",
    ids: ["library:nobel-2024:takeaway"]
  },
  {
    original_sha256: "9fe6b30ad8ba9b852098cbede513d72b7ad5135305e2b269d98fa985e7171d36",
    plain: "Country indicators (measures that sum up conditions in a whole country) are slow. They are also noisy (they carry random error that blurs the signal). They are partly based on people’s perceptions. Changes in institutions are hard to identify. They are also hard to forecast. Historical instruments (past factors used in studies to isolate cause and effect) must not be reused as inputs for ranking stocks.",
    ids: ["library:nobel-2024:limits"]
  },
  {
    original_sha256: "ea91f5bcf6f6497ecef42e0d5accd269ca6e40bb0061434b91ac29a536d89346",
    plain: "Cumulative knowledge (ideas that build on earlier ideas) and creative destruction (new products and firms pushing out older ones) explain sustained growth. Economic progress can help consumers while it wears down the profits of incumbents (companies already established in a market). Successful innovators can still be overpriced.",
    ids: ["library:nobel-2025:mechanism"]
  },
  {
    original_sha256: "dae12773bbe3de33ed12a8e171359203dc390493f0fee304ac13c53055f88752",
    plain: "Research question: Who ends up with the value created by a shift in technology? What expectations are already built into the price?",
    ids: ["library:nobel-2025:takeaway"]
  },
  {
    original_sha256: "86e07f990867b2503857e1b6704372e5deb375c724ff77c381a91031af48591b",
    plain: "Survivorship (looking only at the firms that survived) is a severe problem. So is hype selection (picking examples because they drew attention). Patents and spending do not pin down shareholder returns (the gains or losses that owners of the shares get). Neither does how important a technology is. The timing of disruption (a new technology upending an established industry) is uncertain. So is value capture (who ends up keeping the value that is created).",
    ids: ["library:nobel-2025:limits"]
  },
  {
    original_sha256: "2d78c71a7ae51396c6d111a7d3f9e815bdf2365964044064cf791d66bcb0a274",
    plain: "The supplied research registry (a list of research sources and their details) contains a 2026 entry. Its award attribution (who the prize is credited to) awaits primary verification (a check against the original record). So does its prize-specific scope (the details that apply to this specific prize).",
    ids: ["library:nobel-2026:mechanism"]
  },
  {
    original_sha256: "a0df74001b1aa1afff824a3f309e58404fb3d05c478eb0d4054d66e1ab56c140",
    plain: "Keep this entry withheld until the authoritative primary record (the official, original source of the facts) is checked.",
    ids: ["library:nobel-2026:takeaway"]
  },
  {
    original_sha256: "3ed4fdef8ffda627b80d32e370db395f4e7189c60b5d967e3e5d7e66a89ef53b",
    plain: "This entry makes no unverified claim about who won the prize. It does not claim a prize-specific mechanism (an economic idea tied to this particular prize). It also claims no forecast or investment result.",
    ids: ["library:nobel-2026:limits"]
  },
  {
    original_sha256: "5953be4bf9842157f5a026f69afa70c27b8ce22617bc8933b7a2a0d85cee8b5c",
    plain: "The original public registry could be read. Its 2026 metadata (the descriptive details recorded for that year) has not been independently verified. So the entry’s substantive content (the research details themselves, such as who won and for what work) is withheld.",
    ids: ["library:nobel-2026:verificationScope"]
  },
  {
    original_sha256: "c70998996fbd0b8c4034dc396b86c1f8d017267c6d30ddee4946b2aac63b2371",
    plain: "Which changes in growth, inflation (prices rising across the economy), energy and financing (how easily and cheaply money can be raised) matter to this business?",
    ids: ["method:layer:macro:question"]
  },
  {
    original_sha256: "0a6eec9fce016ca14876837bacffed3f0a2747ac2ed22a9ca82dd7bb47c1a68b",
    plain: "Describe the plausible tailwind or headwind (a condition that helps or hurts the business). Describe a competing explanation as well. Do not assume the stock price will respond in a fixed, automatic way.",
    ids: ["method:layer:macro:result"]
  },
  {
    original_sha256: "5ed333c10ecb4b90e7cac53499b88a71f6732962179079500d8d4418b28e471e",
    plain: "What changed compared with what was expected? How did yields (the return investors earn on bonds) and stocks respond?",
    ids: ["method:layer:fed_response:question"]
  },
  {
    original_sha256: "5958be086e4ee8358ce2b3d10615d7942d29b11d0cb3a88e778f04c84a741b9a",
    plain: "Keep the policy fact separate from expectations and from the market reaction actually seen. Also keep it separate from the proposed explanation of cause and effect.",
    ids: ["method:layer:fed_response:result"]
  },
  {
    original_sha256: "677885ea1b19d2d297be362c592237f7e62e184c90c8a58ec0bf84c6896f0986",
    plain: "Is this industry leading over comparable time periods? Does this company share the relevant economics (the forces that drive the industry’s sales and profits)?",
    ids: ["method:layer:industry:question"]
  },
  {
    original_sha256: "350195f2b8774098e68f40d66f123081ca6951c7ade7e2bb8df999a6c4fe08ea",
    plain: "Do not treat a count of tickers (the short symbols that identify listed stocks) as measured diversification (spreading risk across holdings that move differently). Do not treat a shared theme (a common story linking several stocks) that way either.",
    ids: ["method:layer:industry:result"]
  },
  {
    original_sha256: "849f66c227be9e7c466e8cb0eba3fd38717217cc68574cd17cd27699a368390c",
    plain: "What new evidence changes future sales or profit? What new evidence changes future cash flow (money a business actually takes in and pays out)?",
    ids: ["method:layer:forward_earnings:question"]
  },
  {
    original_sha256: "992f0fafc9c3d8fb09454a84709eef26b84fcd3c2544b237945399cf23c405ff",
    plain: "Keep six things separate. Two are company guidance (the outlook a company publishes for its own results) and consensus revisions (changes to analysts’ average estimates). Two more are reported results and one-offs (unusual items not expected to happen again). The last two are backlog (orders taken but not yet filled) and actual cash conversion (how much profit turns into cash).",
    ids: ["method:layer:forward_earnings:result"]
  },
  {
    original_sha256: "d9963a35dee0717a1a98a8f77c9608f93300fb2d482969b5f92db8ff555d708e",
    plain: "Before this view expires, what information could change expectations?",
    ids: ["method:layer:catalyst:question"]
  },
  {
    original_sha256: "df2bcee0c152275a3603cfc13ae5ef51817392a88ee9bc4fc5d25e84c7c21336",
    plain: "A conference is not automatically a fresh positive catalyst (an event that could move the share price). The same holds for an index event (a change in which stocks a market index includes) or an old earnings release. Identify outcomes that could go either way. Also identify information that is already known.",
    ids: ["method:layer:catalyst:result"]
  },
  {
    original_sha256: "2e1cfa92abba860f2f04c76d5f010b55d742a4b1b949cfd203a51514571122bc",
    plain: "Does the way the price is behaving now support the thesis (the research case made for the stock)? What could prevent a realistic execution (actually carrying out a trade in real market conditions)?",
    ids: ["method:layer:execution:question"]
  },
  {
    original_sha256: "f26bb84f94bc29f9413ebbd9d044a1b2eaf7fd299b87bab0ecd48543cdb6358e",
    plain: "Keep four things apart. Two are the screen price (the price shown on a chart or display) and the proposed condition (the planned rule for making a trade). The other two are the executable quote (a price you could really trade at) and the actual fill (the real price of a completed trade). A falling price that reaches an old entry level (a price set earlier for opening a trade) is not enough.",
    ids: ["method:layer:execution:result"]
  },
  {
    original_sha256: "dc5ed0a2fb65570d731ccf263224670acc6e166a6f6c5f8f901ba86634f3f9bd",
    plain: "What is left for one share after expenses, debt, preferred claims (amounts owed to investors paid before ordinary shareholders) and possible new shares?",
    ids: ["method:layer:per_share:question"]
  },
  {
    original_sha256: "9467a4bb12a5fb69e8f52177120cae811a34a2e53b15e67d137866b055fa1064",
    plain: "For operating companies (businesses that sell goods or services), use corporate dilution analysis (a check of how new shares shrink existing owners’ stakes). For funds, use a separate template. It covers NAV (net asset value: a fund’s holdings minus debts, per share) and fees. It also covers creation-redemption (how a fund issues new shares or cancels old ones).",
    ids: ["method:layer:per_share:result"]
  },
  {
    original_sha256: "136f20ecf0957f8782447465068976c88fbc9617a05cfb50cd60e013f3e94a42",
    plain: "The interval test that was kept used synthetic data (made-up data built only for testing). An interval is a range within which a value may fall. The test wrongly supported 40 of 1,000 boundary cases (cases set at the limit, where the test should not give support). No forecasting skill has been established with real-world data.",
    ids: ["gate:calibration:detail"]
  },
  {
    original_sha256: "900aa2c10a9f54c8e3f54608523daf325500693325453e9d25f2d2957b6e739f",
    plain: "Permission to use a source is checked separately for each step: fetching it, storing it, changing it and showing it. FRED and ALFRED (economic data series from the Federal Reserve Bank of St. Louis) are still blocked until permission is confirmed.",
    ids: ["gate:rights:detail"]
  },
  {
    original_sha256: "8973175e85cbe193d89c1d9f4810c0b715c4c761c790c9c9f1de47def9e919df",
    plain: "When the timing is unknown, only the investment actions that depend on it are held back. This does not erase past facts that are valid and dated.",
    ids: ["gate:earnings:detail"]
  },
  {
    original_sha256: "727951ae5b229f910603ffe59071cbf27c857163e6287a325361792884f05584",
    plain: "Six things must be frozen (fixed in advance and then left unchanged) before any claim of validation (test evidence that the method works). Two are the target (the outcome the study measures) and the loss (the rule that scores each error). Two more are the baseline (a standard to compare results against) and sample attrition (cases that drop out of the study). The last two are materiality (how large a result must be to matter) and confirmation looks (the planned checks of whether results hold).",
    ids: ["gate:study:detail"]
  },
  {
    original_sha256: "63b84d0a2b5c10ec89137a79466831a7e045d0866ef4f859207d5fa4bc75bc3d",
    plain: "This site offers only a link and the original summary. It does not provide the source PDFs (the original documents as downloadable files).",
    ids: ["registry:nobel-2013:rightsStatus", "registry:nobel-2011-sims:rightsStatus", "registry:nobel-2022-diamond:rightsStatus", "registry:nobel-2021-angrist:rightsStatus", "registry:nobel-2017-thaler:rightsStatus", "registry:nobel-2016-holmstrom:rightsStatus", "registry:nobel-2014-tirole:rightsStatus"]
  },
  {
    original_sha256: "261c307447edd2ccf583890376ff0fd50aede8ba5ac0b7dc8982352df061a77d",
    plain: "The local handoff (earlier notes passed on and stored locally) records a spot check (a look at a few selected parts). The check was made against the primary source (the source’s own original document). A current live attempt to fetch the source returned HTTP 403 (a code meaning the website refused access). Coverage of the full bibliography (the list of works the source cites) has not been verified.",
    ids: ["registry:nobel-2013:verificationScope"]
  },
  {
    original_sha256: "a06122f41e25e528772be6907c5451d4d88b623761114503a028f1244534cf17",
    plain: "The local handoff (earlier notes passed on and stored locally) records a spot check (a look at a few selected parts). It looked at the conclusion on page 18 of the PDF. A current live attempt to fetch the source returned HTTP 403 (a code meaning the website refused access). No review of the full lecture is claimed.",
    ids: ["registry:nobel-2011-sims:verificationScope"]
  },
  {
    original_sha256: "903060bda019b0fa167ef99ff4adfbadfdc21e29f9171b35804c4818e1c0938a",
    plain: "The local handoff (earlier notes passed on and stored locally) records a spot check (a look at a few selected parts). It looked at page 20 of the PDF, which carries the printed page number 237. A current live attempt to fetch the source returned HTTP 403 (a code meaning the website refused access). No review of the full lecture is claimed.",
    ids: ["registry:nobel-2022-diamond:verificationScope"]
  },
  {
    original_sha256: "642beeb8d6195362b47a3c014848733bf029deb26589dc520b4377a614c35b4e",
    plain: "An earlier record says the bibliography (the list of works the source cites) on pages 10 and 11 was reviewed through Library. A current attempt to fetch the primary text (the source’s own original document) returned HTTP 403 (a code meaning the website refused access).",
    ids: ["registry:nobel-2021-angrist:verificationScope"]
  },
  {
    original_sha256: "0397f5bc47e540bdf3d3d5cbd9caddba9422add69ad61e2b1a9a0d111f79139c",
    plain: "An earlier record says the bibliography (the list of works the source cites) on page 13 was reviewed through Library. A current attempt to fetch the primary text (the source’s own original document) returned HTTP 403 (a code meaning the website refused access).",
    ids: ["registry:nobel-2017-thaler:verificationScope"]
  },
  {
    original_sha256: "dc1c7f18cb2fe2e13446662044d0496824a37c5921296766e27f4b324382d7da",
    plain: "An earlier record says the bibliography (the list of works the source cites) on page 14 was reviewed through Library. A current attempt to fetch the primary text (the source’s own original document) returned HTTP 403 (a code meaning the website refused access).",
    ids: ["registry:nobel-2016-holmstrom:verificationScope"]
  },
  {
    original_sha256: "d617e293168a5863f2c53089789ca1bbfddfc542c353a7f704955ddd74abb1dd",
    plain: "An earlier record says the bibliography (the list of works the source cites) on page 15 was reviewed through Library. A current attempt to fetch the primary text (the source’s own original document) returned HTTP 403 (a code meaning the website refused access).",
    ids: ["registry:nobel-2014-tirole:verificationScope"]
  },
  {
    original_sha256: "cb1a9f59cd19fd8a0aa3079c3c1751b1c1b55320c756715ba6476cd8573ce2df",
    plain: "Rights are unknown for automated AI ingestion (taking the data into an AI system), storage, transformation and display. Each of these operations needs a review.",
    ids: ["registry:fred-alfred:rightsStatus"]
  },
  {
    original_sha256: "a5f5aac7574f62b45b3735ce45cbcbcd000a1f5a4f3b4632858fb31ffc6d588e",
    plain: "This site has not fetched or stored any data from FRED or ALFRED (two online databases of economic data series). The original agency sources (the organizations that first published the data) each need their own review of usage rights.",
    ids: ["registry:fred-alfred:verificationScope"]
  },
  {
    original_sha256: "8e5a7da050af806bb00d5defbaf6004f01f448cb480b772a7df856a360e605b8",
    plain: "Both the source and the operation (what is done with its data) need a review. A public link by itself does not approve ingestion (bringing the data into this system).",
    ids: ["registry:sec-edgar:rightsStatus"]
  },
  {
    original_sha256: "8ad3e168ba7a0f64ff2a658c56cf0407523a28eaa8147c8958b1738193c0f550",
    plain: "For the exact details, use the card for each individual filing. Look there for the issuer (the organization that filed the document) and the period. The units and the acceptance time (when the filing system accepted the document) are there too. So is the capture provenance (where the record came from and how it was saved). No live feed (a steady, automatic stream of new data) is claimed.",
    ids: ["registry:sec-edgar:verificationScope"]
  },
  {
    original_sha256: "1c9d4ce44cea9507f360e1ad716dfed0bea410cea6281f5ac21d5421d9eddfdc",
    plain: "The original research summary was read. The source document itself was not read again.",
    ids: ["registry:nobel-background-2011:status", "registry:nobel-background-2012:status", "registry:nobel-background-2013:status", "registry:nobel-background-2014:status", "registry:nobel-background-2015:status", "registry:nobel-background-2016:status", "registry:nobel-background-2017:status", "registry:nobel-background-2018:status", "registry:nobel-background-2019:status", "registry:nobel-background-2020:status", "registry:nobel-background-2021:status", "registry:nobel-background-2022:status", "registry:nobel-background-2023:status", "registry:nobel-background-2024:status", "registry:nobel-background-2025:status"]
  },
  {
    original_sha256: "70803b06e1110fd7908f2b598cc7ceac99c47fc1b4d1be5a3825977d386a5da2",
    plain: "This site offers only the canonical link (the source’s official web address) and the original research summary. The private source PDFs (original document files kept privately) are not provided here. Redistribution rights (permission to pass copies on to others) have not been verified.",
    ids: ["registry:nobel-background-2011:rightsStatus", "registry:nobel-background-2012:rightsStatus", "registry:nobel-background-2013:rightsStatus", "registry:nobel-background-2014:rightsStatus", "registry:nobel-background-2015:rightsStatus", "registry:nobel-background-2016:rightsStatus", "registry:nobel-background-2017:rightsStatus", "registry:nobel-background-2018:rightsStatus", "registry:nobel-background-2019:rightsStatus", "registry:nobel-background-2020:rightsStatus", "registry:nobel-background-2021:rightsStatus", "registry:nobel-background-2022:rightsStatus", "registry:nobel-background-2023:rightsStatus", "registry:nobel-background-2024:rightsStatus", "registry:nobel-background-2025:rightsStatus", "registry:nobel-background-2026:rightsStatus"]
  },
  {
    original_sha256: "e7aaa1813b6b99753cd418291a0f263627395e544706a7dece23bf0312758951",
    plain: "The original public research summaries were read in full through Library on 2026-10-16. So was the source registry (a list of research sources and their details). In this round of work, the primary source PDFs were not independently reread. Labels about downloads and reviews were kept from earlier work. They record reported provenance (where a source came from and how it was saved). They do not count as a current check. The same holds for the earlier work’s record of how deep its review went. That record says the review checked the bibliographic details (the facts used to cite a work) and relevance to the topic. The record also says the introduction was read in a targeted way (aimed at particular points in the text). The record adds that the review was not a full critical review (a close test of the work’s methods and claims). Nor did it include replication (redoing the study to check that its results hold).",
    ids: ["registry:nobel-background-2011:verificationScope", "registry:nobel-background-2013:verificationScope", "registry:nobel-background-2014:verificationScope", "registry:nobel-background-2015:verificationScope", "registry:nobel-background-2017:verificationScope", "registry:nobel-background-2018:verificationScope", "registry:nobel-background-2019:verificationScope", "registry:nobel-background-2020:verificationScope", "registry:nobel-background-2021:verificationScope", "registry:nobel-background-2022:verificationScope", "registry:nobel-background-2023:verificationScope", "registry:nobel-background-2024:verificationScope", "registry:nobel-background-2025:verificationScope"]
  },
  {
    original_sha256: "932f4029ab8e2c61803f9cde4d68e697548dd7efe1ccb7ca1d8062000a5f3c71",
    plain: "The original public research summaries were read in full through Library on 2026-10-16. So was the source registry (a list of research sources and their details). In this round of work, the primary source PDFs were not independently reread. Labels about downloads and reviews were kept from earlier work. They record reported provenance (where a source came from and how it was saved). They do not count as a current check. The same holds for the earlier work’s record of how deep its review went. That record says the review checked the cover and the title. The record also says OCR (software that turns page images into text) was run on the introductory page. OCR of the full text is required before detailed retrieval (looking up specific details in the document).",
    ids: ["registry:nobel-background-2012:verificationScope", "registry:nobel-background-2016:verificationScope"]
  },
  {
    original_sha256: "346b5dcd2c3e62397cd5f9af5b33f969860de31038725f0a04f86d058e9cff48",
    plain: "The metadata supplied for 2026 (descriptive details about that year’s award) is withheld. A current check against the primary source (the source’s own original document) could not be done. No claim is made about who the laureates are (the people awarded the prize). No conclusion specific to the prize is stated either.",
    ids: ["registry:nobel-background-2026:verificationScope"]
  }
];

export const plainLanguage = Object.freeze(Object.fromEntries(groups.flatMap(({ids, plain, original_sha256}) => {
  const entry = Object.freeze({plain, original_sha256});
  return ids.map(id => [id, entry]);
})));
