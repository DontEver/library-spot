import React, { useState, useEffect, useMemo } from "react";

// Use Vite env var if provided, otherwise default to "" (same-origin)
// This makes production calls go to /api/... (proxied by nginx)
const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

// Helper to avoid double slashes
const apiUrl = (path) => `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;

// Server-injected bootstrap (SSR-ish). If present, we should not call /api/* from the browser.
const BOOTSTRAP =
  (typeof window !== "undefined" && window.__LIBRARYSPOT_INITIAL__) || null;

const BOOT_CACHE = BOOTSTRAP?.libraryCache || null;
const BOOT_SERVER_NOW_MS = BOOTSTRAP?.serverNowMs || null;

// If the server injects preloaded data into the HTML, we'll use it.
const INITIAL =
  typeof window !== "undefined" ? window.__LIBRARYSPOT_INITIAL__ : null;

// Library operating hours (for reservations)
// Note: Building hours may differ from reservation hours
const LIBRARY_HOURS = {
  "18th-ave": {
    open: 7.5,
    close: 23.5,
    name: "7:30 AM - 11:30 PM",
    building: "24 hours",
  },
  thompson: {
    open: 11,
    close: 23.5,
    name: "11:00 AM - 11:30 PM",
    building: "7:30 AM - 12:00 AM",
  },
  faes: {
    open: 8,
    close: 18,
    name: "8:00 AM - 6:00 PM",
    building: "8:00 AM - 6:00 PM",
  },
  hsl: {
    // HSL has variable hours - this is just a fallback
    open: 7.5,
    close: 19.75,
    name: "Variable",
    building: "See schedule",
  },
};

// HSL weekly hours - based on actual schedule from hsl.osu.edu/about/hours
// Week of January 19-25, 2026
const HSL_HOURS_DATA = {
  // Week starting Jan 19
  "2026-01-19": { open: "10am", close: "5:45pm", note: "MLK Day" },
  "2026-01-20": { open: "7:30am", close: "7:45pm" },
  "2026-01-21": { open: "7:30am", close: "7:45pm" },
  "2026-01-22": { open: "7:30am", close: "7:45pm" },
  "2026-01-23": { open: "7:30am", close: "5:45pm" },
  "2026-01-24": { open: "10am", close: "5:45pm" },
  "2026-01-25": { open: "12pm", close: "7:45pm" },
  // Week starting Jan 26
  "2026-01-26": { open: "7:30am", close: "7:45pm" },
  "2026-01-27": { open: "7:30am", close: "7:45pm" },
  "2026-01-28": { open: "7:30am", close: "7:45pm" },
  "2026-01-29": { open: "7:30am", close: "7:45pm" },
  "2026-01-30": { open: "7:30am", close: "5:45pm" },
  "2026-01-31": { open: "10am", close: "5:45pm" },
  "2026-02-01": { open: "12pm", close: "7:45pm" },
};

// Regular weekly pattern (fallback)
const HSL_DEFAULT_HOURS = {
  0: { open: "12pm", close: "7:45pm" }, // Sunday
  1: { open: "7:30am", close: "7:45pm" }, // Monday
  2: { open: "7:30am", close: "7:45pm" }, // Tuesday
  3: { open: "7:30am", close: "7:45pm" }, // Wednesday
  4: { open: "7:30am", close: "7:45pm" }, // Thursday
  5: { open: "7:30am", close: "5:45pm" }, // Friday
  6: { open: "10am", close: "5:45pm" }, // Saturday
};

// Get HSL hours for a specific date
function getHslHours(dateStr) {
  // Check specific date first
  if (HSL_HOURS_DATA[dateStr]) {
    return HSL_HOURS_DATA[dateStr];
  }
  // Fall back to regular weekly pattern
  const date = new Date(dateStr + "T12:00:00");
  const dayOfWeek = date.getDay();
  return HSL_DEFAULT_HOURS[dayOfWeek];
}

// Parse time like "7:30am" to decimal hours
function parseHslTime(timeStr) {
  const match = timeStr.match(/(\d+):?(\d*)(am|pm)/i);
  if (!match) return 0;
  let h = parseInt(match[1]);
  const m = parseInt(match[2] || 0);
  if (match[3].toLowerCase() === "pm" && h !== 12) h += 12;
  if (match[3].toLowerCase() === "am" && h === 12) h = 0;
  return h + m / 60;
}

const FALLBACK_LIBRARIES = [
  {
    id: "18th-ave",
    name: "18th Avenue Library",
    address: "175 W. 18th Ave, Columbus, OH",
    rooms: [],
  },
  {
    id: "thompson",
    name: "Thompson Library",
    address: "1858 Neil Ave, Columbus, OH",
    rooms: [],
  },
  {
    id: "faes",
    name: "FAES Library",
    fullName: "Food, Agricultural, and Environmental Sciences Library",
    address: "2120 Fyffe Rd, Columbus, OH",
    rooms: [],
  },
  {
    id: "hsl",
    name: "Health Sciences Library",
    subtitle: "(University Hospital)",
    address: "376 W. 10th Ave, Columbus, OH",
    bookingUrl: "https://hsl-osu.libcal.com/spaces?lid=694&gid=24674",
    rooms: [],
  },
];

// Library filter options
const LIBRARY_OPTIONS = [
  { id: "18th-ave", name: "18th Avenue", icon: "📚" },
  { id: "thompson", name: "Thompson", icon: "🏛️" },
  { id: "faes", name: "FAES", icon: "🌿" },
  { id: "hsl", name: "Health Sciences", icon: "🏥" },
];

// Library icons mapping
const LIBRARY_ICONS = {
  "18th-ave": "📚",
  thompson: "🏛️",
  faes: "🌿",
  hsl: "🏥",
};

const DEFAULT_LIBRARY_FILTER = ["18th-ave", "thompson", "faes"]; // HSL unchecked by default

const AMENITY_ICONS = { whiteboard: "📝", monitor: "🖥️", "video-conf": "📹" };

// Time options for filter (30-min intervals from 7am to 11:30pm)
const TIME_OPTIONS = [];
for (let h = 7; h <= 23; h++) {
  for (let m = 0; m < 60; m += 30) {
    if (h === 23 && m > 30) continue; // Stop at 11:30pm
    const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
    const period = h >= 12 ? "PM" : "AM";
    const label = `${hour}:${m.toString().padStart(2, "0")} ${period}`;
    const value = h * 60 + m; // Minutes since midnight
    TIME_OPTIONS.push({ label, value });
  }
}

function formatTimeDisplay(timeStr) {
  return timeStr.replace(/([ap]m)/i, " $1").toUpperCase();
}

// Parse time string (e.g., "2:30pm") to minutes since midnight
function parseTimeToMinutes(timeStr) {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})([ap]m)$/i);
  if (!match) return null;
  let [, hourStr, minStr, period] = match;
  let hour = parseInt(hourStr);
  const minute = parseInt(minStr);
  if (period.toLowerCase() === "pm" && hour !== 12) hour += 12;
  if (period.toLowerCase() === "am" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

// Check if room has ALL slots free in a given time range
function roomHasEntireBlockFree(
  room,
  startMinutes,
  endMinutes,
  currentMinutes,
  isToday,
) {
  if (!room.slots || room.slots.length === 0) return false;

  // Get all slots in the time range
  const slotsInRange = room.slots.filter((slot) => {
    const slotMinutes = parseTimeToMinutes(slot.time);
    if (slotMinutes === null) return false;
    return slotMinutes >= startMinutes && slotMinutes < endMinutes;
  });

  // Check if we have all expected slots (every 30 min) and all are available
  const expectedSlotCount = (endMinutes - startMinutes) / 30;
  if (slotsInRange.length < expectedSlotCount) return false;

  // All slots must be available (and not in the past for today)
  return slotsInRange.every((slot) => {
    if (!slot.available) return false;
    if (isToday) {
      const slotMinutes = parseTimeToMinutes(slot.time);
      if (slotMinutes !== null && slotMinutes + 30 <= currentMinutes)
        return false;
    }
    return true;
  });
}

// Check if room has X consecutive minutes of free slots
function roomHasConsecutiveFree(
  room,
  requiredMinutes,
  currentMinutes,
  isToday,
) {
  if (!room.slots || room.slots.length === 0) return false;

  // Get available future slots sorted by time
  const availableSlots = room.slots
    .filter((slot) => {
      if (!slot.available) return false;
      if (isToday) {
        const slotMinutes = parseTimeToMinutes(slot.time);
        if (slotMinutes !== null && slotMinutes + 30 <= currentMinutes)
          return false;
      }
      return true;
    })
    .map((slot) => parseTimeToMinutes(slot.time))
    .filter((m) => m !== null)
    .sort((a, b) => a - b);

  if (availableSlots.length === 0) return false;

  // Find consecutive sequences
  const requiredSlots = requiredMinutes / 30;
  let consecutiveCount = 1;

  for (let i = 1; i < availableSlots.length; i++) {
    if (availableSlots[i] === availableSlots[i - 1] + 30) {
      consecutiveCount++;
      if (consecutiveCount >= requiredSlots) return true;
    } else {
      consecutiveCount = 1;
    }
  }

  return consecutiveCount >= requiredSlots;
}

// Get all consecutive free blocks of required duration
function getConsecutiveFreeBlocks(
  room,
  requiredMinutes,
  currentMinutes,
  isToday,
) {
  if (!room.slots || room.slots.length === 0) return [];

  // Get available future slots sorted by time
  const availableSlots = room.slots
    .filter((slot) => {
      if (!slot.available) return false;
      if (isToday) {
        const slotMinutes = parseTimeToMinutes(slot.time);
        if (slotMinutes !== null && slotMinutes + 30 <= currentMinutes)
          return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aMin = parseTimeToMinutes(a.time) || 0;
      const bMin = parseTimeToMinutes(b.time) || 0;
      return aMin - bMin;
    });

  if (availableSlots.length === 0) return [];

  const requiredSlots = requiredMinutes / 30;
  const blocks = [];
  let currentBlock = [availableSlots[0]];

  for (let i = 1; i < availableSlots.length; i++) {
    const prevMinutes = parseTimeToMinutes(availableSlots[i - 1].time);
    const currMinutes = parseTimeToMinutes(availableSlots[i].time);

    if (currMinutes === prevMinutes + 30) {
      currentBlock.push(availableSlots[i]);
    } else {
      // End of consecutive block
      if (currentBlock.length >= requiredSlots) {
        blocks.push([...currentBlock]);
      }
      currentBlock = [availableSlots[i]];
    }
  }

  // Check last block
  if (currentBlock.length >= requiredSlots) {
    blocks.push(currentBlock);
  }

  return blocks;
}

// Generate array of next 8 days (today + 7 days ahead)
function getNext8Days() {
  const days = [];
  const today = new Date();

  for (let i = 0; i < 8; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);

    // Use local date, not UTC (toISOString converts to UTC which can shift the date)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;

    days.push({
      date: date,
      dateStr: dateStr,
      label:
        i === 0
          ? "Today"
          : i === 1
            ? "Tomorrow"
            : date.toLocaleDateString("en-US", { weekday: "short" }),
      fullLabel: date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    });
  }
  return days;
}

// HSL Hours Display Component - clean 7-day view
function HslHoursDisplay({ selectedDate }) {
  const days = [];
  const today = new Date();

  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);

    // Use local date, not UTC
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;

    const hours = getHslHours(dateStr);
    const isSelected = dateStr === selectedDate;
    const dayName =
      i === 0
        ? "Today"
        : date.toLocaleDateString("en-US", { weekday: "short" });

    days.push({ dateStr, dayName, hours, isSelected, dayNum: date.getDate() });
  }

  return (
    <div className="bg-slate-700/30 rounded-lg p-3 mb-4">
      <p className="text-xs text-slate-400 mb-2 font-medium">
        HSL Hours This Week
      </p>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => (
          <div
            key={day.dateStr}
            className={`text-center p-2 rounded-md transition-all ${
              day.isSelected
                ? "bg-indigo-600/40 ring-1 ring-indigo-500"
                : "bg-slate-800/50"
            }`}
          >
            <div
              className={`text-xs font-medium ${day.isSelected ? "text-indigo-300" : "text-slate-400"}`}
            >
              {day.dayName}
            </div>
            <div
              className={`text-[10px] mt-1 ${day.isSelected ? "text-slate-200" : "text-slate-500"}`}
            >
              {day.hours.open}
            </div>
            <div
              className={`text-[10px] ${day.isSelected ? "text-slate-200" : "text-slate-500"}`}
            >
              {day.hours.close}
            </div>
            {day.hours.note && (
              <div
                className="text-[9px] text-amber-400 mt-0.5 truncate"
                title={day.hours.note}
              >
                {day.hours.note}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DatePicker({ selectedDate, onDateChange, days }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {days.map((day) => (
        <button
          key={day.dateStr}
          onClick={() => onDateChange(day.dateStr)}
          className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            selectedDate === day.dateStr
              ? "bg-indigo-600 text-white"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          <div>{day.label}</div>
          <div className="text-xs opacity-70">{day.date.getDate()}</div>
        </button>
      ))}
    </div>
  );
}

function TimeFilter({
  startTime,
  endTime,
  onStartChange,
  onEndChange,
  onClear,
}) {
  // All end times after start (no max limit)
  const validEndOptions = TIME_OPTIONS.filter(
    (opt) => startTime === null || opt.value > startTime,
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-400">From:</label>
        <select
          value={startTime ?? ""}
          onChange={(e) =>
            onStartChange(e.target.value ? parseInt(e.target.value) : null)
          }
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
        >
          <option value="">Any</option>
          {TIME_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-400">To:</label>
        <select
          value={endTime ?? ""}
          onChange={(e) =>
            onEndChange(e.target.value ? parseInt(e.target.value) : null)
          }
          disabled={startTime === null}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="">Any</option>
          {validEndOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {(startTime !== null || endTime !== null) && (
        <button
          onClick={onClear}
          className="text-sm text-slate-400 hover:text-white px-2 py-1"
        >
          Clear
        </button>
      )}

      {startTime !== null && endTime !== null && (
        <span className="text-xs text-slate-500">
          ({(endTime - startTime) / 60}h block)
        </span>
      )}
    </div>
  );
}

// Duration options for consecutive free slot filter
const DURATION_OPTIONS = [
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
  { value: 90, label: "1.5 hours" },
  { value: 120, label: "2 hours" },
  { value: 150, label: "2.5 hours" },
  { value: 180, label: "3 hours" },
  { value: 210, label: "3.5 hours" },
  { value: 240, label: "4 hours" },
  { value: 300, label: "5 hours" },
  { value: 360, label: "6 hours" },
  { value: 420, label: "7 hours" },
  { value: 480, label: "8 hours" },
];

function DurationFilter({ duration, onDurationChange, onClear }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-400">
          Minimum consecutive free:
        </label>
        <select
          value={duration ?? ""}
          onChange={(e) =>
            onDurationChange(e.target.value ? parseInt(e.target.value) : null)
          }
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
        >
          <option value="">Any</option>
          {DURATION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {duration !== null && (
        <button
          onClick={onClear}
          className="text-sm text-slate-400 hover:text-white px-2 py-1"
        >
          Clear
        </button>
      )}
    </div>
  );
}

function LibraryFilter({ selectedLibraries, onToggle }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {LIBRARY_OPTIONS.map((lib) => {
        const isSelected = selectedLibraries.includes(lib.id);
        return (
          <button
            key={lib.id}
            onClick={() => onToggle(lib.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
              isSelected
                ? "bg-indigo-600/20 border-indigo-500 text-white"
                : "bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300"
            }`}
          >
            <span className="text-base">{lib.icon}</span>
            <span className="text-sm font-medium">{lib.name}</span>
            {isSelected && <span className="text-indigo-400 text-xs">✓</span>}
          </button>
        );
      })}
    </div>
  );
}

