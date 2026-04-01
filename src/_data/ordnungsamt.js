const fs = require("fs/promises");
const path = require("path");
const fetch = require("node-fetch");

const API_BASE_URL =
  "https://ordnungsamt.berlin.de/frontend.webservice.opendata/api/meldungen";
const DETAIL_PAGE_BASE_URL =
  "https://ordnungsamt.berlin.de/frontend/meldungDetail?id=";
const LOCAL_DATA_DIR = path.join(process.cwd(), "data");
const LOCAL_DUMP_PATH = path.join(LOCAL_DATA_DIR, "ordnungsamt-dev-year.json");
const DETAIL_CONCURRENCY = Number(process.env.ORDNUNGSAMT_DETAIL_CONCURRENCY || 8);
const LIVE_START_YEAR = Number(process.env.ORDNUNGSAMT_LIVE_START_YEAR || 2020);
const THIRD_PARTY_PATTERNS = [
  { label: "BSR", terms: ["berliner stadtreinigung", " bsr ", "bsr"] },
  { label: "Telekom", terms: ["telekom"] },
  { label: "BVG", terms: ["bvg"] },
  { label: "Berliner Wasserbetriebe", terms: ["wasserbetriebe", "berliner wasser", "bwb"] },
  { label: "Stromnetz Berlin", terms: ["stromnetz berlin"] },
  { label: "Vattenfall", terms: ["vattenfall"] },
  { label: "Vodafone", terms: ["vodafone"] },
  { label: "GASAG", terms: ["gasag"] },
  { label: "Deutsche Bahn", terms: ["deutsche bahn", " db ", "s-bahn"] },
];

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatDuration(durationMs) {
  return `${(durationMs / 1000).toFixed(2)} s`;
}

function normalizeText(value) {
  return `${value || ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function parseBerlinDate(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const match = value.match(
    /^(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2}):(\d{2})(?::(\d{2}))?$/
  );

  if (!match) {
    return null;
  }

  const [, day, month, year, hours, minutes, seconds = "00"] = match;
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+01:00`;
}

function roundCoordinate(value, digits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }

  return Number(number.toFixed(digits));
}

function createAddress(item) {
  if (!item.strasse) {
    return "";
  }

  return item.hausNummer
    ? `${item.strasse} ${item.hausNummer}`.trim()
    : item.strasse;
}

function createSearchText(item) {
  return [
    item.betreff,
    item.sachverhalt,
    item.status,
    item.strasse,
    item.hausNummer,
    item.plz,
    item.anmerkungZumOrt,
    item.meldungsNummern ? item.meldungsNummern.join(" ") : "",
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}


function detectThirdParties(item) {
  const text = normalizeText(
    [item.betreff, item.sachverhalt, item.rueckMeldungAnBuerger]
      .filter(Boolean)
      .join(" ")
  );

  return THIRD_PARTY_PATTERNS
    .filter((entry) => entry.terms.some((term) => text.includes(term)))
    .map((entry) => entry.label);
}

function isTreptowKoepenick(item) {
  return normalizeText(item.bezirk) === "treptow-kopenick";
}

function isLikelyAdlershof(item) {
  const searchText = normalizeText(
    [
      item.betreff,
      item.sachverhalt,
      item.strasse,
      item.plz,
      item.anmerkungZumOrt,
    ]
      .filter(Boolean)
      .join(" ")
  );

  return searchText.includes("adlershof") || searchText.includes("12489");
}

function createHotspot(item) {
  const address = createAddress(item);

  if (address) {
    return address;
  }

  if (item.lat && item.lng) {
    return `${roundCoordinate(item.lat)}, ${roundCoordinate(item.lng)}`;
  }

  if (item.anmerkungZumOrt) {
    return item.anmerkungZumOrt;
  }

  return "Nicht naher benannt";
}

function getYearRange() {
  const end = new Date();
  const start = new Date();
  start.setFullYear(end.getFullYear() - 1);

  return {
    from: formatDate(start),
    to: formatDate(end),
  };
}


function extractImageUrls(value, collector = new Set()) {
  if (!value) {
    return [...collector];
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => extractImageUrls(entry, collector));
    return [...collector];
  }

  if (typeof value === "object") {
    Object.values(value).forEach((entry) => extractImageUrls(entry, collector));
    return [...collector];
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(trimmed)) {
      collector.add(trimmed);
    }
  }

  return [...collector];
}

function getTodayDateKey() {
  return formatDate(new Date());
}

