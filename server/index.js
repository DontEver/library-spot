/**
 * LibrarySpot Backend Server
 *
 * Uses OSU's JSON API for 18th Avenue, Thompson, and FAES libraries.
 * Uses Puppeteer scraping for Health Sciences Library (LibCal).
 *
 * To run:
 * 1. npm install express cors node-fetch express-rate-limit
 * 2. node server/index.js
 *
 * For HSL scraping, also: npm install puppeteer
 */
import express from "express";
import rateLimit from "express-rate-limit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const isDev = process.env.NODE_ENV !== "production";

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// adjust if dist path is different
const DIST_DIR = path.resolve(__dirname, "../dist");
const INDEX_HTML_PATH = path.join(DIST_DIR, "index.html");

console.log("DIST_DIR =", DIST_DIR);
console.log("INDEX_HTML_PATH =", INDEX_HTML_PATH);

console.log("index.html exists?", fs.existsSync(INDEX_HTML_PATH));

app.use(
  "/assets",
  express.static(path.join(DIST_DIR, "assets"), {
    maxAge: "1y",
    immutable: true,
  }),
);

const BOOTSTRAP_TTL = 60 * 1000; // 1 minute

app.set("trust proxy", true);

let indexHtmlTemplate = null;

// Cache the *final rendered HTML* (with injected window.__LIBRARYSPOT_INITIAL__)
let cachedBootstrapHtml = null;
let cachedBootstrapAt = 0;

// Stampede protection for the bootstrap render itself
let bootstrapInFlight = null;

function getIndexHtmlTemplate() {
  if (!indexHtmlTemplate) {
    indexHtmlTemplate = fs.readFileSync(INDEX_HTML_PATH, "utf-8");
  }
  return indexHtmlTemplate;
}

app.use(express.json());

// Serve Vite build output (assets, etc). We keep index:false so we can inject into index.html ourselves.
if (!isDev) {
  // PROD: serve built frontend
  app.use(express.static(DIST_DIR, { index: false }));
}

// LibCal widget IDs for hours
const LIBCAL_HOURS_CONFIG = {
  "18th-ave": {
    lid: 16287,
    buildingRowName: "18th Avenue Library",
    reservationRowName: "18th Group Study Rooms",
  },
  thompson: {
    lid: 16286,
    buildingRowName: "Thompson Library",
    reservationRowName: "Thompson Group Study Rooms",
  },
  faes: {
    lid: 16298,
    buildingRowName: "FAES Library",
    reservationRowName: "FAES Library", // Same row for both
  },
};

// Library configurations (ordered: 18th, Thompson, FAES, HSL)
const LIBRARIES = [
  {
    id: "18th-ave",
    name: "18th Avenue Library",
    address: "175 W. 18th Ave, Columbus, OH",
    locationId: 16287,
    type: "osu-api",
    hours: { open: 7.5, close: 23.5 }, // 7:30am - 11:30pm
  },
  {
    id: "thompson",
    name: "Thompson Library",
    address: "1858 Neil Ave, Columbus, OH",
    locationId: 16286,
    type: "osu-api",
    hours: { open: 11, close: 23.5 }, // 11am - 11:30pm
  },
  {
    id: "faes",
    name: "FAES Library",
    fullName: "Food, Agricultural, and Environmental Sciences Library",
    address: "2120 Fyffe Rd, Columbus, OH",
    locationId: 16298,
    type: "osu-api",
    hours: { open: 8, close: 18 }, // 8am - 6pm
  },
  {
    id: "hsl",
    name: "Health Sciences Library",
    subtitle: "(University Hospital)",
    address: "376 W. 10th Ave, Columbus, OH",
    type: "libcal",
    libcalUrl: "https://hsl-osu.libcal.com/spaces?lid=694&gid=24674",
    bookingUrl: "https://hsl-osu.libcal.com/spaces?lid=694&gid=24674",
    hours: { open: 8, close: 22 }, // 8am - 10pm (estimate)
    roomInfo: {
      "360A": { capacity: 5, floor: 3 },
      "360B": { capacity: 5, floor: 3 },
      "360C": { capacity: 5, floor: 3 },
      "360D": { capacity: 5, floor: 3 },
      "360E": { capacity: 5, floor: 3 },
      "360F": { capacity: 5, floor: 3 },
      "360G": { capacity: 5, floor: 3 },
      "360H": { capacity: 5, floor: 3 },
    },
  },
];

