# Payment Processing Strategy: Freakie Dogs Delivery Platform
## El Salvador → LATAM Expansion | March 2026

---

## The Hard Truth About El Salvador

Before ranking partners, you need to understand the fundamental constraint: **El Salvador is a Tier 3 market for global payment processors.** Stripe doesn't natively support it. Adyen doesn't support it. Most best-in-class marketplace tools are unavailable with a pure Salvadoran entity. This is the single biggest architectural decision you face — not which processor to pick, but **which entity structure to process through.**

There are two paths:

**Path A — US LLC + Global Processor (Stripe/Adyen):** Form a US LLC (Delaware or Wyoming), open a US bank account (Mercury, Relay, or similar), and process payments through Stripe Connect or Adyen for Platforms. Your Salvadoran S.A. de C.V. operates the restaurants; your US LLC operates the platform and payment flows. This is what Rappi, iFood, and every serious LATAM delivery platform does.

**Path B — Local/Regional Processor (Pagadito + dLocal):** Stay fully Salvadoran, use Pagadito for card acceptance and dLocal for marketplace payouts. Simpler corporate structure but far fewer marketplace features, worse APIs, and higher blended rates.

**My recommendation: Path A.** If you're building a $100M payments business, you need Stripe Connect or Adyen for Platforms — full stop. The US LLC costs ~$500 via Stripe Atlas and unlocks the entire modern payments stack.

---

## TOP 5 PAYMENT PARTNERS — RANKED

### #1: STRIPE CONNECT (via US LLC) — Best Overall

**Why it wins:** Stripe Connect is purpose-built for exactly your model — a delivery platform that collects payments from customers, takes a cut, and pays out restaurants. No other platform matches its marketplace tooling depth.

**Availability in El Salvador:** Not directly available. Requires a US LLC (or UK Ltd). Stripe Atlas will form your Delaware LLC, open a bank account, and get you processing in ~5 business days. Approximately 27 e-commerce stores in El Salvador already use Stripe through this kind of workaround structure.

**Pricing (realistic):**
- Standard card processing: 2.9% + $0.30 per transaction
- Connect platform fee: $2/active connected account/month + 0.25% per payout
- Cross-border surcharge: +1% if card is non-US issued (this will hit you on Salvadoran cards)
- Dispute fee: $15 per chargeback
- Instant payouts: +1% (optional)
- **Realistic blended rate for your model: 3.5–4.2%** at launch (the cross-border surcharge on local cards is the killer)
- **Negotiated rate at $200K/month: 2.7–3.2%** (achievable, see negotiation section)

**Marketplace Capabilities:**
- Split payments: Native, automatic, multi-party splits
- Sub-merchant onboarding: Express accounts (Stripe-hosted KYC) or Custom accounts (your own KYC flow)
- Payout scheduling: Daily, weekly, manual, or instant
- 1099/tax reporting: Built-in for US (less relevant for SV, but signals maturity)
- Application fees: Set your take rate per transaction automatically
- White-label: Custom accounts let you fully white-label the experience

**Scaling to $1M+/month:** Trivial. Stripe processes hundreds of billions annually. Their infrastructure is the gold standard.

**Pros:**
- Best-in-class marketplace/split payment APIs
- Stripe Atlas makes the US LLC setup seamless
- Revenue monetization built in (application_fee on every transaction)
- Handles KYC, compliance, and onboarding for sub-merchants
- Path to PayFac-lite: Stripe treats you as a "platform" which is effectively PayFac without the regulatory burden
- Fraud tools (Radar) included
- Excellent documentation and developer experience

**Cons:**
- Cross-border fee on Salvadoran cards increases blended cost
- Settlement lands in a US bank account — you'll need to wire funds to El Salvador
- Payout to Salvadoran restaurant bank accounts requires ACH → wire or a local payout layer (dLocal can fill this gap)
- If Stripe detects your model is "local-only" with no US nexus, they may flag the account. Structure matters.

---

### #2: ADYEN FOR PLATFORMS — Best for Scale ($1M+/month)

**Why it ranks #2:** Adyen has the best technology in payments, period. Their IC++ pricing is the most transparent in the industry and gets cheaper the bigger you get. But their minimum volume expectations and enterprise focus make them a poor fit at $200K/month — they're your upgrade path at $500K+.

