# Kisan Mitra 

KisanMitra aims to solve these issues by creating a centralized full-stack digital solution using modern, accessible, and lightweight technologies. KisanMitra is a full-stack agricultural web application developed to bridge the communication gap between Indian farmers and modern digital technology. The platform consolidates essential agricultural services including real-time weather updates, live mandi price tracking, AI-powered crop advisory, community networking, government scheme information, digital document management, and an online marketplace called KisanBazaar. It also features AgriInnovate, a section dedicated to sharing agricultural startup ideas and success stories.

The platform supports 11 regional Indian languages using the LibreTranslate API, making it accessible to farmers across diverse linguistic backgrounds. The backend is built using pure Node.js without any external frameworks, relying only on built-in modules. Multiple APIs including Groq (Llama 3), Open-Meteo, Agmarknet, and Razorpay are integrated to power its rich feature set. KisanMitra proves that technology can be used effectively to solve real agricultural challenges when designed around the actual needs of the end user.


OBJECTIVE OF THIS PROJECT:


To develop a centralized digital platform for farmers integrating weather, market, advisory, marketplace, and community services
To provide real-time weather forecasts using the Open-Meteo API to help farmers plan agricultural activities
To display live mandi prices via the Agmarknet API, eliminating information asymmetry and middlemen exploitation
To offer AI-powered crop advisory through KisanBot, powered by Groq API (Llama 3)
To enable direct farmer-to-buyer commerce through the KisanBazaar online marketplace with Razorpay integration
To support 11 regional Indian languages using LibreTranslate for broad accessibility
To allow farmers to store and manage farm documents digitally through secure cloud storage
To promote rural digital literacy and agri-entrepreneurship through the AgriInnovate section


Why is this Platform Important for Farmers?

Automatic Information Delivery: Weather and market data delivered in real time without farmer needing to search multiple portals
AI-Powered Decisions: KisanBot provides expert-level crop and pest advisory 24/7 at no cost
Market Transparency: Live mandi prices eliminate broker exploitation and help farmers maximize income
Language Inclusivity: 11 regional languages ensure no farmer is excluded due to English literacy barriers
Direct Commerce: KisanBazaar enables direct sales to consumers, removing supply chain intermediaries
Digital Empowerment: Community groups and AgriInnovate inspire farmers toward entrepreneurship


kisanmitra/
├── server.js                    ← main HTTP server + router (all API routes wired here)
├── db.js                        ← Postgres-backed generic collection() store (used by everything)
├── seed-innovate.js             ← run once to seed sample AgriInnovate companies/ideas
├── process-manager.js           ← process supervisor/restart logic
├── package.json / package-lock.json
├── apis.config.json             ← enable/disable AI providers (Groq, Gemini, etc.)
├── render.yaml                  ← Render.com deploy config
├── deploy.sh / start-server.sh / start-server.bat
├── env.example                  ← copy to .env and fill in (DATABASE_URL, AUTH_SECRET, etc.)
├── README.md
│
├── lib/                         ← backend modules, required by server.js
│   ├── auth.js                  ← register/login/token verify (admin auto-seeded: phone=admin)
│   ├── adminRoutes.js           ← admin: contacts, chatlogs, logs, db-stats, users
│   ├── apiRegistry.js           ← plugin/API registry system
│   ├── docRoutes.js             ← document upload/verification workflow
│   ├── env.js                   ← loads .env
│   ├── logger.js
│   ├── marketplaceRoutes.js     ← alt marketplace implementation (Razorpay payments)
│   ├── rateLimiter.js
│   ├── routes.js                ← chat, weather, mandi prices, news, contact
│   ├── staticServer.js          ← serves public/ (correctly serves .js as ES modules)
│   ├── validator.js             ← startup env checks
│   ├── db.js                    ⚠️ dead file — not required anywhere, root db.js is the real one
│   └── innovateRoutes.js        ⚠️ dead file — logic actually lives inline in server.js
│
└── public/                      ← static frontend, no bundler, served as-is
    ├── index.html                ← the whole app (nav, marketplace, groups, AgriInnovate UI, ~4900 lines)
    ├── kisanmitra-registration.html
    └── firebase-init.js          ← added: Firebase Analytics init (CDN ES module)
