const search = () => {
  const areaItems = document.querySelector(".items");
  const areaNoResult = document.getElementById("no-result");
  const searchInput = document.getElementById("search");

  if (!areaItems || !areaNoResult || !searchInput) {
    return;
  }

  const searchValue = searchInput.value.toLowerCase();
  const items = document.querySelectorAll("[data-item]");

  items.forEach((store) => {
    const name = store.getAttribute("data-name").toLowerCase();
    if (name.includes(searchValue)) {
      store.classList.remove("hidden");
    } else {
      store.classList.add("hidden");
    }
  });

  const foundItems = document.querySelectorAll("[data-item]:not(.hidden)");
  const searchValueNodes = document.querySelectorAll(".search__value");

  if (foundItems.length === 0) {
    areaNoResult.classList.remove("hidden");
    areaItems.classList.add("hidden");
    if (searchValueNodes[0]) {
      searchValueNodes[0].innerText = `${searchValue}`;
    }
  } else {
    areaNoResult.classList.add("hidden");
    areaItems.classList.remove("hidden");
  }

  const allMatches = document.getElementById("all_matches");
  if (allMatches) {
    allMatches.innerText = `${foundItems.length} von `;
  }
};

const dashboardState = {
  data: null,
  selectedYear: "all",
  selectedMonth: "all",
  searchValue: "",
};

const MONTH_LABELS = [
  "Januar",
  "Februar",
  "Maerz",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

const escapeHtml = (value) =>
  `${value || ""}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const aggregateCounts = (items, getKey, limit = 10) => {
  const counts = new Map();

  items.forEach((item) => {
    const key = getKey(item);
    if (!key) {
      return;
    }

    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "de"))
    .slice(0, limit);
};

const renderRanking = (elementId, stats) => {
  const node = document.getElementById(elementId);
  if (!node) {
    return;
  }

  if (!stats.length) {
    node.innerHTML = '<li class="dashboard__ranking-empty">Keine Daten</li>';
    return;
  }

  node.innerHTML = stats
    .map(
      (stat) =>
        `<li><span>${escapeHtml(stat.label)}</span><strong>${stat.count}</strong></li>`
    )
    .join("");
};

const renderIssues = (items) => {
  const node = document.getElementById("issues-list");
  if (!node) {
    return;
  }

  if (!items.length) {
    node.innerHTML = '<li class="item issue-item issue-item--empty">Keine Meldungen fuer diesen Filter.</li>';
    return;
  }

  node.innerHTML = items
    .map((item) => {
      const numbers = (item.meldungsNummern || [])
        .map(
          (nummer) =>
            `<a class="issue-item__number-link" href="${escapeHtml(
              item.detailUrl
            )}" target="_blank" rel="noreferrer">${escapeHtml(nummer)}</a>`
        )
        .join(", ");

      const feedback = item.rueckMeldungAnBuerger
        ? `<p class="issue-item__feedback"><strong>Rueckmeldung:</strong> ${escapeHtml(
            item.rueckMeldungAnBuerger
          )}</p>`
        : "";

      const lastChange = item.letzteAenderungDatum
        ? `<div><dt>Letzte Aenderung</dt><dd>${escapeHtml(
            item.letzteAenderungDatum
          )}</dd></div>`
        : "";

      return `
        <li class="item issue-item">
          <div class="issue-item__header">
            <div>
              <h3>
                <a class="issue-item__title-link" href="${escapeHtml(
                  item.detailUrl
                )}" target="_blank" rel="noreferrer">${escapeHtml(item.betreff)}</a>
              </h3>
              <p class="small">
                ${escapeHtml(item.erstellungsDatum)}${numbers ? ` · ${numbers}` : ""}
              </p>
            </div>
            <span class="issue-item__status">${escapeHtml(item.status)}</span>
          </div>

          <p>${escapeHtml(item.sachverhalt)}</p>

          <dl class="issue-item__meta">
            <div><dt>Adresse</dt><dd>${escapeHtml(item.address || "k. A.")}</dd></div>
            <div><dt>Strasse</dt><dd>${escapeHtml(item.strasse || "k. A.")}</dd></div>
            <div><dt>PLZ</dt><dd>${escapeHtml(item.plz || "k. A.")}</dd></div>
            <div><dt>Bezirk</dt><dd>${escapeHtml(item.bezirk || "k. A.")}</dd></div>
            ${lastChange}
          </dl>
          ${feedback}
        </li>
      `;
    })
    .join("");
};

const getAvailableMonthsForYear = (year) => {
  const filters = dashboardState.data?.filters;
  if (!filters || year === "all") {
    return [];
  }

  return filters.monthsByYear?.[year] || [];
};

