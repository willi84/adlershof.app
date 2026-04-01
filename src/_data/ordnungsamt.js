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
  const searchText = createSearchText(item);
  const createdDate = createdAt ? new Date(createdAt) : null;

  return {
    id: item.id,
    meldungsNummern: item.meldungsNummern || [],
    bezirk: item.bezirk,
    betreff: item.betreff,
    erstellungsDatum: item.erstellungsDatum,
    createdAt,
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

  return {
    years,
    monthsByYear,
  };
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
    issues: collected.issues,
  };
}

async function readLocalDump() {
  try {
    const raw = await fs.readFile(LOCAL_DUMP_PATH, "utf8");
    const parsed = JSON.parse(raw);

    return {
      ...parsed,
      source: {
        ...parsed.source,
        mode: "local-dump-existing",
        modeLabel: "Lokaler 1-Jahres-Dump (bestehend)",
        dumpPath: LOCAL_DUMP_PATH,
      },
      filters: buildAvailableFilters(parsed.issues || []),
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
  const requestUrl = `${API_BASE_URL}/all`;
  const listResponse = await fetchJson(requestUrl);
  const allIssues = Array.isArray(listResponse.index) ? listResponse.index : [];
  const collected = await collectIssuesFromList(allIssues);
  const generationDurationMs = Date.now() - startedAt;

  return {
    source: {
      mode: "live-all",
      modeLabel: "Live Vollabzug",
      requestUrl,
      scopeLabel: "Alle sichtbaren Meldungen",
    },
    generatedAt: new Date().toISOString(),
    generationDurationMs,
    generationDurationText: formatDuration(generationDurationMs),
    filters: buildAvailableFilters(collected.issues),
    totals: collected.totals,
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