function TimeSlotGrid({
  slots,
  currentTime,
  isToday,
  isClosed,
  timeFilter,
  durationFilter,
  room,
}) {
  if (isClosed) {
    return <p className="text-sm text-slate-500 italic">Closed</p>;
  }

  if (!slots || slots.length === 0) {
    return (
      <p className="text-sm text-slate-500 italic">No reservations available</p>
    );
  }

  const currentMinutes = currentTime.hour * 60 + currentTime.minute;

  // If duration filter is active, show only consecutive free blocks
  if (durationFilter !== null && room) {
    const blocks = getConsecutiveFreeBlocks(
      room,
      durationFilter,
      currentMinutes,
      isToday,
    );

    if (blocks.length === 0) {
      return (
        <p className="text-sm text-slate-500 italic">
          No consecutive {durationFilter / 60}h+ blocks available
        </p>
      );
    }

    return (
      <div className="space-y-2">
        {blocks.map((block, blockIdx) => {
          const startTime = block[0].time;
          const endSlot = block[block.length - 1];
          const endMinutes = parseTimeToMinutes(endSlot.time) + 30;
          const endHour = Math.floor(endMinutes / 60);
          const endMin = endMinutes % 60;
          const endPeriod = endHour >= 12 ? "pm" : "am";
          const endHourDisplay =
            endHour > 12 ? endHour - 12 : endHour === 0 ? 12 : endHour;
          const endTime = `${endHourDisplay}:${endMin.toString().padStart(2, "0")}${endPeriod}`;
          const duration = block.length * 30;
          const durationStr =
            duration >= 60 ? `${duration / 60}h` : `${duration}min`;

          return (
            <div
              key={blockIdx}
              className="bg-emerald-600/20 border border-emerald-500/30 rounded-lg p-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-emerald-400 font-medium">
                  {formatTimeDisplay(startTime)} - {formatTimeDisplay(endTime)}
                </span>
                <span className="text-xs text-emerald-300 bg-emerald-600/30 px-2 py-0.5 rounded">
                  {durationStr}
                </span>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {block.map((slot, idx) => (
                  <div
                    key={idx}
                    className="px-2 py-1 text-xs rounded bg-emerald-600 text-white"
                  >
                    {formatTimeDisplay(slot.time)}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Normal display - filter slots based on time
  const filteredSlots = slots.filter((slot) => {
    const slotMinutes = parseTimeToMinutes(slot.time);
    if (slotMinutes === null) return true;

    const slotEndMinutes = slotMinutes + 30;

    // Filter out past slots for today
    if (isToday && slotEndMinutes <= currentMinutes) {
      return false;
    }

    // If time filter is set, only show slots in that range
    if (timeFilter.start !== null && slotMinutes < timeFilter.start) {
      return false;
    }
    if (timeFilter.end !== null && slotMinutes >= timeFilter.end) {
      return false;
    }

    return true;
  });

  if (filteredSlots.length === 0) {
    if (timeFilter.start !== null || timeFilter.end !== null) {
      return (
        <p className="text-sm text-slate-500 italic">
          No slots in selected time range
        </p>
      );
    }
    return (
      <p className="text-sm text-slate-500 italic">
        {isToday ? "Closed for today" : "No reservations available"}
      </p>
    );
  }

  // Check if a slot is in the highlighted range
  const isInFilterRange = (slotTime) => {
    if (timeFilter.start === null || timeFilter.end === null) return false;
    const slotMinutes = parseTimeToMinutes(slotTime);
    return (
      slotMinutes !== null &&
      slotMinutes >= timeFilter.start &&
      slotMinutes < timeFilter.end
    );
  };

  return (
    <div className="flex flex-wrap gap-1">
      {filteredSlots.map((slot, idx) => {
        const inRange = isInFilterRange(slot.time);
        return (
          <div
            key={idx}
            className={`px-2 py-1 text-xs rounded ${
              slot.available
                ? inRange
                  ? "bg-emerald-500 text-white ring-2 ring-emerald-300"
                  : "bg-emerald-600 text-white"
                : "bg-slate-700 text-slate-500"
            }`}
            title={slot.available ? "Available" : "Booked"}
          >
            {formatTimeDisplay(slot.time)}
          </div>
        );
      })}
    </div>
  );
}

function RoomCard({
  room,
  currentTime,
  isToday,
  isClosed,
  timeFilter,
  durationFilter,
}) {
  const parseTime = (timeStr) => {
    const match = timeStr.match(/^(\d{1,2}):(\d{2})([ap]m)$/i);
    if (!match) return null;
    let [, hourStr, minStr, period] = match;
    let hour = parseInt(hourStr);
    const minute = parseInt(minStr);
    if (period.toLowerCase() === "pm" && hour !== 12) hour += 12;
    if (period.toLowerCase() === "am" && hour === 12) hour = 0;
    return { hour, minute, total: hour * 60 + minute };
  };

  const currentMinutes = currentTime.hour * 60 + currentTime.minute;

  // Filter slots based on time and time filter
  const relevantSlots =
    room.slots?.filter((slot) => {
      const parsed = parseTime(slot.time);
      if (!parsed) return false;

      const slotEndMinutes = parsed.total + 30;

      // Filter out past slots for today
      if (isToday && slotEndMinutes <= currentMinutes) {
        return false;
      }

      // Apply time filter
      if (timeFilter.start !== null && parsed.total < timeFilter.start) {
        return false;
      }
      if (timeFilter.end !== null && parsed.total >= timeFilter.end) {
        return false;
      }

      return true;
    }) || [];

  const availableCount = isClosed
    ? 0
    : relevantSlots.filter((s) => s.available).length;
  const nextAvailable = isClosed
    ? null
    : relevantSlots.find((s) => s.available);

  // Get consecutive blocks if duration filter is active
  const consecutiveBlocks =
    durationFilter !== null
      ? getConsecutiveFreeBlocks(room, durationFilter, currentMinutes, isToday)
      : [];

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="font-semibold text-white">Room {room.name}</h3>
          <p className="text-sm text-slate-400">
            Floor {room.floor} • {room.capacity} people
          </p>
        </div>
        <div className="text-right">
          {isClosed ? (
            <span className="text-sm font-medium text-slate-500">Closed</span>
          ) : durationFilter !== null ? (
            <>
              <span
                className={`text-sm font-medium ${consecutiveBlocks.length > 0 ? "text-emerald-400" : "text-red-400"}`}
              >
                {consecutiveBlocks.length > 0
                  ? `${consecutiveBlocks.length} block${consecutiveBlocks.length > 1 ? "s" : ""}`
                  : "No blocks"}
              </span>
              <p className="text-xs text-slate-500">
                {durationFilter / 60}h+ consecutive
              </p>
            </>
          ) : (
            <>
              <span
                className={`text-sm font-medium ${availableCount > 0 ? "text-emerald-400" : "text-red-400"}`}
              >
                {availableCount > 0
                  ? `${availableCount} ${availableCount === 1 ? "slot" : "slots"}`
                  : "Full"}
              </span>
              {nextAvailable && (
                <p className="text-xs text-slate-500">
                  Next: {formatTimeDisplay(nextAvailable.time)}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3 text-sm text-slate-400">
        {room.amenities?.map((a) => (
          <span key={a} title={a}>
            {AMENITY_ICONS[a] || a}
          </span>
        ))}
      </div>

      <TimeSlotGrid
        slots={room.slots}
        currentTime={currentTime}
        isToday={isToday}
        isClosed={isClosed}
        timeFilter={timeFilter}
        durationFilter={durationFilter}
        room={room}
      />
    </div>
  );
}

function LibrarySection({
  library,
  currentTime,
  expanded,
  onToggle,
  isToday,
  timeFilter,
  durationFilter,
  selectedDate,
}) {
  const isHSL = library.id === "hsl";

  const parseTime = (timeStr) => {
    const match = timeStr.match(/^(\d{1,2}):(\d{2})([ap]m)$/i);
    if (!match) return null;
    let [, hourStr, minStr, period] = match;
    let hour = parseInt(hourStr);
    const minute = parseInt(minStr);
    if (period.toLowerCase() === "pm" && hour !== 12) hour += 12;
    if (period.toLowerCase() === "am" && hour === 12) hour = 0;
    return { hour, minute, total: hour * 60 + minute };
  };

  const currentMinutes = currentTime.hour * 60 + currentTime.minute;
  const currentHour = currentTime.hour + currentTime.minute / 60;

  // Get library hours - prefer API hours over defaults
  let hours = LIBRARY_HOURS[library.id] || { open: 0, close: 24 };
  let buildingHoursStr = null;

  // Use hours from API if available (dynamically fetched from LibCal)
  // API now returns { building: {...}, reservation: {...} }
  if (library.hours && !isHSL) {
    const reservationHours = library.hours.reservation;
    const buildingHours = library.hours.building;

    // Use reservation hours for filtering/availability logic
    if (reservationHours) {
      if (reservationHours.closed) {
        hours = { ...hours, open: 0, close: 0, name: "Closed", closed: true };
      } else if (
        reservationHours.open !== null &&
        reservationHours.close !== null
      ) {
        hours = {
          ...hours,
          open: reservationHours.open,
          close: reservationHours.close,
          name: `${reservationHours.openStr || ""} - ${reservationHours.closeStr || ""}`,
        };
      }
    }

    // Get building hours for display
    if (buildingHours) {
      if (buildingHours.closed) {
        buildingHoursStr = "Closed";
      } else if (buildingHours.openStr) {
        // Handle 24 Hours with note
        if (buildingHours.openStr === "24 Hours") {
          buildingHoursStr = "24 Hours";
          if (buildingHours.note) {
            buildingHoursStr += ` (${buildingHours.note})`;
          }
        } else {
          buildingHoursStr = `${buildingHours.openStr} - ${buildingHours.closeStr || ""}`;
        }
      }
    }
  }

  // For HSL, get the actual hours for the selected date
  if (isHSL) {
    const hslDayHours = getHslHours(selectedDate);
    hours = {
      ...hours,
      open: parseHslTime(hslDayHours.open),
      close: parseHslTime(hslDayHours.close),
      name: `${hslDayHours.open} - ${hslDayHours.close}`,
      note: hslDayHours.note,
    };
  }

  // Check if library is closed for the day
  const isClosedForDay = hours.closed === true;

  // Check if library is currently closed (only matters for today)
  // Only consider "closed" if we're PAST closing time, not before opening
  // Before opening, we still want to show future availability
  const isPastClosing =
    isToday && (isClosedForDay || currentHour >= hours.close);
  const isBeforeOpening =
    isToday && !isClosedForDay && currentHour < hours.open;

  // Filter rooms based on filter criteria
  const filteredRooms =
    library.rooms?.filter((room) => {
      // If time range filter is set, check if room has entire block free
      if (timeFilter.start !== null && timeFilter.end !== null) {
        if (
          !roomHasEntireBlockFree(
            room,
            timeFilter.start,
            timeFilter.end,
            currentMinutes,
            isToday,
          )
        ) {
          return false;
        }
      }

      // If duration filter is set, check if room has consecutive free slots
      if (durationFilter !== null) {
        if (
          !roomHasConsecutiveFree(room, durationFilter, currentMinutes, isToday)
        ) {
          return false;
        }
      }

      return true;
    }) || [];

  // Calculate available slots from filtered rooms (filter out past slots)
  const totalAvailable = isPastClosing
    ? 0
    : filteredRooms.reduce((acc, room) => {
        const slots =
          room.slots?.filter((s) => {
            const parsed = parseTime(s.time);
            if (!parsed) return false;

            const slotEndMinutes = parsed.total + 30;

            // Filter out past slots for today
            if (isToday && slotEndMinutes <= currentMinutes) {
              return false;
            }

            // Apply time filter for display
            if (timeFilter.start !== null && parsed.total < timeFilter.start) {
              return false;
            }
            if (timeFilter.end !== null && parsed.total >= timeFilter.end) {
              return false;
            }

            return true;
          }) || [];
        return acc + slots.filter((s) => s.available).length;
      }, 0);

  // Find the first available slot time across all rooms
  const firstAvailableSlot = (() => {
    if (isPastClosing) return null;

    let earliest = null;
    filteredRooms.forEach((room) => {
      room.slots?.forEach((slot) => {
        if (!slot.available) return;
        const parsed = parseTime(slot.time);
        if (!parsed) return;

        const slotEndMinutes = parsed.total + 30;

        // Skip past slots for today
        if (isToday && slotEndMinutes <= currentMinutes) return;

        // Apply time filter
        if (timeFilter.start !== null && parsed.total < timeFilter.start)
          return;
        if (timeFilter.end !== null && parsed.total >= timeFilter.end) return;

        if (earliest === null || parsed.total < earliest.total) {
          earliest = { ...parsed, time: slot.time };
        }
      });
    });
    return earliest;
  })();

  // Determine badge type
  const getBadgeInfo = () => {
    // Check if library is closed for the whole day
    if (isClosedForDay) {
      return { text: "Closed", color: "bg-slate-600/20 text-slate-400" };
    }

    if (isToday) {
      if (isPastClosing)
        return { text: "Closed", color: "bg-slate-600/20 text-slate-400" };
      if (isBeforeOpening)
        return { text: "Opens Soon", color: "bg-amber-600/20 text-amber-400" };
      return { text: "Open", color: "bg-emerald-600/20 text-emerald-400" };
    }
    // Future dates - show Available or Full
    if (totalAvailable > 0) {
      return { text: "Available", color: "bg-emerald-600/20 text-emerald-400" };
    }
    return { text: "Full", color: "bg-red-600/20 text-red-400" };
  };
  const badge = getBadgeInfo();

  return (
    <div className="mb-4">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 bg-slate-800 rounded-lg hover:bg-slate-750 transition-all"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-slate-700 flex items-center justify-center text-2xl">
            {LIBRARY_ICONS[library.id] || "🏛️"}
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-white">
                {library.name}
                {library.subtitle && (
                  <span className="text-slate-400 font-normal ml-1">
                    {library.subtitle}
                  </span>
                )}
              </h2>
              <span className={`px-2 py-0.5 text-xs rounded ${badge.color}`}>
                {badge.text}
              </span>
              {library.isLive && badge.text === "Open" && (
                <span className="px-2 py-0.5 bg-emerald-600/20 text-emerald-400 text-xs rounded">
                  Live
                </span>
              )}
            </div>
            {library.fullName && (
              <p className="text-xs text-slate-500">{library.fullName}</p>
            )}
            <p className="text-sm text-slate-400">{library.address}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            {isPastClosing || isClosedForDay ? (
              <>
                <span className="text-slate-500 font-medium">Closed</span>
                {isToday ? (
                  <p className="text-sm text-slate-500">Reopens tomorrow</p>
                ) : (
                  <p className="text-sm text-slate-500">
                    {filteredRooms.length} rooms
                  </p>
                )}
              </>
            ) : (
              <>
                <span
                  className={`font-medium ${totalAvailable > 0 ? "text-emerald-400" : "text-red-400"}`}
                >
                  {totalAvailable} slots
                </span>
                {firstAvailableSlot ? (
                  <p className="text-sm text-slate-400">
                    First available:{" "}
                    {formatTimeDisplay(firstAvailableSlot.time)}
                  </p>
                ) : (
                  <p className="text-sm text-slate-500">
                    {filteredRooms.length} rooms
                  </p>
                )}
              </>
            )}
          </div>
          <span
            className={`transition-transform text-slate-400 ${expanded ? "rotate-180" : ""}`}
          >
            ▼
          </span>
        </div>
      </button>

      {expanded && (
        <div className="mt-4 pl-4">
          {/* Show HSL weekly hours for HSL library */}
          {isHSL && <HslHoursDisplay selectedDate={selectedDate} />}

          {/* Show operating hours for non-HSL */}
          {!isHSL && (
            <div className="text-xs text-slate-500 mb-3">
              {buildingHoursStr && <p>Building Hours: {buildingHoursStr}</p>}
              {hours.name && <p>Reservation Hours: {hours.name}</p>}
            </div>
          )}

          {library.scrapedAt && (
            <p className="text-xs text-slate-500 mb-3">
              Last updated: {new Date(library.scrapedAt).toLocaleTimeString()}
            </p>
          )}

          {library.rooms?.length === 0 ? (
            <p className="text-slate-500 italic mb-4">
              {isPastClosing || isClosedForDay
                ? "Closed for today"
                : "No room data available"}
            </p>
          ) : filteredRooms.length === 0 &&
            (timeFilter.start !== null || durationFilter !== null) ? (
            <p className="text-slate-500 italic mb-4">
              No rooms match the filter criteria
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredRooms.map((room, idx) => (
                <RoomCard
                  key={idx}
                  room={room}
                  currentTime={currentTime}
                  isToday={isToday}
                  isClosed={isPastClosing || isClosedForDay}
                  timeFilter={timeFilter}
                  durationFilter={durationFilter}
                />
              ))}
            </div>
          )}

          {/* Only show booking button for HSL */}
          {isHSL && library.bookingUrl && (
            <a
              href={library.bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block mt-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-center rounded-lg transition-all"
            >
              Book on LibCal →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const days = useMemo(() => getNext8Days(), []);
  const [selectedDate, setSelectedDate] = useState(days[0].dateStr);
  const [libraries, setLibraries] = useState([]);
  const [loading, setLoading] = useState(
    () => !(INITIAL?.libraryCache && Object.keys(INITIAL.libraryCache).length),
  );
  const [expandedLibraries, setExpandedLibraries] = useState([]);
  const [currentTime, setCurrentTime] = useState({
    hour: 12,
    minute: 0,
    display: "Loading...",
  });
  const [apiStatus, setApiStatus] = useState(INITIAL ? "online" : "checking");
  const hasBoot = !!(
    INITIAL?.libraryCache && Object.keys(INITIAL.libraryCache).length
  );
  const [libraryCache] = useState(() => INITIAL?.libraryCache ?? {});

  const [timeFilter, setTimeFilter] = useState({ start: null, end: null });
  const [durationFilter, setDurationFilter] = useState(null); // Minimum consecutive free minutes
  const [libraryFilter, setLibraryFilter] = useState(DEFAULT_LIBRARY_FILTER);

  const isToday = selectedDate === days[0].dateStr;

  const isRefreshingSoon =
    currentTime.minute !== null && currentTime.minute !== undefined
      ? Date.now() % 60000 > 57000
      : false;

  // Filter libraries based on checkbox selection
  const filteredLibraries = libraries.filter((lib) =>
    libraryFilter.includes(lib.id),
  );

  const toggleLibraryFilter = (id) => {
    setLibraryFilter((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id],
    );
  };

  // Sync with backend server once, then tick using local clock + offset
  useEffect(() => {
    let serverOffset = 0;
    let dateStr = "";

    const formatDateStr = (ms) =>
      new Date(ms).toLocaleDateString("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        month: "short",
        day: "numeric",
      });

    async function syncWithServer() {
      // If server injected a timestamp into HTML, don’t call /api/time from browser
      if (INITIAL?.serverNowMs) {
        serverOffset = INITIAL.serverNowMs - Date.now();
        dateStr = formatDateStr(Date.now() + serverOffset);
        return;
      }

      try {
        const before = Date.now();
        const res = await fetch(apiUrl("/api/time"));
        const data = await res.json();
        const after = Date.now();

        // Use midpoint to reduce RTT bias
        const midpoint = Math.floor((before + after) / 2);
        serverOffset = data.timestamp - midpoint;
        dateStr = data.dateStr || formatDateStr(Date.now() + serverOffset);
      } catch {
        serverOffset = 0;
        dateStr = formatDateStr(Date.now());
      }
    }

    function updateDisplay() {
      const nowMs = Date.now() + serverOffset;

      // Get NY time components reliably
      const ny = new Date(nowMs);
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(ny)
        .reduce((acc, p) => {
          if (p.type !== "literal") acc[p.type] = p.value;
          return acc;
        }, {});

      const hours = Number(parts.hour);
      const minutes = Number(parts.minute);
      const seconds = Number(parts.second);

      const displayHour = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
      const period = hours >= 12 ? "PM" : "AM";

      // Update dateStr at midnight (NY time) or if not set
      if (!dateStr || (hours === 0 && minutes === 0 && seconds === 0)) {
        dateStr = formatDateStr(nowMs);
      }

      setCurrentTime({
        hour: hours,
        minute: minutes,
        display: `${displayHour}:${String(minutes).padStart(2, "0")} ${period} EST, ${dateStr}`,
      });
    }

    let displayInterval = null;
    let syncInterval = null;

    // Initial sync then start ticking
    (async () => {
      await syncWithServer();
      updateDisplay();

      // Tick once per second (smooth enough, avoids insane re-renders)
      displayInterval = setInterval(updateDisplay, 1000);

      // Re-sync every 5 minutes ONLY if we needed /api/time
      if (!INITIAL?.serverNowMs) {
        syncInterval = setInterval(
          async () => {
            await syncWithServer();
          },
          5 * 60 * 1000,
        );
      }
    })();

    return () => {
      if (displayInterval) clearInterval(displayInterval);
      if (syncInterval) clearInterval(syncInterval);
    };
  }, []);

  useEffect(() => {
    // If injected initial data into the HTML, don't hit /api/* from the browser.
    if (hasBoot) {
      setApiStatus("online");
      setLoading(false);
      return;
    }

    return () => clearInterval(interval);
  }, [days, hasBoot]);

  // Update libraries state when selected date or cache changes
  useEffect(() => {
    if (libraryCache[selectedDate]?.data) {
      setLibraries(libraryCache[selectedDate].data);
    }
  }, [selectedDate, libraryCache]);

  const toggleLibrary = (id) => {
    setExpandedLibraries((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id],
    );
  };

  const parseTime = (timeStr) => {
    const match = timeStr.match(/^(\d{1,2}):(\d{2})([ap]m)$/i);
    if (!match) return null;
    let [, hourStr, minStr, period] = match;
    let hour = parseInt(hourStr);
    const minute = parseInt(minStr);
    if (period.toLowerCase() === "pm" && hour !== 12) hour += 12;
    if (period.toLowerCase() === "am" && hour === 12) hour = 0;
    return { hour, minute, total: hour * 60 + minute };
  };

  const stats = useMemo(() => {
    const currentMinutes = currentTime.hour * 60 + currentTime.minute;
    const currentHour = currentTime.hour + currentTime.minute / 60;

    let totalRooms = 0;
    let availableSlots = 0;

    filteredLibraries.forEach((lib) => {
      // Get library hours - prefer API hours over defaults
      let hours = LIBRARY_HOURS[lib.id] || { open: 0, close: 24 };

      // Use hours from API if available (now has reservation/building structure)
      if (lib.hours && lib.id !== "hsl") {
        const reservationHours = lib.hours.reservation;
        if (reservationHours) {
          if (reservationHours.closed) {
            hours = { ...hours, open: 0, close: 0, closed: true };
          } else if (
            reservationHours.open !== null &&
            reservationHours.close !== null
          ) {
            hours = {
              ...hours,
              open: reservationHours.open,
              close: reservationHours.close,
            };
          }
        }
      }

      // Check if library is closed for the day or past closing time
      const isClosedForDay = hours.closed === true;
      const isPastClosing =
        isToday && (isClosedForDay || currentHour >= hours.close);

      // Skip if library is closed
      if (isPastClosing || (isToday && isClosedForDay)) return;

      // Filter rooms based on filter criteria
      const filteredRooms =
        lib.rooms?.filter((room) => {
          if (timeFilter.start !== null && timeFilter.end !== null) {
            if (
              !roomHasEntireBlockFree(
                room,
                timeFilter.start,
                timeFilter.end,
                currentMinutes,
                isToday,
              )
            ) {
              return false;
            }
          }
          if (durationFilter !== null) {
            if (
              !roomHasConsecutiveFree(
                room,
                durationFilter,
                currentMinutes,
                isToday,
              )
            ) {
              return false;
            }
          }
          return true;
        }) || [];

      totalRooms += filteredRooms.length;

      availableSlots += filteredRooms.reduce((a, r) => {
        const slots =
          r.slots?.filter((s) => {
            const parsed = parseTime(s.time);
            if (!parsed) return false;

            const slotEndMinutes = parsed.total + 30;

            if (isToday && slotEndMinutes <= currentMinutes) return false;
            if (timeFilter.start !== null && parsed.total < timeFilter.start)
              return false;
            if (timeFilter.end !== null && parsed.total >= timeFilter.end)
              return false;

            return true;
          }) || [];
        return a + slots.filter((s) => s.available).length;
      }, 0);
    });

    return { totalRooms, availableSlots };
  }, [filteredLibraries, currentTime, isToday, timeFilter, durationFilter]);

  const selectedDayLabel =
    days.find((d) => d.dateStr === selectedDate)?.fullLabel || "";

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-3xl">📚</span>
              <div>
                <h1 className="text-xl font-bold">LibrarySpot</h1>
                <p className="text-xs text-slate-400">OSU Study Room Finder</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm text-white font-medium">
                  {currentTime.display}
                </p>
                <p className="text-xs text-slate-500">
                  {isToday ? "Viewing Today" : `Viewing ${selectedDayLabel}`}
                  {isRefreshingSoon && (
                    <span className="ml-2 text-emerald-400">↻</span>
                  )}
                </p>
              </div>
              <div
                className={`w-2 h-2 rounded-full ${isRefreshingSoon ? "animate-spin" : "animate-pulse"} ${
                  apiStatus === "online"
                    ? "bg-emerald-500"
                    : apiStatus === "offline"
                      ? "bg-amber-500"
                      : "bg-slate-500"
                }`}
              />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Date Picker */}
        <div className="mb-4">
          <p className="text-sm text-slate-400 mb-2">Select Date</p>
          <DatePicker
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            days={days}
          />
        </div>

        {/* Time Range Filter - Find rooms with entire block free */}
        <div className="mb-4">
          <p className="text-sm text-slate-400 mb-2">
            Find Rooms Free for Entire Time Block
          </p>
          <TimeFilter
            startTime={timeFilter.start}
            endTime={timeFilter.end}
            onStartChange={(start) =>
              setTimeFilter((prev) => ({
                start,
                end:
                  start === null
                    ? null
                    : prev.end && prev.end <= start
                      ? null
                      : prev.end,
              }))
            }
            onEndChange={(end) => setTimeFilter((prev) => ({ ...prev, end }))}
            onClear={() => setTimeFilter({ start: null, end: null })}
          />
        </div>

        {/* Duration Filter - Find rooms with X consecutive free slots */}
        <div className="mb-4">
          <p className="text-sm text-slate-400 mb-2">
            Or Find Rooms with Consecutive Free Time
          </p>
          <DurationFilter
            duration={durationFilter}
            onDurationChange={setDurationFilter}
            onClear={() => setDurationFilter(null)}
          />
        </div>

        {/* Library Filter */}
        <div className="mb-6">
          <p className="text-sm text-slate-400 mb-2">Show Libraries</p>
          <LibraryFilter
            selectedLibraries={libraryFilter}
            onToggle={toggleLibraryFilter}
          />
        </div>

        {/* API Status Banner */}
        {apiStatus === "offline" && (
          <div className="bg-amber-600/10 border border-amber-600/30 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <p className="text-amber-400 font-medium">
                  Backend not running
                </p>
                <p className="text-sm text-amber-400/70 mt-1">
                  Start the server with:{" "}
                  <code className="bg-slate-800 px-2 py-0.5 rounded">
                    cd server && node index.js
                  </code>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-slate-800 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-white">
              {filteredLibraries.length}
            </p>
            <p className="text-sm text-slate-400">Libraries</p>
          </div>
          <div className="bg-slate-800 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-white">{stats.totalRooms}</p>
            <p className="text-sm text-slate-400">Rooms</p>
          </div>
          <div className="bg-slate-800 rounded-lg p-4 text-center">
            <p
              className={`text-2xl font-bold ${stats.availableSlots > 0 ? "text-emerald-400" : "text-red-400"}`}
            >
              {stats.availableSlots}
            </p>
            <p className="text-sm text-slate-400">Available Slots</p>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <div className="animate-spin text-4xl mb-4">⏳</div>
            <p className="text-slate-400">
              Loading availability for {selectedDayLabel}...
            </p>
          </div>
        )}

        {/* Libraries */}
        {!loading &&
          filteredLibraries.map((library) => (
            <LibrarySection
              key={library.id}
              library={library}
              currentTime={currentTime}
              expanded={expandedLibraries.includes(library.id)}
              onToggle={() => toggleLibrary(library.id)}
              isToday={isToday}
              timeFilter={timeFilter}
              durationFilter={durationFilter}
              selectedDate={selectedDate}
            />
          ))}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 mt-12 py-6">
        <div className="max-w-6xl mx-auto px-4 text-center text-slate-500 text-sm">
          <p>Built by Xinci Ma • Data from OSU Libraries</p>
          <p className="mt-1">Not affiliated with The Ohio State University</p>
        </div>
      </footer>
    </div>
  );
}