**Availability in El Salvador:** Not directly supported. Same US LLC workaround applies.

**Pricing (realistic):**
- IC++ model: Interchange (varies, ~1.5–2.0% for LATAM cards) + scheme fees (~0.15%) + Adyen markup
- Published Adyen markup: $0.13 + 0.60% per transaction
- Negotiated markup at volume: As low as 0.25% + $0.10 at $8M+/month
- **Realistic blended at $200K/month: 3.0–3.8%**
- **At $1M+/month: 2.5–3.0%** (this is where Adyen shines)

**Marketplace Capabilities:**
- Full split payment support via Adyen for Platforms
- Sub-merchant onboarding with KYC/KYB flows
- Multi-party payouts
- Balance accounts for holding funds
- Flexible payout schedules

**Scaling to $1M+/month:** This is Adyen's sweet spot. They serve Uber, eBay, Spotify.

**Pros:**
- IC++ transparency — you see exactly where every cent goes
- Pricing gets dramatically better at scale (volume tiers reduce markup)
- Enterprise-grade reliability and global reach
- Strong LATAM acquiring relationships
- In-person payment (POS) terminals available for physical restaurant locations

**Cons:**
- De facto minimum volume: Adyen prefers merchants processing $500K+/month
- Slower onboarding (weeks, not days)
- More complex integration than Stripe
- Spreadsheet-style reporting feels dated
- Less startup-friendly support culture

---

### #3: dLOCAL — Best Regional Complement / Payout Layer

**Why it ranks #3:** dLocal is the only major processor with native El Salvador support for both pay-ins and bank transfer payouts. It won't replace Stripe as your primary marketplace engine, but it solves the "last mile" problem of getting money into Salvadoran bank accounts.

**Availability in El Salvador:** Directly supported for payouts (bank transfers). Pay-ins via cards are available. dLocal has local entities and direct connections to acquirers throughout LATAM.

**Pricing (realistic):**
- Transaction fees: Percentage per approved transaction (typically 3.5–5.0% for smaller merchants in Central America)
- FX spread: Additional spread on currency conversion if applicable
- Setup fee: Negotiable, often waived
- Monthly management fee: Exists but negotiable
- Chargeback fee: Additional
- **Realistic blended: 3.5–5.0%** as standalone; much lower when used only for payouts

**Marketplace Capabilities:**
- "dLocal for Platforms" offers sub-account management, split payments, and automated payouts
- Multi-party splits between marketplace and sub-accounts
- Mass payout APIs for paying restaurants via local bank transfer
- Supports B2C, B2B, and P2P payment flows in El Salvador
- KYC and onboarding flows for sub-merchants

**Scaling to $1M+/month:** Designed for it. dLocal is publicly traded (NASDAQ: DLO) and handles billions in volume.

**Pros:**
- Native El Salvador support — no entity workaround needed for payouts
- Established bank transfer payout infrastructure to Salvadoran banks
- Covers 40+ emerging markets if you expand beyond LATAM
- "dLocal for Platforms" specifically designed for marketplaces
- Smart Routing and Smart Chaining improve authorization rates
- Good for the "Stripe for processing + dLocal for payouts" hybrid

**Cons:**
- Higher fees than Stripe/Adyen at equivalent volume
- Opaque pricing (must negotiate with sales team)
- Less developer-friendly documentation
- Primarily serves enterprise/cross-border merchants — may require minimum commitment
- Split payment features less mature than Stripe Connect

---

### #4: PAGADITO — Best Local Option for Day-1 Processing

**Why it ranks #4:** Pagadito is headquartered in San Salvador. They are the only PCI DSS Level 1 certified non-bank payment processor native to Central America. If you need to start processing cards tomorrow from a Salvadoran entity with no offshore structure, Pagadito is your only real option.

**Availability in El Salvador:** Fully native. Headquartered there. Founded in 2010 in San Salvador. Supports El Salvador, Guatemala, Honduras, Nicaragua, Costa Rica, Panama, Dominican Republic, Puerto Rico, and USA.