// Cache for data (keyed by date)
let dataCache = {};
const inFlight = new Map();
const CACHE_TTL = 60 * 1000; // 1 minute

/**
 * Get date string in UTC format for OSU API
 * Uses America/New_York timezone which automatically handles EST/EDT
 * @param {Date} date - The date to format (defaults to today in EST/EDT)
 */
function getDateUTC(date = null) {
  if (!date) {
    // Get current date in America/New_York timezone (handles DST automatically)
    const now = new Date();
    const estDateStr = now.toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    }); // YYYY-MM-DD
    return `${estDateStr}T05:00:00.000Z`;
  }

  // If date object provided, convert to EST/EDT date string
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}T05:00:00.000Z`;
}

/**
 * Convert starttime (HH:MM:SS in EST) to display format (e.g., "2:30pm")
 */
function formatEstTime(starttime) {
  // starttime is in format "07:30:00" (already EST)
  const [hourStr, minStr] = starttime.split(":");
  const hour = parseInt(hourStr);
  const minute = parseInt(minStr);

  const h = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  const period = hour >= 12 ? "pm" : "am";
  const m = minute.toString().padStart(2, "0");

  return `${h}:${m}${period}`;
}

/**
 * Extract room name from OSU API roomName (e.g., "18th Avenue Library 126" -> "126")
 */
function extractRoomNumber(roomName) {
  // Match patterns like "045D", "126", etc. at the end
  const match = roomName.match(/(\d+[A-Za-z]?)\s*$/);
  return match ? match[1] : roomName;
}

// Cache for library hours (keyed by week start date)
let hoursCache = {};
const HOURS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Get Monday of the week for a given date
 */
function getMondayOfWeek(dateStr) {
  const date = new Date(dateStr + "T12:00:00");
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Adjust to get Monday
  date.setDate(date.getDate() + diff);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayNum = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${dayNum}`;
}

/**
 * Parse time string like "7:30am" or "11pm" to decimal hours
 */
function parseTimeToDecimal(timeStr) {
  if (!timeStr || timeStr.toLowerCase() === "closed") return null;

  const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!match) return null;

  let hour = parseInt(match[1]);
  const minute = match[2] ? parseInt(match[2]) : 0;
  const period = match[3].toLowerCase();

  if (period === "pm" && hour !== 12) hour += 12;
  if (period === "am" && hour === 12) hour = 0;

  return hour + minute / 60;
}

/**
 * Parse hours from a specific row in the HTML
 */