const populateYearSelect = () => {
  const select = document.getElementById("issue-year");
  const years = dashboardState.data?.filters?.years || [];

  if (!select) {
    return;
  }

  select.innerHTML = [
    '<option value="all">Alle Jahre</option>',
    ...years.map((year) => `<option value="${year}">${year}</option>`),
  ].join("");

  select.value = dashboardState.selectedYear;
};

const populateMonthSelect = () => {
  const select = document.getElementById("issue-month");
  const months = getAvailableMonthsForYear(dashboardState.selectedYear);

  if (!select) {
    return;
  }

  select.innerHTML = [
    '<option value="all">Alle Monate</option>',
    ...months.map(
      (month) =>
        `<option value="${month}">${MONTH_LABELS[month - 1] || month}</option>`
    ),
  ].join("");

  if (
    dashboardState.selectedMonth !== "all" &&
    !months.includes(Number(dashboardState.selectedMonth))
  ) {
    dashboardState.selectedMonth = "all";
  }

  select.value = dashboardState.selectedMonth;
};

const getFilteredIssues = () => {
  const items = dashboardState.data?.issues || [];
  const searchValue = dashboardState.searchValue;

  return items.filter((item) => {
    const yearMatches =
      dashboardState.selectedYear === "all" ||
      `${item.year}` === `${dashboardState.selectedYear}`;
    const monthMatches =
      dashboardState.selectedMonth === "all" ||
      `${item.month}` === `${dashboardState.selectedMonth}`;
    const searchMatches =
      !searchValue || (item.searchText || "").toLowerCase().includes(searchValue);

    return yearMatches && monthMatches && searchMatches;
  });
};

const updateSummary = (items) => {
  const visibleCountNode = document.getElementById("issue-visible-count");
  const countNode = document.getElementById("issue-count");
  const summaryNode = document.getElementById("issue-summary-text");
  const noResult = document.getElementById("issue-no-result");
  const searchValueNode = noResult
    ? noResult.querySelector(".search__value")
    : null;
  const totalIssues = dashboardState.data?.issues?.length || 0;

  if (visibleCountNode) {
    visibleCountNode.innerText = `${items.length}`;
  }

  if (countNode) {
    countNode.innerText = `${items.length}`;
  }

  if (summaryNode) {
    summaryNode.innerHTML = `<span id="issue-visible-count">${items.length}</span> von ${totalIssues} Meldungen sichtbar`;
  }

  if (noResult) {
    noResult.classList.toggle("hidden", items.length !== 0);
  }

  if (searchValueNode) {
    searchValueNode.innerText = dashboardState.searchValue;
  }
};

const renderDashboard = () => {
  const items = getFilteredIssues();

  updateSummary(items);
  renderRanking(
    "ranking-issue-types",
    aggregateCounts(items, (item) => item.betreff, 10)
  );
  renderRanking(
    "ranking-streets",
    aggregateCounts(items, (item) => item.strasse, 10)
  );
  renderRanking(
    "ranking-addresses",
    aggregateCounts(items, (item) => item.address, 10)
  );
  renderRanking(
    "ranking-status",
    aggregateCounts(items, (item) => item.status, 10)
  );
  renderIssues(items);
};

const initOrdnungsamtDashboard = () => {
  const dashboard = document.querySelector("[data-ordnungsamt-dashboard]");
  const dataNode = document.getElementById("ordnungsamt-data");

  if (!dashboard || !dataNode) {
    return;
  }

  dashboardState.data = JSON.parse(dataNode.textContent);

  const years = dashboardState.data.filters?.years || [];
  const latestYear = years[0] ? `${years[0]}` : "all";
  const latestMonth = latestYear !== "all"
    ? `${(dashboardState.data.filters?.monthsByYear?.[latestYear] || [])[0] || "all"}`
    : "all";

  dashboardState.selectedYear = latestYear;
  dashboardState.selectedMonth = latestMonth;

  populateYearSelect();
  populateMonthSelect();

  const yearSelect = document.getElementById("issue-year");
  const monthSelect = document.getElementById("issue-month");
  const searchInput = document.getElementById("issue-search");

  if (yearSelect) {
    yearSelect.addEventListener("change", (event) => {
      dashboardState.selectedYear = event.target.value;
      populateMonthSelect();
      renderDashboard();
    });
  }

  if (monthSelect) {
    monthSelect.addEventListener("change", (event) => {
      dashboardState.selectedMonth = event.target.value;
      renderDashboard();
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      dashboardState.searchValue = event.target.value.toLowerCase().trim();
      renderDashboard();
    });
  }

  renderDashboard();
};

const searchIssues = () => {
  const searchInput = document.getElementById("issue-search");
  dashboardState.searchValue = searchInput
    ? searchInput.value.toLowerCase().trim()
    : "";
  renderDashboard();
};

window.searchIssues = searchIssues;
document.addEventListener("DOMContentLoaded", initOrdnungsamtDashboard);