**Pricing (realistic):**
- Transaction fees: 3–5% per transaction (set after risk analysis of your business)
- No monthly fees
- No setup fees
- Withdrawal fees: Vary by country
- **Realistic blended: 3.5–5.0%**
- **Negotiated with $200K/month volume: Likely 3.0–3.5%** (you'd be among their largest merchants)

**Marketplace Capabilities:**
- B2B2C solution advertised as suitable for marketplaces and gig economy apps
- Pagalink (payment links) for invoicing restaurants
- Card-on-file / tokenization for repeat customers
- QR code payments
- **No true split-payment API comparable to Stripe Connect** — you'd need to build the splitting and payout logic yourself
- Bitcoin payment acceptance (relevant given El Salvador's legal tender status)

**Scaling to $1M+/month:** Questionable. Pagadito processes for the Central American market which is relatively small. Their infrastructure may not match the reliability needed at high scale.

**Pros:**
- Zero friction to get started from El Salvador
- No entity workaround needed
- PCI DSS Level 1 certified
- Understands local market, local cards, local regulations
- No monthly fees — pure pay-per-transaction
- Bitcoin acceptance built in
- Accepts payments from 40+ countries

**Cons:**
- No real marketplace/split payment infrastructure
- API and developer documentation are basic (WordPress plugin reviews mention poor developer support)
- Scaling concerns — small team, regional focus
- Can't white-label or build a PayFac on top of it
- Higher base rates than global processors
- You'd outgrow them quickly if the platform takes off

---

### #5: KUSHKI — Best LATAM-Native with Growth Potential

**Why it ranks #5:** Kushki is LATAM's first non-bank regional acquirer with Visa and Mastercard primary membership in multiple countries. They have marketplace/split payment features and are aggressively expanding. The catch: they don't yet operate in El Salvador (current markets are Mexico, Chile, Peru, Colombia, Ecuador). However, they have publicly stated interest in Central American expansion.

**Availability in El Salvador:** Not yet available. Kushki has expressed interest in Central American markets but has not confirmed a launch date. Their current operational markets are Mexico, Chile, Peru, Colombia, and Ecuador.

**Pricing (realistic):**
- Transaction fees: Custom pricing, typically 2.5–3.5% for card payments
- Split payment functionality available (commission-based splits)
- **Realistic blended: 2.8–3.5%** (competitive with Stripe in LATAM markets where they operate)

**Marketplace Capabilities:**
- Split payment mode available (divides payment between main merchant and commission recipient)
- Unified gateway across multiple LATAM countries
- Tokenization and one-click payments
- POS terminals in Mexico and Chile
- Payout APIs for bank transfers

**Scaling to $1M+/month:** Can handle it. Kushki processes 75K transactions per second with 99.99% uptime. Raised $200M in funding. Serves Rappi and Claro.

**Pros:**
- LATAM-native — built for the region's payment quirks
- Non-bank acquirer status means direct card network connections (lower interchange)
- Split payments for marketplace models
- If they expand to Central America, they'd be the best single-provider solution
- Competitive pricing — can undercut Stripe in markets where they operate
- Built to serve platforms (Rappi is a customer)

**Cons:**
- Not available in El Salvador yet — timeline uncertain
- Newer company (founded 2017), still proving operational resilience
- Five-market footprint limits your near-term coverage
- Less mature documentation and developer experience than Stripe
- Support quality varies by market

---

## THE OPTIMAL SETUP

### Recommended Architecture: Stripe Connect + dLocal Hybrid

```
                    ┌─────────────────────┐
                    │   CUSTOMER (SV)     │
                    │  Pays via card/      │
                    │  digital wallet      │
                    └─────────┬───────────┘
                              │
                    ┌─────────▼───────────┐
                    │  STRIPE CONNECT     │
                    │  (US LLC entity)    │
                    │                     │
                    │  • Card acceptance  │
                    │  • Split logic      │
                    │  • Application fee  │
                    │  • Fraud (Radar)    │
                    │  • KYC/onboarding   │
                    └──┬──────────────┬───┘
                       │              │
              ┌────────▼────┐   ┌─────▼─────────────┐
              │ PLATFORM    │   │ dLOCAL PAYOUTS    │
              │ REVENUE     │   │                   │
              │ (US bank)   │   │ • Bank transfers  │
              │             │   │   to SV accounts  │
              │ Your take   │   │ • Restaurant      │
              │ rate lands  │   │   settlements     │
              │ here        │   │ • Mass payouts    │
              └─────────────┘   └───────────────────┘
```

**Phase 1 (Month 1–3): Launch**
- Form US LLC via Stripe Atlas ($500)
- Set up Stripe Connect with Express accounts for your owned restaurants
- Process the $200K/month internal volume to build history
- Use Pagadito as a fallback for any cards that decline on Stripe (local acquiring advantage)

**Phase 2 (Month 3–6): Third-Party Restaurants**
- Enable Stripe Connect Express accounts for third-party restaurants
- Build KYC flow (can be as simple as Stripe's hosted onboarding)
- Set application_fee at 2.5–3.0% per transaction (your take rate)
- Integrate dLocal's payout API for settling funds to Salvadoran bank accounts

**Phase 3 (Month 6–12): Monetization**
- Your restaurants pay ~3.5% blended (Stripe cost) — you subsidize this from delivery fees
- Third-party restaurants pay 5.5–6.0% (3.5% Stripe cost + your 2.0–2.5% margin)
- Frame it as "we handle all payment processing" not "we charge you 6%"
- Revenue at $1M/month with 2% net margin on payments = $20K/month pure margin

**Phase 4 (Month 12+): Scale & Optimize**
- Renegotiate Stripe rates with proven volume ($1M+/month gets serious leverage)
- Evaluate Adyen for Platforms if volume exceeds $2M/month (lower blended cost)
- Consider Kushki if they launch in Central America (could replace Stripe for local acquiring)
- Explore adding Pagadito as a secondary gateway for local card fallback routing

---

## PayFac vs ISO vs Aggregator: WHICH PATH?

### The Three Models Explained

**Aggregator (Start Here):** You process all transactions under your single merchant account (the US LLC). Third-party restaurants are sub-merchants under your umbrella. Stripe Connect effectively makes you an aggregator with PayFac-like capabilities. This is your Phase 1–2 model.

**Payment Facilitator (PayFac):** You become a registered PayFac with Visa/Mastercard, allowing you to board and underwrite sub-merchants yourself. This gives you more control and better economics but requires significant capital ($500K–$1M+), PCI DSS Level 1 certification, a sponsor bank relationship, and ongoing compliance infrastructure.

**ISO (Independent Sales Organization):** You resell a processor's services under your brand. Less regulatory burden than PayFac but also less control and lower margins.

### My Recommendation: Stay as a Stripe Connect Platform

Don't become a full PayFac. Here's why:

The traditional PayFac path requires a minimum of $500K–$1M in capital reserves, a formal sponsor bank relationship, PCI DSS Level 1 audit ($50K–$200K/year), dedicated compliance staff, and typically takes 6–12 months to get approval. Stripe Connect gives you 80% of the PayFac benefits at 5% of the cost and complexity:

| Capability | Full PayFac | Stripe Connect Platform |
|---|---|---|
| Board sub-merchants | ✅ You do it | ✅ Stripe-hosted or custom |
| Set your own pricing | ✅ Full control | ✅ Via application_fee |
| Underwrite merchants | ✅ You own risk | ✅ Stripe handles it |
| Hold/release funds | ✅ Full control | ✅ Via payout scheduling |
| Compliance burden | 🔴 Massive | 🟢 Stripe absorbs most |
| Time to launch | 🔴 6–12 months | 🟢 Days |
| Capital requirement | 🔴 $500K–$1M | 🟢 ~$500 (Atlas) |

The only reason to go full PayFac is if you're processing $50M+/month and the 10–15 basis points you'd save justifies the overhead. At your stage, it doesn't.

---

## NEGOTIATION LEVERAGE & TACTICS TO GET BELOW 3%

### Your Leverage at $200K/Month

$200K/month is ~$2.4M/year. This puts you in the "SMB-plus" tier — you're too big for standard pricing but too small for true enterprise negotiation. Here's how to maximize leverage:

**What you have:**
- Predictable, recurring volume (restaurants = consistent spending)
- Low chargeback risk (delivery platforms have clear delivery confirmation)
- High average ticket relative to e-commerce ($15–30 per order reduces per-transaction cost impact)
- Growth story: $200K today → $1M+ within 12 months (processors price for projected volume)
- Multi-country expansion plan (El Salvador → Mexico adds volume and makes you strategically interesting)

### Seven Tactics to Reduce Fees

**1. Lead with projected volume, not current volume.**
Don't negotiate based on $200K/month. Present a 12-month projection showing $1M/month by month 12. Processors will price based on where you're going, not where you are, if you commit to minimum volume thresholds.

**2. Get competing quotes.**
Get formal proposals from Stripe, Adyen, and dLocal simultaneously. Show each the others' proposals. This alone will get you 20–30 basis points off standard pricing.

**3. Negotiate the cross-border surcharge.**
For Stripe, the +1% cross-border fee on Salvadoran cards is your biggest cost driver. Push for a waiver or reduction. Argue that your US LLC is the platform entity but all transactions are local to El Salvador — you shouldn't pay cross-border rates for domestic commerce.

**4. Commit to volume floors.**
Offer a minimum monthly commitment ($150K/month guaranteed) in exchange for better rates. Processors love volume commitments because it reduces their risk of onboarding you for nothing.

**5. Reduce interchange through card type optimization.**
Push customers toward debit cards over credit cards (lower interchange). In El Salvador, debit card usage is growing faster than credit. The interchange difference can be 0.5–1.0%.

**6. Negotiate payout frequency.**
Accept weekly or bi-weekly settlements instead of daily. This reduces the processor's float cost and they'll sometimes pass savings to you. At $200K/month, switching from daily to weekly payouts can save 10–15 basis points.

**7. Bundle services for leverage.**
If you're using Stripe, commit to Stripe Terminal (POS for physical locations), Stripe Billing (subscriptions), or Stripe Tax. Bundling multiple products gives the account team justification to offer better processing rates.

### Realistic Target Rates

| Volume Tier | Stripe Blended | Adyen Blended | dLocal Blended |
|---|---|---|---|
| $200K/month (launch) | 3.2–3.5% | 3.5–4.0% | 3.5–4.5% |
| $500K/month | 2.8–3.0% | 2.8–3.2% | 3.0–3.5% |
| $1M/month | 2.5–2.8% | 2.3–2.7% | 2.5–3.0% |
| $5M/month | 2.2–2.5% | 1.8–2.2% | 2.0–2.5% |

**The crossover point:** At ~$2M/month, Adyen becomes cheaper than Stripe due to IC++ pricing. Below that, Stripe's simplicity and marketplace tooling make it the better choice even at marginally higher cost.

---

## FINAL STRATEGIC RECOMMENDATIONS

### If You're Building a $100M Payments Business

**Year 1:** Stripe Connect via US LLC. Process internal volume. Onboard 50–100 third-party restaurants. Prove the model. Target 2.5% net margin on payments.

**Year 2:** Expand to Mexico (Stripe supports Mexico natively). Add Kushki as a secondary processor if available. Hit $5M+/month. Renegotiate Stripe to sub-2.5%. Your payment processing revenue alone should be $100K+/month.

**Year 3:** Evaluate Adyen for Platforms migration for better economics. Consider becoming an ISO with a sponsor bank to white-label payment processing to other delivery platforms in Central America. At $10M+/month, you have real negotiating power.

**Year 5+:** If processing $50M+/month, pursue full PayFac registration. At this scale, owning the payment stack saves millions annually and becomes a moat against competitors.

### The Bottom Line

Your optimal Day 1 stack is: **Stripe Connect (US LLC) + dLocal (payouts to SV banks) + Pagadito (fallback local acquiring)**. This gives you best-in-class marketplace tools, local payout capability, and a fallback for cards that decline on cross-border processing. Total cost will be 3.2–3.5% blended, dropping to sub-3% within 12 months as you negotiate on proven volume.

Don't overcomplicate it. The biggest risk isn't picking the wrong processor — it's spending 6 months evaluating processors instead of processing payments. Launch with Stripe, optimize later.

---

*Analysis prepared March 2026. Pricing and availability should be confirmed directly with each provider as they change frequently.*