function parseRowHours(html, rowName, mondayDate) {
  const hours = {};

  // Find ALL rows first, then filter to the one containing our target in first td
  const allRows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

  // Find the row where the first td contains our target name
  let targetRow = null;
  for (const rowMatch of allRows) {
    const rowContent = rowMatch[1];
    // Get first td content
    const firstTdMatch = rowContent.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
    if (firstTdMatch && firstTdMatch[1].includes(rowName)) {
      targetRow = rowMatch[0];
      break;
    }
  }

  if (!targetRow) {
    console.log(`Could not find row for ${rowName}`);
    return null;
  }

  // Extract all td cells from the target row
  const tdMatches = [...targetRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];

  // Skip first td (label), process next 7 (Mon-Sun)
  for (let i = 1; i <= 7 && i < tdMatches.length; i++) {
    const cellContent = tdMatches[i][1];
    const mondayDateObj = new Date(mondayDate + "T12:00:00");
    mondayDateObj.setDate(mondayDateObj.getDate() + (i - 1));
    const dayDateStr = mondayDateObj.toISOString().split("T")[0];

    if (cellContent.includes("s-lc-closed")) {
      hours[dayDateStr] = {
        open: null,
        close: null,
        closed: true,
        openStr: "Closed",
        closeStr: "",
      };
    } else {
      // First check for "24 Hours" text (with possible notes like OSU ID requirement)
      const timetxtMatch = cellContent.match(
        /<span[^>]*class="s-lc-timetxt[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
      );

      if (timetxtMatch && timetxtMatch[1].toLowerCase().includes("24 hour")) {
        // It's a 24 hour day - extract any note about requirements
        const noteText = timetxtMatch[1].trim();
        // Extract the parenthetical note if present
        const noteMatch = noteText.match(/\(([^)]+)\)/);
        const note = noteMatch ? noteMatch[1].trim() : null;

        hours[dayDateStr] = {
          open: 0,
          close: 24,
          openStr: "24 Hours",
          closeStr: "",
          note: note, // e.g., "Current OSU ID req'd 12AM -7AM"
        };
      } else {
        // Match time range in s-lc-time span: "7:30am &ndash; 11:30pm"
        const timeSpanMatch = cellContent.match(
          /<span[^>]*class="s-lc-time[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
        );

        if (timeSpanMatch) {
          const timeContent = timeSpanMatch[1];
          const timeMatch = timeContent.match(
            /(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*(?:&ndash;|–|-)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i,
          );

          if (timeMatch) {
            // Capitalize AM/PM
            const openStr = timeMatch[1]
              .trim()
              .replace(/(am|pm)/gi, (m) => m.toUpperCase());
            const closeStr = timeMatch[2]
              .trim()
              .replace(/(am|pm)/gi, (m) => m.toUpperCase());
            let openTime = parseTimeToDecimal(openStr);
            let closeTime = parseTimeToDecimal(closeStr);

            // If close time is 12am (0), it means midnight END of day, so use 24
            if (closeTime === 0) {
              closeTime = 24;
            }

            hours[dayDateStr] = {
              open: openTime,
              close: closeTime,
              openStr,
              closeStr,
            };
          } else {
            hours[dayDateStr] = {
              open: 0,
              close: 24,
              openStr: "24 Hours",
              closeStr: "",
            };
          }
        } else {
          // Fallback for other text formats
          hours[dayDateStr] = {
            open: 0,
            close: 24,
            openStr: "Unknown",
            closeStr: "",
          };
        }
      }
    }
  }

  return hours;
}

/**
 * Fetch library hours from LibCal widget (both building and reservation hours)
 */
async function fetchLibCalHours(libraryId, dateStr) {
  const config = LIBCAL_HOURS_CONFIG[libraryId];
  if (!config) return null;

  const mondayDate = getMondayOfWeek(dateStr);
  const cacheKey = `${libraryId}-${mondayDate}`;

  // Check cache
  if (
    hoursCache[cacheKey]?.data &&
    hoursCache[cacheKey]?.lastUpdated &&
    Date.now() - hoursCache[cacheKey].lastUpdated < HOURS_CACHE_TTL
  ) {
    console.log(`Using cached hours for ${libraryId} week of ${mondayDate}`);
    return hoursCache[cacheKey].data;
  }

  try {
    const url = `https://osul.libcal.com/widget/hours/grid?iid=5296&lid=${config.lid}&date=${mondayDate}`;
    console.log(`Fetching hours from: ${url}`);

    const response = await fetch(url);
    const html = await response.text();

    // Parse both building and reservation hours
    const buildingHours = parseRowHours(
      html,
      config.buildingRowName,
      mondayDate,
    );
    const reservationHours = parseRowHours(
      html,
      config.reservationRowName,
      mondayDate,
    );

    console.log(`Parsed building hours for ${libraryId}:`, buildingHours);
    console.log(`Parsed reservation hours for ${libraryId}:`, reservationHours);

    // Combine into result keyed by date
    const result = {};
    const allDates = new Set([
      ...Object.keys(buildingHours || {}),
      ...Object.keys(reservationHours || {}),
    ]);

    for (const date of allDates) {
      result[date] = {
        building: buildingHours?.[date] || null,
        reservation: reservationHours?.[date] || null,
      };
    }

    // Cache the result
    hoursCache[cacheKey] = {
      lastUpdated: Date.now(),
      data: result,
    };

    return result;
  } catch (error) {
    console.error(`Error fetching hours for ${libraryId}:`, error.message);
    return null;
  }
}

