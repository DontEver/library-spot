# 📚 LibrarySpot

**Find available study rooms across all OSU libraries in one place.**

No more checking multiple websites or walking around campus looking for an open room. LibrarySpot aggregates real-time availability from Ohio State University libraries into a single, searchable dashboard.

## 📍 Supported Libraries & Rooms

| Library | Rooms | Data Source |
|---------|-------|-------------|
| **18th Avenue Library** | 126, 128, 401+ | OSU API |
| **Thompson Library** | 040A, 045A-C, 051, 055 | OSU API |
| **FAES Library** | 045D, 045E, 045F, 045G, 045H | OSU API |
| **Health Sciences Library** | 360A-H | LibCal (Puppeteer) |

## ✨ Features

- **🏛️ All Libraries, One View** — See availability across 18th Avenue, Thompson, FAES, and Health Sciences
- **📅 7-Day Calendar** — View and plan reservations up to a week in advance
- **⏰ Real-Time Clock** — Uses WorldTimeAPI to get accurate EST time
- **🕐 30-Minute Slots** — Matches OSU's booking system intervals
- **📍 Smart Time Filtering** — For today, only shows remaining slots; future dates show all slots
- **⚡ Live Data** — Fetches directly from OSU's room reservation API
- **📱 Mobile Friendly** — Works great on phones for on-the-go searching
- **🔗 Direct Booking** — Health Sciences Library has direct LibCal booking link

## 🚀 Quick Start

### Frontend Only (Demo Mode)

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:5173
```

### Full Stack (With Live Data)

```bash
# Install all dependencies including server
npm install
cd server && npm install puppeteer express cors

# Start both frontend and backend
npm run dev:full

# Frontend: http://localhost:5173
# API: http://localhost:3001
```

## 🏗️ Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   React App     │────▶│  Express API    │────▶│  OSU LibCal     │
│   (Frontend)    │◀────│  (Backend)      │◀────│  (Data Source)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │  Puppeteer      │
                        │  (Web Scraper)  │
                        └─────────────────┘
```

## 🔍 How the Data Works

### OSU API (18th Ave, Thompson, FAES)
Direct JSON API - no scraping needed!
```
GET https://content.osu.edu/v2/library/roomreservation/api/v1/locationsearch/{locationId}/{date}

Location IDs:
- 18th Avenue: 16287
- Thompson: 16286
- FAES: 16298
```

Key fields:
- `open: true/false` — Library is open at this time
- `taken: true/false` — Slot is booked
- `maximumCapacity` — Room capacity
- `whiteboard`, `hdtv`, `videoConferencing` — Amenities

### Health Sciences Library (LibCal)
Uses Puppeteer to scrape the LibCal page since it's JavaScript-rendered.

```html
<!-- Available slot -->
<a class="fc-timeline-event s-lc-eq-avail" 
   title="2:00pm Monday, January 19, 2026 - 360A - Available">

<!-- Unavailable slot -->
<a class="fc-timeline-event s-lc-eq-r-unavailable" 
   title="5:30pm Monday, January 19, 2026 - 360A - Unavailable/Padding">
```

## 📡 API Endpoints

```
GET  /api/libraries?date=YYYY-MM-DD  - Get all libraries (date optional, defaults to today)
GET  /api/libraries/:id?date=...     - Get specific library
POST /api/refresh?date=...           - Force refresh cache
GET  /api/health                     - Health check
```

### Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend | React 18 + Vite | Fast, modern UI |
| Styling | Tailwind CSS | Utility-first styling |
| Backend | Express.js | API server |
| Scraping | Puppeteer | Handles JS-rendered LibCal pages |
| Caching | In-memory | 5-minute TTL to reduce load |

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/libraries` | Get all libraries with current availability |
| GET | `/api/libraries/:id` | Get specific library details |
| POST | `/api/refresh` | Force refresh the cache |
| GET | `/api/health` | Server health check |

### Example Response

```json
{
  "success": true,
  "data": [
    {
      "id": "hsl",
      "name": "Health Sciences Library",
      "url": "https://hsl-osu.libcal.com/spaces?lid=694&gid=24674",
      "rooms": [
        {
          "id": "h-360a",
          "name": "Room 360A",
          "capacity": 5,
          "amenities": ["whiteboard", "monitor"],
          "slots": [
            { "time": "9:00 AM", "available": true },
            { "time": "10:00 AM", "available": false }
          ]
        }
      ],
      "scrapedAt": "2025-01-19T15:30:00Z"
    }
  ]
}
```

## 🔧 Configuration

### Adding More Libraries

Edit `server/index.js` to add more LibCal sources:

```javascript
const LIBCAL_SOURCES = [
  {
    id: 'hsl',
    name: 'Health Sciences Library',
    url: 'https://hsl-osu.libcal.com/spaces?lid=694&gid=24674',
  },
  // Add more libraries here
  {
    id: 'thompson',
    name: 'Thompson Library',
    url: 'https://osul.libcal.com/spaces?lid=XXX&gid=XXX', // Find the correct URL
  },
];
```

### Finding LibCal URLs

1. Go to the library's room reservation page
2. Look for links containing `libcal.com/spaces`
3. The URL parameters `lid` (location ID) and `gid` (group ID) identify the room set

### Environment Variables

```bash
PORT=3001              # API server port
CACHE_TTL=300000       # Cache duration in ms (default: 5 min)
```

## 📦 Deployment

### Frontend (Vercel/Netlify)

```bash
npm run build
# Deploy the `dist/` folder
```

### Backend (Railway/Render/Fly.io)

The server requires Puppeteer, which needs a Chromium binary. Use a Docker deployment:

```dockerfile
FROM node:18-slim

# Install Chromium dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    --no-install-recommends

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 3001
CMD ["node", "server/index.js"]
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/add-thompson-library`)
3. Commit your changes (`git commit -m 'Add Thompson Library support'`)
4. Push to the branch (`git push origin feature/add-thompson-library`)
5. Open a Pull Request

### Ideas for Contribution

- [ ] Add more OSU libraries
- [ ] Implement push notifications for room availability
- [ ] Add floor maps showing room locations
- [ ] Create a mobile app (React Native)
- [ ] Add historical usage analytics
- [ ] Support other universities using LibCal

## ⚠️ Disclaimer

This project is not affiliated with The Ohio State University. It accesses publicly available room availability data from OSU Libraries' LibCal system. Please use responsibly and respect rate limits.

## 📄 License

MIT — Use it however you want!

---

Built with ❤️ by Xinci Ma for OSU students who are tired of walking around looking for study rooms.
