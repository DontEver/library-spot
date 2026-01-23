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
- **⏰ Real-Time Clock** — Displays current America/New_York time (client-ticking, server-synced when available)
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

# Open the URL Vite prints (usually http://localhost:5173)
````

### Full Stack (With Live Data)

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

> Note: Health Sciences Library scraping uses Puppeteer. If you're running without Docker and HSL scraping fails due to missing Chromium, install Puppeteer/Chromium requirements for your OS.

## 🏗️ Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   React App     │────▶│  Express API    │────▶│  OSU / LibCal    │
│   (Frontend)    │◀────│  (Backend)      │◀────│  (Data Source)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │  Puppeteer      │
                        │  (Web Scraper)  │
                        └─────────────────┘
```

> In Docker/production-style runs, the backend serves the built React app (`dist/`) and injects preloaded availability into the initial HTML for fast loads.

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

* `open: true/false` — Library is open at this time
* `taken: true/false` — Slot is booked
* `maximumCapacity` — Room capacity
* `whiteboard`, `hdtv`, `videoConferencing` — Amenities

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

| Method | Endpoint                             | Description                                          |
| ------ | ------------------------------------ | ---------------------------------------------------- |
| GET    | `/api/libraries?date=YYYY-MM-DD`     | Get all libraries (date optional, defaults to today) |
| GET    | `/api/libraries/:id?date=YYYY-MM-DD` | Get a specific library                               |
| POST   | `/api/refresh?date=YYYY-MM-DD`       | Force refresh the cache (date optional)              |
| GET    | `/api/time`                          | Current America/New_York time + server timestamp     |
| GET    | `/api/health`                        | Server health check                                  |

### Tech Stack

| Layer    | Technology      | Purpose                          |
| -------- | --------------- | -------------------------------- |
| Frontend | React 18 + Vite | Fast, modern UI                  |
| Styling  | Tailwind CSS    | Utility-first styling            |
| Backend  | Express.js      | API + HTML bootstrap server      |
| Scraping | Puppeteer       | Handles JS-rendered LibCal pages |
| Caching  | In-memory       | TTL cache to reduce load         |

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
PORT=3000              # Server port
CACHE_TTL=50000        # Cache duration in ms
NODE_ENV=production    # Serve built frontend from dist/ (Docker/prod-style)
```

## 📦 Deployment

### Docker (Recommended)

Run as a single container that builds the frontend and serves it via the backend.

Create `docker-compose.dev.yml`:

```yaml
services:
  library-dev:
    container_name: library-dev
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3100:3000"
    environment:
      - NODE_ENV=production
    restart: unless-stopped
```

Start it:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

Verify:

```bash
curl -I http://127.0.0.1:3100
curl http://127.0.0.1:3100/api/health
```

Open:

```
http://<YOUR_HOST>:3100
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

Built with ❤️ by Xinci Ma for OSU students who are tired of walking around looking for study rooms.

```
```