/**
 * Get library hours for a specific date (may need to fetch two weeks)
 */
async function getLibraryHoursForDate(libraryId, dateStr) {
  // First try to get from current week
  let hours = await fetchLibCalHours(libraryId, dateStr);
  if (hours && hours[dateStr]) {
    return hours[dateStr];
  }

  // If not found, the date might be in next week - fetch that week too
  const requestedDate = new Date(dateStr + "T12:00:00");
  const mondayOfWeek = getMondayOfWeek(dateStr);
  const mondayDate = new Date(mondayOfWeek + "T12:00:00");
  const daysSinceMonday = Math.floor(
    (requestedDate - mondayDate) / (24 * 60 * 60 * 1000),
  );

  // If requested date is past Sunday (7+ days from Monday), fetch next week
  if (daysSinceMonday >= 7) {
    const nextMonday = new Date(mondayDate);
    nextMonday.setDate(nextMonday.getDate() + 7);
    const nextMondayStr = nextMonday.toISOString().split("T")[0];

    hours = await fetchLibCalHours(libraryId, nextMondayStr);
    if (hours && hours[dateStr]) {
      return hours[dateStr];
    }
  }

  return null;
}

/**
 * Fetch data from OSU JSON API
 * @param {Object} library - Library config
 * @param {string} dateStr - Date in format YYYY-MM-DD (optional, defaults to today)
 */
async function fetchOsuApi(library, dateStr = null) {
  let apiDateStr;
  const now = new Date();

  // Determine if we are looking at "today" in EST
  const estTodayStr = now.toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  const isToday = !dateStr || dateStr === estTodayStr;
  const targetDateStr = dateStr || estTodayStr;

  if (dateStr) {
    const [year, month, day] = dateStr.split("-").map(Number);
    apiDateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T05:00:00.000Z`;
  } else {
    apiDateStr = getDateUTC();
  }

  const url = `https://content.osu.edu/v2/library/roomreservation/api/v1/locationsearch/${library.locationId}/${apiDateStr}`;

  try {
    // Fetch room data and hours in parallel
    const [response, dynamicHours] = await Promise.all([
      fetch(url),
      getLibraryHoursForDate(library.id, targetDateStr),
    ]);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const json = await response.json();
    if (json.status !== "success" || !json.data?.locationAvailableRooms) {
      throw new Error("Invalid API response");
    }

    const roomsMap = {};

    // Calculate "Current" slot floor (e.g., 8:46pm -> 20:30:00)
    const currentEstTime = now.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
    const [currH, currM] = currentEstTime.split(":").map(Number);
    const roundedM = currM >= 30 ? "30" : "00";
    const currentSlotStartTime = `${String(currH).padStart(2, "0")}:${roundedM}:00`;

    json.data.locationAvailableRooms.forEach((roomData) => {
      roomData.timeslots.forEach((slot) => {
        if (slot.roomHide === true) return;

        const roomNum = extractRoomNumber(slot.roomName);

        if (!roomsMap[roomNum]) {
          roomsMap[roomNum] = {
            name: roomNum,
            fullName: slot.roomName,
            capacity: slot.maximumCapacity,
            floor: slot.roomName.includes("045")
              ? "LL"
              : parseInt(roomNum.charAt(0)) || 1,
            amenities: [],
            slots: [],
          };

          if (slot.whiteboard) roomsMap[roomNum].amenities.push("whiteboard");
          if (slot.hdtv) roomsMap[roomNum].amenities.push("monitor");
          if (slot.videoConferencing)
            roomsMap[roomNum].amenities.push("video-conf");
        }

        if (slot.open) {
          roomsMap[roomNum].slots.push({
            time: formatEstTime(slot.starttime),
            available: !slot.taken,
            starttime: slot.starttime,
          });
        }
      });
    });

    const rooms = Object.values(roomsMap)
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      )
      .map((room) => ({
        ...room,
        slots: room.slots.sort((a, b) =>
          a.starttime.localeCompare(b.starttime),
        ),
      }));

    // Include dynamic hours if available, otherwise use static fallback
    const hours = dynamicHours || {
      building: null,
      reservation: { open: library.hours.open, close: library.hours.close },
    };

    return {
      ...library,
      hours,
      rooms,
      scrapedAt: new Date().toISOString(),
      isLive: true,
    };
  } catch (error) {
    console.error(`Error fetching ${library.name}:`, error.message);
    return {
      ...library,
      rooms: [],
      scrapedAt: new Date().toISOString(),
      error: error.message,
    };
  }
}