function getHistoricalRanges(startYear) {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const safeStartYear = Number.isFinite(startYear)
    ? Math.min(startYear, currentYear)
    : currentYear;
  const ranges = [];

  for (let year = safeStartYear; year <= currentYear; year += 1) {
    const start = new Date(Date.UTC(year, 0, 1));
    const end =
      year === currentYear
        ? currentDate
        : new Date(Date.UTC(year, 11, 31, 23, 59, 59));

    ranges.push({
      year,
      from: formatDate(start),
      to: formatDate(end),
    });
  }

  return ranges;
}

function isProductionBuild() {
  return (
    process.env.ELEVENTY_ENV === "production" ||
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL === "1"
  );
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "adlershof.app dashboard",
    },
  });

  if (!response.ok) {
    throw new Error(`OpenData request failed with ${response.status}: ${url}`);
  }

  return response.json();
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}

async function fetchDetail(item) {
  try {
    const detailResponse = await fetchJson(`${API_BASE_URL}/${item.id}`);
    const detail = Array.isArray(detailResponse.index)
      ? detailResponse.index[0]
      : null;

    return {
      ...item,
      ...detail,
    };
  } catch (error) {
    return item;
  }
}

function normalizeIssue(item) {
  const address = createAddress(item);
  const createdAt = parseBerlinDate(item.erstellungsDatum);
  const updatedAt = parseBerlinDate(item.letzteAenderungDatum);
  const searchText = createSearchText(item);
  const createdDate = createdAt ? new Date(createdAt) : null;
  const updatedDate = updatedAt ? new Date(updatedAt) : null;
  const resolutionDurationHours =
    createdDate && updatedDate
      ? Math.max(0, (updatedDate.getTime() - createdDate.getTime()) / 36e5)
      : null;
  const resolutionDurationDays =
    resolutionDurationHours === null
      ? null
      : Number((resolutionDurationHours / 24).toFixed(2));
  const thirdParties = detectThirdParties(item);
  const imageUrls = extractImageUrls(item);

  return {
    id: item.id,
    meldungsNummern: item.meldungsNummern || [],
    bezirk: item.bezirk,
    betreff: item.betreff,
    erstellungsDatum: item.erstellungsDatum,
    createdAt,
    updatedAt,
    year: createdDate ? createdDate.getUTCFullYear() : null,
    month: createdDate ? createdDate.getUTCMonth() + 1 : null,
    status: item.status,
    sachverhalt: item.sachverhalt,
    strasse: item.strasse || "",
    hausNummer: item.hausNummer || "",
    address,
    plz: item.plz || "",
    lat: item.lat || "",
    lng: item.lng || "",
    anmerkungZumOrt: item.anmerkungZumOrt || "",
    letzteAenderungDatum: item.letzteAenderungDatum || "",
    rueckMeldungAnBuerger: item.rueckMeldungAnBuerger || "",
    detailUrl: `${DETAIL_PAGE_BASE_URL}${item.id}`,
    hotspot: createHotspot(item),
    searchText,
    resolutionDurationHours,
    resolutionDurationDays,
    thirdParties,
    imageUrls,
    isResolved: normalizeText(item.status) === "erledigt",
  };
}

function sortIssues(issues) {
  return [...issues].sort((a, b) => {
    const left = a.createdAt || "";
    const right = b.createdAt || "";
    return right.localeCompare(left);
  });
}

function buildAvailableFilters(issues) {
  const years = [...new Set(issues.map((item) => item.year).filter(Boolean))].sort(
    (a, b) => b - a
  );

  const monthsByYear = {};
  for (const year of years) {
    monthsByYear[year] = [...new Set(
      issues
        .filter((item) => item.year === year && item.month)
        .map((item) => item.month)
    )].sort((a, b) => b - a);
  }

  const statuses = [...new Set(issues.map((item) => item.status).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, "de")
  );
  const thirdParties = [...new Set(issues.flatMap((item) => item.thirdParties || []))].sort(
    (a, b) => a.localeCompare(b, "de")
  );

  return {
    years,
    monthsByYear,
    statuses,
    thirdParties,
  };
}

function getTodayIssues(issues) {
  const todayKey = getTodayDateKey();
  return issues.filter((item) => (item.createdAt || "").slice(0, 10) === todayKey);
}

async function collectIssuesFromList(allIssues) {
  const districtCandidates = allIssues.filter(
    (item) => isTreptowKoepenick(item) || isLikelyAdlershof(item)
  );

  const details = await mapWithConcurrency(
    districtCandidates,
    DETAIL_CONCURRENCY,
    fetchDetail
  );

  const issues = sortIssues(
    details.filter((item) => item && isLikelyAdlershof(item)).map(normalizeIssue)
  );

  return {
    issues,
    totals: {
      source: allIssues.length,
      districtCandidates: districtCandidates.length,
      adlershof: issues.length,
    },
  };
}

