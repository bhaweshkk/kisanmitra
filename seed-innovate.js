/**
 * seed-innovate.js — Run ONCE to seed initial companies & startup ideas
 * 
 * Usage:  node seed-innovate.js
 * 
 * This seeds MongoDB Atlas collections for innovate companies and ideas.
 * After seeding, data is stored in the connected MongoDB cluster.
 * 
 * Run from your project root:  node seed-innovate.js
 */

const { loadEnv } = require('./lib/env');
const { connectDB, collection } = require('./db');

loadEnv();

async function runSeed() {
  await connectDB();

  const companies = collection('innovate_companies');
  const ideas = collection('innovate_ideas');

  // ── Clear existing data first ──────────────────────────────────
  console.log('Clearing existing innovate data...');
  const existingCompanies = await companies.find({});
  for (const c of existingCompanies) {
    await companies.removeById(c._id);
  }
  const existingIdeas = await ideas.find({});
  for (const i of existingIdeas) {
    await ideas.removeById(i._id);
  }

// ── Seed Companies ─────────────────────────────────────────────
const COMPANIES = [
  {
    name: 'DeHaat',
    tagline: 'End-to-end agri platform connecting 1M+ farmers',
    shortDesc: 'DeHaat connects farmers to agri-inputs, advisory services, and output markets through a single platform. It operates a hub-and-spoke model with micro-entrepreneurs as the last-mile.',
    sector: 'AgriTech Platform',
    category: 'platform',
    founded: '2012',
    location: 'Patna, Bihar',
    founders: ['Shashank Kumar', 'Amrendra Singh'],
    funding: '$200M+',
    farmersImpacted: '1M+',
    employees: '5000+',
    states: '10+',
    website: 'https://agrevolution.in',
    emoji: '🌾',
    bannerColor: 'linear-gradient(135deg,#064e3b,#065f46,#10b981)',
    stage: 'Series E',
    model: 'DeHaat operates through 10,000+ micro-entrepreneur (ME) centers. Each ME serves 200–400 farmers providing seeds, fertilizers, pesticides, and crop advisory. The platform earns margins on input sales, advisory subscriptions, and commission on output procurement.',
    innovation: 'AI-powered crop advisory in 8 regional languages. Satellite-based crop health monitoring. WhatsApp-native farmer interface — no app download needed.',
    lessons: [
      'Trust over technology — farmers need to trust you before they use your app',
      'Last-mile distribution is the real moat, not the app itself',
      'Micro-entrepreneurs as partners, not just distributors',
      'Work with state governments, not against them',
    ],
    forStarters: 'You can become a DeHaat micro-entrepreneur center in your district with just ₹50,000 investment. They train you, provide supply chain, and you earn margin on every sale. Visit agrevolution.in/become-a-center.',
    story: [
      { year: '2012', event: 'Founded in Patna with a mission to solve last-mile agri distribution', icon: '🚀', color: '#059669' },
      { year: '2014', event: 'Launched first 100 DeHaat micro-entrepreneur centers in Bihar & UP', icon: '🏪', color: '#2563eb' },
      { year: '2018', event: 'Raised Series A from Omnivore Partners — first institutional funding', icon: '💰', color: '#f59e0b' },
      { year: '2020', event: 'Crossed 300,000 farmers on platform during COVID-19', icon: '📱', color: '#059669' },
      { year: '2021', event: 'Series C at $115M — expanded to Odisha, WB, MP', icon: '🌍', color: '#ef4444' },
      { year: '2024', event: '1 million active farmers, ₹2000Cr+ GMV, 10 states', icon: '🏆', color: '#f59e0b' },
    ],
    certifications: ['DPIIT Recognized Startup', 'ISO 9001:2015', 'RBI Regulated NBFC', 'Multiple State Govt. MoUs'],
    tags: ['Input Supply', 'Advisory', 'Output Markets', 'Fintech'],
    authenticityScore: 97,
    auditor: 'KPMG India',
    verified: true,
    status: 'published',
    createdAt: Date.now(),
  },
  {
    name: 'Ninjacart',
    tagline: "India's largest fresh produce supply chain startup",
    shortDesc: 'Ninjacart builds farm-to-business supply chains for fresh fruits and vegetables, eliminating 2–3 middlemen layers and delivering fresher produce at better prices.',
    sector: 'Supply Chain & Logistics',
    category: 'supplychain',
    founded: '2015',
    location: 'Bengaluru, Karnataka',
    founders: ['Thirukumaran Nagarajan', 'Sharath Loganathan'],
    funding: '$350M+',
    farmersImpacted: '250K+',
    employees: '4000+',
    states: '8',
    website: 'https://ninjacart.com',
    emoji: '🥬',
    bannerColor: 'linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)',
    stage: 'Series D',
    model: 'Ninjacart procures directly from farmers at 8–12% premium over mandi prices. Processes, grades, and delivers within 12 hours to retailers, restaurants, and cloud kitchens. Earns margin on logistics and processing.',
    innovation: 'AI-driven demand forecasting reduces over-procurement by 40%. IoT temperature monitoring across cold chain. Mobile app for farmers to receive same-day payment.',
    lessons: [
      'B2C agri is very hard — B2B is where the money flows',
      'Fresh produce requires 12-hour windows — speed is everything',
      'Farmer payment in 24 hours is your biggest marketing tool',
      'Cold chain is infrastructure — invest early',
    ],
    forStarters: 'Ninjacart is always looking for local produce aggregators. If you are near a farming cluster, register as a procurement partner, aggregate 5–10 tonnes per week, and earn ₹8–12/kg margins.',
    story: [
      { year: '2015', event: 'Started as B2C grocery app — failed in 6 months', icon: '❌', color: '#ef4444' },
      { year: '2015', event: 'Pivoted to B2B supply chain after realizing the fresh produce wastage problem', icon: '🔄', color: '#f59e0b' },
      { year: '2019', event: 'Walmart-owned Flipkart invested $100M — became strategic partner', icon: '🤝', color: '#2563eb' },
      { year: '2022', event: 'Achieved Unicorn status, launched cold chain infrastructure', icon: '🦄', color: '#f59e0b' },
      { year: '2024', event: 'Processing 1400+ tonnes of fresh produce daily with <0.5% wastage', icon: '🏆', color: '#10b981' },
    ],
    certifications: ['DPIIT Startup India', 'Walmart-backed', 'ISO 22000:2018 Food Safety', 'FSSAI Licensed'],
    tags: ['Supply Chain', 'Fresh Produce', 'B2B', 'Cold Chain'],
    authenticityScore: 95,
    auditor: 'Deloitte India',
    verified: true,
    status: 'published',
    createdAt: Date.now() - 1000,
  },
  {
    name: 'AgroStar',
    tagline: 'Farmer first. Science first.',
    shortDesc: 'AgroStar is a mobile-first platform for agri-inputs with 24-hour delivery to farms, combining a massive agronomy helpline with e-commerce.',
    sector: 'Input E-commerce & Advisory',
    category: 'platform',
    founded: '2013',
    location: 'Ahmedabad, Gujarat',
    founders: ['Sitanshu Sheth', 'Shardul Sheth'],
    funding: '$100M+',
    farmersImpacted: '7M+',
    employees: '2000+',
    states: '10',
    website: 'https://agrostar.in',
    emoji: '⭐',
    bannerColor: 'linear-gradient(135deg,#3b0764,#4c1d95,#5b21b6)',
    stage: 'Series D',
    model: '25–35% margin on branded agri-inputs. Premium subscription ₹999/season for dedicated agronomist. White-label private brand inputs at higher margins.',
    innovation: 'AI-powered "Ask AgroStar" diagnoses any crop problem from image in <10 seconds. Counterfeit detection using QR codes on every product. Same-day delivery to 80,000+ villages.',
    lessons: [
      'Counterfeit inputs kill farmer income — authenticity is the foundation of trust',
      'Science-backed advice creates loyal customers, not discounts',
      'Same-day delivery in rural India is possible and is a massive differentiator',
      'Content (YouTube, WhatsApp) is the cheapest farmer acquisition channel',
    ],
    forStarters: 'AgroStar offers a "Saathi" program — become a rural entrepreneur selling AgroStar products and advisory in your area. ₹1L investment, 20–25% product margin, full training provided.',
    story: [
      { year: '2013', event: 'Sitanshu quits McKinsey to solve farmer input quality problem in Gujarat', icon: '💡', color: '#7c3aed' },
      { year: '2016', event: 'Launched mobile app with free agronomy helpline — 1 lakh downloads in year 1', icon: '📱', color: '#2563eb' },
      { year: '2020', event: 'Became largest direct-to-farm input platform — 5M farmers served', icon: '🏆', color: '#059669' },
      { year: '2024', event: '7M+ farmers, ₹1500Cr GMV, 10 states, 400+ agronomists on call', icon: '🏆', color: '#f59e0b' },
    ],
    certifications: ['DPIIT Startup India', 'ISO 9001:2015', 'SEBI AIF Backed'],
    tags: ['Input E-commerce', 'Agronomy', 'App', 'Gujarat/Rajasthan/MP'],
    authenticityScore: 96,
    auditor: 'KPMG India',
    verified: true,
    status: 'published',
    createdAt: Date.now() - 2000,
  },
  {
    name: 'SatSure',
    tagline: 'Satellite data intelligence for agriculture and finance',
    shortDesc: 'SatSure uses satellite imagery and AI to assess crop health of any farm in India — without visiting it — unlocking credit and insurance for millions of unbanked farmers.',
    sector: 'Agri-Data & Remote Sensing',
    category: 'deeptech',
    founded: '2017',
    location: 'Bengaluru / Zürich',
    founders: ['Prateep Basu', 'Rashmit Singh Sukhmani'],
    funding: '$30M',
    farmersImpacted: '5M+ (via banks)',
    employees: '180',
    states: '12',
    website: 'https://satsure.co',
    emoji: '🛰️',
    bannerColor: 'linear-gradient(135deg,#0c1a2e,#1a237e,#283593)',
    stage: 'Series B',
    model: 'SaaS subscriptions to banks, insurance companies, and governments. Pricing per-farm-assessed. Average contract is $200K–$2M annually with major financial institutions.',
    innovation: 'Proprietary ML models trained on 7 years of Indian satellite imagery. Can predict crop yield within 8% accuracy 45 days before harvest. Synthetic Aperture Radar penetrates clouds — works during monsoon.',
    lessons: [
      'Enterprise agri-tech has 6–18 month sales cycles — need capital patience',
      'Government partnerships are slow but create enormous moats',
      'Deep tech needs a problem-first, not technology-first approach',
      'The real market is in Bharat, not Silicon Valley',
    ],
    forStarters: 'If you have data science or remote sensing skills, ISRO provides free satellite imagery via the Bhuvan portal. Build an MVP crop monitoring tool and approach cooperative banks in your state.',
    story: [
      { year: '2017', event: 'Two IITians decide to solve agri credit gap using satellites', icon: '🛰️', color: '#2563eb' },
      { year: '2018', event: 'First pilot with SBI to assess 50,000 farmer loan applications using satellite data', icon: '🏦', color: '#059669' },
      { year: '2020', event: 'European Space Agency incubation, opened Zürich office', icon: '🌍', color: '#7c3aed' },
      { year: '2024', event: 'Monitoring 5M+ farmer plots, processing 2TB satellite data daily', icon: '🏆', color: '#f59e0b' },
    ],
    certifications: ['ISRO Partner', 'ESA BIC Switzerland', 'NASSCOM Deep Tech Club', 'ISO 27001 Data Security'],
    tags: ['Satellite', 'AI/ML', 'Crop Insurance', 'Fintech'],
    authenticityScore: 94,
    auditor: 'PWC India',
    verified: true,
    status: 'published',
    createdAt: Date.now() - 3000,
  },
  {
    name: 'Jai Kisan',
    tagline: 'Rural fintech enabling credit for every farmer',
    shortDesc: 'Jai Kisan provides Buy Now Pay Later credit for agri-inputs, instant Kisan Credit Card digitization, and working capital loans — all in under 2 minutes using mobile.',
    sector: 'Agri-Fintech',
    category: 'fintech',
    founded: '2017',
    location: 'Mumbai, Maharashtra',
    founders: ['Arjun Ahluwalia', 'Adriel Maniego'],
    funding: '$55M+',
    farmersImpacted: '400K+',
    employees: '500+',
    states: '10',
    website: 'https://jaikisan.co',
    emoji: '💳',
    bannerColor: 'linear-gradient(135deg,#78350f,#92400e,#b45309)',
    stage: 'Series B',
    model: 'Earns interest income (16–22% APR) on agri loans. Earns dealer fees from agri-input companies who want their products financed. Revenue share with banks who co-lend capital.',
    innovation: 'Alternative credit scoring using 150+ data points — no bank statement required. Vernacular voice-based KYC in 9 languages. Integration with land records of 15 states.',
    lessons: [
      'Rural credit is not charity — 1.8% NPA proves farmers repay better than urban borrowers',
      'Alternate data beats traditional CIBIL score for farmers',
      'Input dealer as distribution channel — reach 10M farmers through 500K dealers',
      'Government schemes like KCC are distribution infrastructure — ride on them',
    ],
    forStarters: 'Apply to become a Business Correspondent of Jai Kisan or any rural bank. You earn 1–2% of each loan disbursed as commission, doing KYC and collection in your village.',
    story: [
      { year: '2017', event: 'Arjun spent 6 months in rural Maharashtra studying why banks reject 60% of farmer loans', icon: '🔍', color: '#f59e0b' },
      { year: '2020', event: 'COVID pivot — launched digital KCC with zero branch visits', icon: '📱', color: '#2563eb' },
      { year: '2023', event: 'Series B $30M, ₹500Cr AUM, 400,000 active credit customers', icon: '🏆', color: '#10b981' },
    ],
    certifications: ['RBI NBFC Licensed', 'DPIIT Startup India', 'Bharat Inclusion Initiative Fellow'],
    tags: ['Credit', 'BNPL', 'Rural Finance', 'KCC'],
    authenticityScore: 92,
    auditor: 'EY India',
    verified: true,
    status: 'published',
    createdAt: Date.now() - 4000,
  },
];

// ── Seed Ideas ─────────────────────────────────────────────────
const IDEAS = [
  {
    icon: '🌿', color: '#059669', order: 1,
    title: 'Organic Certification Consultant',
    desc: 'Help 10–20 farmers per district get NPOP / PGS-India certification. Govt subsidy covers 75% of cost. Earn ₹15,000–25,000 per farmer as facilitation fee.',
    effort: 'Low Capital', earn: '₹3–8L/year', time: '3–6 months to first income',
  },
  {
    icon: '🚜', color: '#f59e0b', order: 2,
    title: 'Custom Hiring Centre (CHC)',
    desc: 'PM-KISAN CHC scheme gives 40–80% subsidy on farm equipment. Start a tractor+harvester rental service for small farmers who cannot afford equipment.',
    effort: '₹5–15L Capex', earn: '₹8–20L/year', time: 'Profitable in year 1',
  },
  {
    icon: '❄️', color: '#2563eb', order: 3,
    title: 'Village Cold Storage Hub',
    desc: 'NABARD offers 35% capital subsidy for cold storage. A 10-tonne unit for ₹8L serves 50 farmers — they pay ₹1,500/month storage fees.',
    effort: '₹8–12L Capex', earn: '₹5–12L/year', time: '6–12 months setup',
  },
  {
    icon: '🛒', color: '#7c3aed', order: 4,
    title: 'Farm Fresh Subscription Box',
    desc: 'Curate weekly organic vegetable/fruit boxes from local farmers. 100 city subscribers at ₹700/week = ₹70,000/week revenue. Farmers get 40% premium.',
    effort: '₹50K–1L', earn: '₹15–40L/year', time: 'First revenue in 30 days',
  },
  {
    icon: '🍯', color: '#d97706', order: 5,
    title: 'Apiary & Honey Brand',
    desc: '50 beehive colonies produce 1 tonne honey/year. Branded raw honey at ₹600/500g sells 10x faster than unbranded. NHB registration gives national market access.',
    effort: '₹1.5–3L', earn: '₹8–15L/year', time: 'First harvest in 6 months',
  },
  {
    icon: '📱', color: '#059669', order: 6,
    title: 'Village AgriTech Kiosk',
    desc: 'Become a DeHaat/AgroStar/Gramophone partner center in your village. ₹1–2L investment, sell inputs + provide digital advisory. 15–25% margin on all products sold.',
    effort: '₹1–2L', earn: '₹5–15L/year', time: 'Revenue from day 1',
  },
  {
    icon: '🌾', color: '#b45309', order: 7,
    title: 'Stone Flour Mill + Direct Wheat Brand',
    desc: 'Stone flour mill at ₹3L processes 500kg/day. Buy wheat from farmers at MSP+10%, sell branded stone-ground atta to urban consumers at 3x market price.',
    effort: '₹3–5L', earn: '₹10–25L/year', time: '6 months to profitability',
  },
  {
    icon: '🐄', color: '#0077b6', order: 8,
    title: 'A2 Milk & Ghee Micro-Brand',
    desc: '10 Gir cows produce 100L/day. Direct-to-consumer at ₹120/L vs ₹50 mandi price. Convert 30L to ghee at ₹900/L per day — builds a powerful premium brand.',
    effort: '₹5–10L', earn: '₹20–50L/year', time: '3 months to brand',
  },
];

// ── Insert all data ────────────────────────────────────────────
  console.log('Seeding companies...');
  for (const c of COMPANIES) {
    await companies.insert(c);
    console.log('  ✅', c.name);
  }

  console.log('Seeding ideas...');
  for (const i of IDEAS) {
    await ideas.insert(i);
    console.log('  ✅', i.title);
  }

  console.log('\n✅ Seed complete!');
  console.log('Companies:', (await companies.find({})).length);
  console.log('Ideas:    ', (await ideas.find({})).length);
  console.log('\nNow start your server and visit /api/innovate/companies to verify.');
}

runSeed().catch(err => {
  console.error(err);
  process.exit(1);
});