/**
 * Scrape Health Sciences Library from LibCal using Puppeteer
 * @param {Object} library - Library config
 * @param {string} dateStr - Date in format YYYY-MM-DD (optional, defaults to today)
 */
async function scrapeLibCal(library, dateStr = null) {
  let puppeteer;
  try {
    puppeteer = await import("puppeteer");
  } catch (e) {
    console.log("Puppeteer not installed. Skipping HSL.");
    return {
      ...library,
      rooms: [],
      scrapedAt: new Date().toISOString(),
      error: "Puppeteer not installed",
    };
  }

  const browser = await puppeteer.default.launch({
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);

    // Add date parameter to URL if provided
    let url = library.libcalUrl;
    if (dateStr) {
      url += `&date=${dateStr}`;
    }

    await page.goto(url, { waitUntil: "networkidle2" });
    await page.waitForSelector(".fc-timeline-event", { timeout: 15000 });
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Use the target date for filtering
    const targetDate = dateStr ? new Date(dateStr + "T12:00:00") : new Date();

    const data = await page.evaluate((targetDateStr) => {
      const slots = document.querySelectorAll(".fc-timeline-event");
      const roomData = {};

      // Parse target date for filtering
      const target = targetDateStr
        ? new Date(targetDateStr + "T12:00:00")
        : new Date();
      const targetMonth = target.toLocaleDateString("en-US", { month: "long" });
      const targetDay = target.getDate();
      const targetYear = target.getFullYear();
      const targetDateString = `${targetMonth} ${targetDay}, ${targetYear}`;

      slots.forEach((slot) => {
        const title =
          slot.getAttribute("title") || slot.getAttribute("aria-label") || "";

        // Title format: "1:30pm Wednesday, January 21, 2026 - 360H - Available"
        // More flexible regex that captures everything
        const match = title.match(
          /^(\d{1,2}:\d{2}[ap]m)\s+\w+,\s+(.+?\d{4})\s+-\s+([^-]+)\s+-\s+(.+)$/i,
        );

        if (match) {
          const [, time, dateStr, roomName, statusText] = match;
          const trimmedRoom = roomName.trim();

          // Check if this is for the target date
          if (!dateStr.includes(targetDateString)) return;

          // Determine availability:
          // 1. Check CSS class first (most reliable)
          // 2. Fall back to title text
          const classList = slot.className || "";
          const hasAvailClass = classList.includes("s-lc-eq-avail");
          const hasUnavailClass =
            classList.includes("s-lc-eq-unavail") ||
            classList.includes("unavailable");
          const titleSaysAvailable =
            statusText.trim().toLowerCase() === "available";

          // Available if: has avail class OR (title says available AND no unavail class)
          const isAvailable =
            hasAvailClass || (titleSaysAvailable && !hasUnavailClass);

          if (!roomData[trimmedRoom]) {
            roomData[trimmedRoom] = {
              name: trimmedRoom,
              slots: [],
              seenTimes: {},
            };
          }

          // Deduplicate by time - if we see the same time again, prefer available
          if (!roomData[trimmedRoom].seenTimes[time]) {
            roomData[trimmedRoom].seenTimes[time] = true;
            roomData[trimmedRoom].slots.push({ time, available: isAvailable });
          } else if (isAvailable) {
            // Update existing slot to available if this one is available
            const existingSlot = roomData[trimmedRoom].slots.find(
              (s) => s.time === time,
            );
            if (existingSlot) existingSlot.available = true;
          }
        }
      });

      return Object.values(roomData).map((room) => {
        const sortedSlots = room.slots.sort((a, b) => {
          const parseTime = (t) => {
            const m = t.match(/^(\d{1,2}):(\d{2})([ap]m)$/i);
            if (!m) return 0;
            let h = parseInt(m[1]);
            const min = parseInt(m[2]);
            if (m[3].toLowerCase() === "pm" && h !== 12) h += 12;
            if (m[3].toLowerCase() === "am" && h === 12) h = 0;
            return h * 60 + min;
          };
          return parseTime(a.time) - parseTime(b.time);
        });
        return { name: room.name, slots: sortedSlots };
      });
    }, dateStr);

    // Add room metadata
    const rooms = data.map((room) => ({
      ...room,
      capacity: library.roomInfo[room.name]?.capacity || 5,
      floor: library.roomInfo[room.name]?.floor || 3,
      amenities: ["whiteboard", "monitor"],
    }));

    return {
      ...library,
      rooms,
      scrapedAt: new Date().toISOString(),
      isLive: true,
    };
  } catch (error) {
    console.error(`Error scraping HSL:`, error.message);
    return {
      ...library,
      rooms: [],
      scrapedAt: new Date().toISOString(),
      error: error.message,
    };
  } finally {
    await browser.close();
  }
}

