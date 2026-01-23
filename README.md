# 📚 LibrarySpot

**Find available study rooms across all OSU libraries in one place.**

No more checking multiple websites or walking around campus looking for an open room. LibrarySpot aggregates real-time availability from Ohio State University libraries into a single, searchable dashboard.

## 📍 Supported Libraries & Rooms

| Library | Rooms | Data Source |
| --- | --- | --- |
| **18th Avenue Library** | 126, 128, 401+ | OSU API |
| **Thompson Library** | 040A, 045A-C, 051, 055 | OSU API |
| **FAES Library** | 045D, 045E, 045F, 045G, 045H | OSU API |
| **Health Sciences Library** | 360A-H | LibCal (Puppeteer) |

## ✨ Features

* **🏛️ All Libraries, One View** — See availability across 18th Avenue, Thompson, FAES, and Health Sciences
* **📅 8-Day Calendar** — View and plan reservations for today and the next 7 days
* **⏰ Real-Time Clock** — Displays current America/New_York time (client-ticking, server-synced when available)
* **🕐 30-Minute Slots** — Matches OSU's booking system intervals
* **🔍 Advanced Filtering** — Filter by specific time blocks or minimum consecutive free duration (up to 8 hours)
* **⚡ Live Data** — Fetches directly from OSU's room reservation API with background refreshing
* **📱 Mobile Friendly** — Works great on phones for on-the-go searching
* **🚀 Instant Load** — Data is "bootstrapped" into the initial HTML response to eliminate loading flickers
* **🔗 Direct Booking** — Health Sciences Library has direct LibCal booking link

## 🚀 Quick Start

### Docker (Recommended)

The project includes a multi-stage `Dockerfile` that builds the frontend and installs Chromium for Puppeteer scraping.

```bash
docker compose up -d --build

```

Open `http://localhost:3000`

### Manual Development

Run the backend and frontend separately:

```bash
# Install root deps
npm install

# Install server deps
cd server
npm install
cd ..

# Start backend (serves API + page)
node server/index.js
# Open http://localhost:3000

# In another terminal, start frontend dev server (optional)
npm run dev
# Open the URL Vite prints (usually http://localhost:5173)

```

> Note: Health Sciences Library scraping uses Puppeteer. The included Dockerfile handles the Chromium installation automatically.

## 🏗️ Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   React App     │────▶│  Express API    │────▶│  OSU / LibCal   │
│   (Frontend)    │◀────│  (Backend)      │◀────│  (Data Source)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                │
                                ▼
                        ┌─────────────────┐
                        │   Puppeteer     │
                        │   (Web Scraper) │
                        └─────────────────┘

```

> In production, the backend serves the built React app (`dist/`) and injects current availability data into the initial HTML response so the page is populated immediately.

## 🔍 How the Data Works

### OSU API (18th Ave, Thompson, FAES)

Direct JSON API - no scraping needed!

```
GET https://content.osu.edu/v2/library/roomreservation/api/v1/locationsearch/{locationId}/{date}

```

### Health Sciences Library (LibCal)

Uses Puppeteer to scrape the LibCal page since it's JavaScript-rendered.

## 📡 API Endpoints

| Method | Endpoint | Description |
| --- | --- | --- |
| POST | `/api/refresh` | Force refresh the in-memory cache for all 8 days |
| GET | `/api/health` | Health check + basic cache status |

## 🔧 Configuration

### Environment Variables

```bash
PORT=3000              # Server port
NODE_ENV=production    # Serve built frontend from dist/

```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/add-thompson-library`)
3. Commit your changes (`git commit -m 'Add Thompson Library support'`)
4. Push to the branch (`git push origin feature/add-thompson-library`)
5. Open a Pull Request

### Ideas for Contribution

* [ ] Add more OSU libraries
* [ ] Implement push notifications for room availability
* [ ] Add floor maps showing room locations
* [ ] Create a mobile app (React Native)
* [ ] Add historical usage analytics
* [ ] Support other universities using LibCal

## ⚠️ Disclaimer

This project is not affiliated with The Ohio State University. It accesses publicly available room availability data from OSU Libraries' LibCal system. Please use responsibly and respect rate limits.

## 📄 License

MIT — Use it however you want!

---

Built with ❤️ by Xinci Ma for OSU students who are tired of browsing around looking for study rooms.