function mergeCollectionsById(collections) {
  const sourceItems = new Map();

  collections.forEach((collection) => {
    collection.items.forEach((item) => {
      if (item && item.id) {
        sourceItems.set(item.id, item);
      }
    });
  });

  return [...sourceItems.values()];
}

async function fetchIssuesForRange(range) {
  const requestUrl = `${API_BASE_URL}?von=${range.from}&bis=${range.to}`;
  const listResponse = await fetchJson(requestUrl);

  return {
    ...range,
    requestUrl,
    items: Array.isArray(listResponse.index) ? listResponse.index : [],
  };
}

async function fetchYearDumpData() {
  const startedAt = Date.now();
  const range = getYearRange();
  const requestUrl = `${API_BASE_URL}?von=${range.from}&bis=${range.to}`;
  const listResponse = await fetchJson(requestUrl);
  const allIssues = Array.isArray(listResponse.index) ? listResponse.index : [];
  const collected = await collectIssuesFromList(allIssues);
  const generationDurationMs = Date.now() - startedAt;

  return {
    source: {
      mode: "local-dump-generated",
      modeLabel: "Lokaler 1-Jahres-Dump",
      requestUrl,
      dumpPath: LOCAL_DUMP_PATH,
      scopeLabel: "Letzte 12 Monate",
      range,
    },
    generatedAt: new Date().toISOString(),
    generationDurationMs,
    generationDurationText: formatDuration(generationDurationMs),
    filters: buildAvailableFilters(collected.issues),
    totals: collected.totals,
    todayIssues: getTodayIssues(collected.issues),
    issues: collected.issues,
  };
}

async function readLocalDump() {
  try {
    const raw = await fs.readFile(LOCAL_DUMP_PATH, "utf8");
    const parsed = JSON.parse(raw);

    const normalizedIssues = sortIssues((parsed.issues || []).map(normalizeIssue));

    return {
      ...parsed,
      source: {
        ...parsed.source,
        mode: "local-dump-existing",
        modeLabel: "Lokaler 1-Jahres-Dump (bestehend)",
        dumpPath: LOCAL_DUMP_PATH,
      },
      filters: buildAvailableFilters(normalizedIssues),
      todayIssues: getTodayIssues(normalizedIssues),
      totals: {
        ...(parsed.totals || {}),
        adlershof: normalizedIssues.length,
      },
      issues: normalizedIssues,
    };
  } catch (error) {
    return null;
  }
}

async function writeLocalDump(data) {
  await fs.mkdir(LOCAL_DATA_DIR, { recursive: true });
  await fs.writeFile(LOCAL_DUMP_PATH, JSON.stringify(data, null, 2));
}

async function getLocalDataset() {
  const existingDump = await readLocalDump();
  if (existingDump) {
    return existingDump;
  }

  const generatedDump = await fetchYearDumpData();
  await writeLocalDump(generatedDump);
  return generatedDump;
}

async function getLiveDataset() {
  const startedAt = Date.now();
  const ranges = getHistoricalRanges(LIVE_START_YEAR);
  const yearlyResponses = await Promise.all(ranges.map(fetchIssuesForRange));
  const allIssues = mergeCollectionsById(yearlyResponses);
  const collected = await collectIssuesFromList(allIssues);
  const generationDurationMs = Date.now() - startedAt;

  return {
    source: {
      mode: "live-historical-range",
      modeLabel: "Live Jahresabzug",
      requestUrl: `${API_BASE_URL}?von=${ranges[0].from}&bis=${ranges[ranges.length - 1].to}`,
      requestUrls: yearlyResponses.map((entry) => entry.requestUrl),
      scopeLabel: `${ranges[0].year} bis ${ranges[ranges.length - 1].year}`,
    },
    generatedAt: new Date().toISOString(),
    generationDurationMs,
    generationDurationText: formatDuration(generationDurationMs),
    filters: buildAvailableFilters(collected.issues),
    totals: collected.totals,
    todayIssues: getTodayIssues(collected.issues),
    issues: collected.issues,
  };
}

module.exports = async function () {
  const dataset = isProductionBuild()
    ? await getLiveDataset()
    : await getLocalDataset();

  return {
    source: {
      baseUrl: API_BASE_URL,
      detailPageBaseUrl: DETAIL_PAGE_BASE_URL,
      detailConcurrency: DETAIL_CONCURRENCY,
      localDumpPath: LOCAL_DUMP_PATH,
    },
    dataset,
  };
};