/**
 * Fetch all library data
 * @param {string} dateStr - Date in format YYYY-MM-DD (optional)
 */
async function getAllLibraryData(dateStr = null, { force = false } = {}) {
  const cacheKey = dateStr || "today";
  const now = Date.now();

  const entry = dataCache[cacheKey];
  const isFresh =
    entry?.data && entry?.lastUpdated && now - entry.lastUpdated < CACHE_TTL;

  if (!force && isFresh) {
    return { data: entry.data, fetchedAt: entry.lastUpdated, cacheHit: true };
  }

  // If someone else is already fetching, await it (stampede protection)
  if (inFlight.has(cacheKey)) {
    const result = await inFlight.get(cacheKey);
    return { ...result, cacheHit: false, deduped: true };
  }

  const fetchPromise = (async () => {
    console.log(`Fetching fresh data for ${cacheKey}...`);
    const startedAt = Date.now();

    const results = await Promise.all(
      LIBRARIES.map(async (library) => {
        // Check if it's an OSU API library or LibCal (HSL)
        if (library.type === "osu-api") {
          return await fetchOsuApi(library, dateStr);
        } else if (library.type === "libcal") {
          return await scrapeLibCal(library, dateStr);
        }
        return library;
      }),
    );

    const finishedAt = Date.now(); // IMPORTANT: set lastUpdated AFTER fetch completes

    dataCache[cacheKey] = {
      lastUpdated: finishedAt,
      data: results,
      lastFetchDurationMs: finishedAt - startedAt,
    };

    return {
      data: results,
      fetchedAt: finishedAt,
      fetchDurationMs: finishedAt - startedAt,
    };
  })();

  inFlight.set(cacheKey, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    inFlight.delete(cacheKey);
  }
}

// ------------------------------
// Public Page Routes (HTML + injected bootstrap data)
// ------------------------------

function getNext8DaysNY() {
  const days = [];
  const now = new Date();
  // Use NY "today" even if server is elsewhere
  const todayStr = now.toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  }); // YYYY-MM-DD
  const [y, m, d] = todayStr.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)); // noon UTC to avoid DST edge cases

  for (let i = 0; i < 8; i++) {
    const dt = new Date(base);
    dt.setUTCDate(dt.getUTCDate() + i);
    const yyyy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    days.push(`${yyyy}-${mm}-${dd}`);
  }
  return days;
}

function safeJsonForHtml(obj) {
  // Prevent "</script>" / "<" issues
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

async function renderIndexWithBootstrap(req, res) {
  const now = Date.now();

  // 1) If we already built HTML within the last minute, serve it
  if (cachedBootstrapHtml && now - cachedBootstrapAt < BOOTSTRAP_TTL) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(cachedBootstrapHtml);
  }

  // 2) If another request is currently building it, await that
  if (bootstrapInFlight) {
    const html = await bootstrapInFlight;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(html);
  }

  // 3) Otherwise build it once (and everyone else waits)
  bootstrapInFlight = (async () => {
    const template = getIndexHtmlTemplate();

    const dayStrs = getNext8DaysNY();

    const entries = await Promise.all(
      dayStrs.map(async (dateStr) => {
        const result = await getAllLibraryData(dateStr); // already TTL + inFlight protected :contentReference[oaicite:3]{index=3}
        return [
          dateStr,
          {
            data: result.data,
            fetchedAt: result.fetchedAt,
          },
        ];
      }),
    );

    const payload = {
      serverNowMs: Date.now(),
      libraryCache: Object.fromEntries(entries),
    };

    const bootstrapTag = `<script>window.__LIBRARYSPOT_INITIAL__=${safeJsonForHtml(payload)};</script>`;

    const out = template.replace("</head>", `${bootstrapTag}\n</head>`);

    cachedBootstrapHtml = out;
    cachedBootstrapAt = Date.now();

    return out;
  })();

  try {
    const html = await bootstrapInFlight;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(html);
  } finally {
    bootstrapInFlight = null;
  }
}

// Rate limiting - generous limit for shared campus IPs
const pageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200, // 200 requests per minute per IP
  message: { error: "Too many requests" },
});

app.use("/api/", pageLimiter);

// Home
app.get("/", pageLimiter, async (req, res, next) => {
  try {
    await renderIndexWithBootstrap(req, res);
  } catch (e) {
    next(e);
  }
});

// SPA fallback (Express 5 compatible): match everything EXCEPT /api/*
app.get(/^(?!\/api\/).*/, pageLimiter, async (req, res, next) => {
  try {
    if (req.path.includes(".")) return next(); // let static assets/files through
    await renderIndexWithBootstrap(req, res);
  } catch (e) {
    next(e);
  }
});

// API Routes
app.post("/api/refresh", async (req, res) => {
  try {
    const dateStr = req.query.date; // optional
    const data = await getAllLibraryData(dateStr, { force: true });
    res.json({ success: true, message: "Cache refreshed", data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/health", (req, res) => {
  const entries = Object.values(dataCache || {});
  const newest = entries.reduce((best, e) => {
    if (!e?.lastUpdated) return best;
    return !best || e.lastUpdated > best ? e.lastUpdated : best;
  }, null);

  res.json({
    status: "ok",
    uptime: process.uptime(),
    cachedKeys: Object.keys(dataCache || {}).length,
    newestCacheAgeMs: newest ? Date.now() - newest : null,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🏛️  LibrarySpot running on http://localhost:${PORT}`);
  console.log(`📊 Libraries: 18th Avenue, Thompson, FAES, Health Sciences`);
  console.log(
    `🌐 Public: GET / (HTML + bootstrapped data, no browser /api calls)`,
  );
  console.log(`🔒 Private (protect in Cloudflare Access): /api/*`);
  console.log(`📡 Private endpoints:`);
  console.log(`   POST /api/refresh       - Force refresh cache`);
  console.log(`   GET  /api/health        - Health check`);
});

export default app;
