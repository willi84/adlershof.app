const search = () => {
  const areaItems = document.querySelector('.items');
  const areaNoResult = document.getElementById('no-result');
  const searchInput = document.getElementById('search');

  if (!areaItems || !areaNoResult || !searchInput) {
    return;
  }

  const searchValue = searchInput.value.toLowerCase();
  const items = document.querySelectorAll('[data-item]');

  items.forEach((store) => {
    const name = store.getAttribute('data-name').toLowerCase();
    store.classList.toggle('hidden', !name.includes(searchValue));
  });

  const foundItems = document.querySelectorAll('[data-item]:not(.hidden)');
  const searchValueNodes = document.querySelectorAll('.search__value');

  areaNoResult.classList.toggle('hidden', foundItems.length !== 0);
  areaItems.classList.toggle('hidden', foundItems.length === 0);

  if (searchValueNodes[0]) {
    searchValueNodes[0].innerText = `${searchValue}`;
  }

  const allMatches = document.getElementById('all_matches');
  if (allMatches) {
    allMatches.innerText = `${foundItems.length} von `;
  }
};

const dashboardState = {
  data: null,
  selectedYear: 'all',
  selectedMonth: 'all',
  selectedStatus: 'all',
  selectedProvider: 'all',
  searchValue: '',
  map: null,
  markersLayer: null,
  itemDateMode: {},
  openDetails: {},
  collapsedWidgets: {},
};

const MONTH_LABELS = [
  'Januar',
  'Februar',
  'Maerz',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

const STATUS_META = {
  erledigt: {
    emoji: '✅',
    className: 'issue-item__status--done',
    itemClass: 'issue-item--status-done',
  },
  'in bearbeitung': {
    emoji: '🛠️',
    className: 'issue-item__status--progress',
    itemClass: 'issue-item--status-progress',
  },
};

const escapeHtml = (value) =>
  `${value || ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const normalizeText = (value) =>
  `${value || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const formatDurationDays = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 'k. A.';
  }

  return `${Number(value).toFixed(1)} Tage`;
};

const getStatusMeta = (status) => {
  const key = `${status || ''}`.toLowerCase();
  return STATUS_META[key] || {
    emoji: '📌',
    className: 'issue-item__status--default',
    itemClass: 'issue-item--status-default',
  };
};

const getHeatLevel = (count, maxCount) => {
  if (!count || !maxCount) {
    return 0;
  }

  return Math.max(1, Math.min(4, Math.ceil((count / maxCount) * 4)));
};

const HOTSPOT_SCALE = [
  { label: '1 Meldung', color: '#e8f7d6' },
  { label: '2-3 Meldungen', color: '#b8de6f' },
  { label: '4-6 Meldungen', color: '#f7b955' },
  { label: '7-10 Meldungen', color: '#ef6a4b' },
  { label: '11+ Meldungen', color: '#b91c1c' },
];

const getHotspotColor = (count) => {
  if (count >= 11) return HOTSPOT_SCALE[4].color;
  if (count >= 7) return HOTSPOT_SCALE[3].color;
  if (count >= 4) return HOTSPOT_SCALE[2].color;
  if (count >= 2) return HOTSPOT_SCALE[1].color;
  return HOTSPOT_SCALE[0].color;
};

const renderHotspotLegend = () => {
  const node = document.getElementById('hotspot-legend');
  if (!node) return;

  node.innerHTML = HOTSPOT_SCALE.map((entry) => `
    <span class="hotspot-legend__item">
      <span class="hotspot-legend__swatch" style="background:${entry.color}"></span>
      <span>${entry.label}</span>
    </span>
  `).join('');
};

const isWidgetCollapsed = (widgetId) => Boolean(dashboardState.collapsedWidgets[widgetId]);
const syncWidgetState = () => {
  document.querySelectorAll('[data-widget]').forEach((section) => {
    const widgetId = section.dataset.widget;
    const collapsed = isWidgetCollapsed(widgetId);
    section.classList.toggle('is-collapsed', collapsed);
    const button = section.querySelector('[data-action="toggle-widget"]');
    if (button) {
      button.innerText = collapsed ? 'Ausklappen' : 'Einklappen';
      button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      button.setAttribute('title', collapsed ? 'Widget anzeigen' : 'Widget ausblenden');
    }
  });
};

const aggregateCounts = (items, getKey) => {
  const counts = new Map();

  items.forEach((item) => {
    const key = getKey(item);
    if (!key) {
      return;
    }

    const current = counts.get(key) || { label: key, count: 0, durationSum: 0, durationCount: 0 };
    current.count += 1;

    if (item.isResolved && item.resolutionDurationDays !== null) {
      current.durationSum += item.resolutionDurationDays;
      current.durationCount += 1;
    }

    counts.set(key, current);
  });

  return [...counts.values()]
    .map((entry) => ({
      label: entry.label,
      count: entry.count,
      avgDurationDays:
        entry.durationCount > 0
          ? Number((entry.durationSum / entry.durationCount).toFixed(1))
          : null,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'de'));
};

const getOverallDurationStats = (items) => {
  const resolved = items.filter(
    (item) => item.isResolved && item.resolutionDurationDays !== null
  );

  if (!resolved.length) {
    return { avgDays: null, count: 0 };
  }

  const total = resolved.reduce((sum, item) => sum + item.resolutionDurationDays, 0);

  return {
    avgDays: Number((total / resolved.length).toFixed(1)),
    count: resolved.length,
  };
};

const createRankingListMarkup = (stats) =>
  stats
    .map(
      (stat) => `
        <li>
          <span>
            <strong>${escapeHtml(stat.label)}</strong>
            <small>${stat.count} Tickets · Ø ${escapeHtml(formatDurationDays(stat.avgDurationDays))}</small>
          </span>
          <strong>${stat.count}</strong>
        </li>
      `
    )
    .join('');

const renderRanking = (elementId, stats) => {
  const node = document.getElementById(elementId);
  if (!node) {
    return;
  }

  if (!stats.length) {
    node.innerHTML = '<li class="dashboard__ranking-empty">Keine Daten</li>';
    return;
  }

  const topStats = stats.slice(0, 5);
  const restStats = stats.slice(5);

  node.innerHTML = createRankingListMarkup(topStats);

  if (restStats.length) {
    node.innerHTML += `
      <li class="dashboard__ranking-more">
        <details>
          <summary>Weitere ${restStats.length} anzeigen</summary>
          <ul class="dashboard__ranking dashboard__ranking--nested">
            ${createRankingListMarkup(restStats)}
          </ul>
        </details>
      </li>
    `;
  }
};

const getItemDateMode = (itemId) => dashboardState.itemDateMode[itemId] || 'created';
const isItemDetailsOpen = (itemId) => Boolean(dashboardState.openDetails[itemId]);

const getIssueDateInfo = (item) => {
  const mode = getItemDateMode(item.id);
  if (mode === 'updated') {
    return {
      label: 'Abschlussdatum',
      value: item.letzteAenderungDatum || 'k. A.',
      toggleLabel: 'Meldungsdatum',
    };
  }

  return {
    label: 'Meldungsdatum',
    value: item.erstellungsDatum || 'k. A.',
    toggleLabel: 'Abschlussdatum',
  };
};

const renderTodayIssues = (items) => {
  const node = document.getElementById('today-issues-list');
  if (!node) {
    return;
  }

  if (!items.length) {
    node.innerHTML = '<li class="item issue-item issue-item--empty">Heute liegen noch keine Meldungen vor.</li>';
    return;
  }

  node.innerHTML = items
    .map((item) => {
      const image = (item.imageUrls || [])[0]
        ? `<img class="issue-item__image" src="${escapeHtml((item.imageUrls || [])[0])}" alt="Meldungsbild">`
        : '';
      return `
        <li class="item issue-item issue-item--compact ${getStatusMeta(item.status).itemClass}">
          ${image}
          <div class="issue-item__topline">
            <a class="issue-item__title-link" href="${escapeHtml(item.detailUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.betreff)}</a>
            <span class="issue-item__status ${getStatusMeta(item.status).className}">${escapeHtml(item.status)}</span>
          </div>
          <div class="issue-item__chips">
            <span class="issue-item__chip">🕒 ${escapeHtml(item.erstellungsDatum || 'k. A.')}</span>
            <span class="issue-item__chip">📍 ${escapeHtml(item.address || item.hotspot || 'k. A.')}</span>
          </div>
          <p class="issue-item__text">${escapeHtml(item.sachverhalt || '')}</p>
        </li>
      `;
    })
    .join('');
};

const renderIssues = (items) => {
  const node = document.getElementById('issues-list');
  if (!node) {
    return;
  }

  if (!items.length) {
    node.innerHTML = '<li class="item issue-item issue-item--empty">Keine Meldungen fuer diesen Filter.</li>';
    return;
  }

  node.innerHTML = items
    .map((item) => {
      const statusMeta = getStatusMeta(item.status);
      const numbers = (item.meldungsNummern || [])
        .map(
          (nummer) =>
            `<a class="issue-item__number-link" href="${escapeHtml(
              item.detailUrl
            )}" target="_blank" rel="noreferrer">${escapeHtml(nummer)}</a>`
        )
        .join(', ');
      const dateInfo = getIssueDateInfo(item);
      const detailsOpen = isItemDetailsOpen(item.id);
      const feedback = item.rueckMeldungAnBuerger
        ? `<p class="issue-item__feedback">💬 ${escapeHtml(item.rueckMeldungAnBuerger)}</p>`
        : '';
      const compactLocation = item.address || item.strasse || item.hotspot || 'k. A.';
      const durationChip = item.isResolved
        ? `⏱️ ${escapeHtml(formatDurationDays(item.resolutionDurationDays))}`
        : '🕒 offen';
      const thirdPartyChips = (item.thirdParties || [])
        .map((provider) => `<span class="issue-item__chip issue-item__chip--provider">🏢 ${escapeHtml(provider)}</span>`)
        .join('');

      return `
        <li class="item issue-item issue-item--compact ${statusMeta.itemClass}" data-issue-id="${escapeHtml(item.id)}">
          <div class="issue-item__topline">
            <a class="issue-item__title-link" href="${escapeHtml(
              item.detailUrl
            )}" target="_blank" rel="noreferrer">${statusMeta.emoji} ${escapeHtml(item.betreff)}</a>
            <span class="issue-item__status ${statusMeta.className}">${statusMeta.emoji} ${escapeHtml(item.status)}</span>
          </div>
          <div class="issue-item__chips">
            <span class="issue-item__chip">📍 ${escapeHtml(compactLocation)}</span>
            <span class="issue-item__chip">🗓️ ${escapeHtml(dateInfo.label)}: ${escapeHtml(dateInfo.value)}</span>
            <span class="issue-item__chip">${durationChip}</span>
            ${thirdPartyChips}
            ${numbers ? `<span class="issue-item__chip">🔗 ${numbers}</span>` : ''}
          </div>
          <p class="issue-item__text">${escapeHtml(item.sachverhalt)}</p>
          <div class="issue-item__footer-actions">
            <button type="button" class="issue-item__toggle" data-action="toggle-details" data-issue-id="${escapeHtml(item.id)}">
              ${detailsOpen ? 'Zusatzdaten verbergen' : 'Zusatzdaten'}
            </button>
            <button type="button" class="issue-item__toggle issue-item__toggle--date" data-action="toggle-date" data-issue-id="${escapeHtml(item.id)}">
              ${escapeHtml(dateInfo.toggleLabel)}
            </button>
          </div>
          ${detailsOpen ? `
            <div class="issue-item__details-panel">
              <dl class="issue-item__meta issue-item__meta--compact">
                <div><dt>PLZ</dt><dd>${escapeHtml(item.plz || 'k. A.')}</dd></div>
                <div><dt>Bezirk</dt><dd>${escapeHtml(item.bezirk || 'k. A.')}</dd></div>
                <div><dt>Straße</dt><dd>${escapeHtml(item.strasse || 'k. A.')}</dd></div>
                <div><dt>Adresse</dt><dd>${escapeHtml(item.address || 'k. A.')}</dd></div>
                <div><dt>Hotspot</dt><dd>${escapeHtml(item.hotspot || 'k. A.')}</dd></div>
                <div><dt>Dienstleister</dt><dd>${escapeHtml((item.thirdParties || []).join(', ') || 'k. A.')}</dd></div>
                <div><dt>Letzte Änderung</dt><dd>${escapeHtml(item.letzteAenderungDatum || 'k. A.')}</dd></div>
              </dl>
              ${feedback}
            </div>
          ` : ''}
        </li>
      `;
    })
    .join('');
};

const getAvailableMonthsForYear = (year) => {
  const filters = dashboardState.data?.filters;
  if (!filters || year === 'all') {
    return [];
  }

  return filters.monthsByYear?.[year] || [];
};

const populateYearSelect = () => {
  const select = document.getElementById('issue-year');
  const years = dashboardState.data?.filters?.years || [];

  if (!select) {
    return;
  }

  select.innerHTML = [
    '<option value="all">Alle Jahre</option>',
    ...years.map((year) => `<option value="${year}">${year}</option>`),
  ].join('');

  select.value = dashboardState.selectedYear;
};

const populateMonthSelect = () => {
  const select = document.getElementById('issue-month');
  const months = getAvailableMonthsForYear(dashboardState.selectedYear);

  if (!select) {
    return;
  }

  select.innerHTML = [
    '<option value="all">Alle Monate</option>',
    ...months.map(
      (month) => `<option value="${month}">${MONTH_LABELS[month - 1] || month}</option>`
    ),
  ].join('');

  if (dashboardState.selectedMonth !== 'all' && !months.includes(Number(dashboardState.selectedMonth))) {
    dashboardState.selectedMonth = 'all';
  }

  select.value = dashboardState.selectedMonth;
};

const populateStatusSelect = () => {
  const select = document.getElementById('issue-status');
  const statuses = dashboardState.data?.filters?.statuses || [];

  if (!select) {
    return;
  }

  select.innerHTML = [
    '<option value="all">Alle Status</option>',
    ...statuses.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`),
  ].join('');

  select.value = dashboardState.selectedStatus;
};

const populateProviderSelect = () => {
  const select = document.getElementById('issue-provider');
  const providers = dashboardState.data?.filters?.thirdParties || [];

  if (!select) {
    return;
  }

  select.innerHTML = [
    '<option value="all">Alle Dienstleister</option>',
    ...providers.map((provider) => `<option value="${escapeHtml(provider)}">${escapeHtml(provider)}</option>`),
  ].join('');

  select.value = dashboardState.selectedProvider;
};

const renderStatusButtons = () => {
  const node = document.getElementById('issue-status-buttons');
  const statuses = dashboardState.data?.filters?.statuses || [];

  if (!node) {
    return;
  }

  const allStatuses = ['all', ...statuses];
  node.innerHTML = allStatuses
    .map((status) => {
      const isAll = status === 'all';
      const label = isAll ? 'Alle Status' : status;
      const active = dashboardState.selectedStatus === status;
      return `<button type="button" class="issues-toolbar__button ${active ? 'is-active' : ''}" data-action="set-status" data-status="${escapeHtml(status)}">${escapeHtml(label)}</button>`;
    })
    .join('');
};

const matchesCommonFilters = (item) => {
  const searchValue = dashboardState.searchValue;
  const searchMatches = !searchValue || normalizeText(item.searchText || '').includes(searchValue);
  const statusMatches = dashboardState.selectedStatus === 'all' || item.status === dashboardState.selectedStatus;
  const providerMatches =
    dashboardState.selectedProvider === 'all' ||
    (item.thirdParties || []).includes(dashboardState.selectedProvider);

  return searchMatches && statusMatches && providerMatches;
};

const getActivitySourceIssues = () => {
  const items = dashboardState.data?.issues || [];
  return items.filter(matchesCommonFilters);
};

const getFilteredIssues = () => {
  const items = getActivitySourceIssues();

  return items.filter((item) => {
    const yearMatches = dashboardState.selectedYear === 'all' || `${item.year}` === `${dashboardState.selectedYear}`;
    const monthMatches = dashboardState.selectedMonth === 'all' || `${item.month}` === `${dashboardState.selectedMonth}`;
    return yearMatches && monthMatches;
  });
};

const updateSummary = (items, activityItems) => {
  const summaryNode = document.getElementById('issue-summary-text');
  const countNode = document.getElementById('issue-count');
  const noResult = document.getElementById('issue-no-result');
  const searchValueNode = noResult ? noResult.querySelector('.search__value') : null;
  const totalIssues = dashboardState.data?.issues?.length || 0;
  const durationStats = getOverallDurationStats(items);

  if (countNode) {
    countNode.innerText = `${items.length}`;
  }

  if (summaryNode) {
    summaryNode.innerHTML = `${items.length} von ${activityItems.length} gefilterten Meldungen sichtbar · Gesamt ${totalIssues} · ✅ ${durationStats.count} erledigt · Ø ${formatDurationDays(durationStats.avgDays)}`;
  }

  if (noResult) {
    noResult.classList.toggle('hidden', items.length !== 0);
  }

  if (searchValueNode) {
    searchValueNode.innerText = dashboardState.searchValue;
  }
};

const renderActivityHeatmap = (items) => {
  const node = document.getElementById('activity-heatmap');
  const years = dashboardState.data?.filters?.years || [];
  if (!node) {
    return;
  }

  if (!items.length || !years.length) {
    node.innerHTML = '<p class="activity-heatmap__empty">Keine Aktivitaet fuer diese Auswahl.</p>';
    return;
  }

  const selectedYear = dashboardState.selectedYear === 'all' ? `${years[0]}` : `${dashboardState.selectedYear}`;
  const yearCounts = new Map();
  items.forEach((item) => {
    const key = `${item.year}`;
    yearCounts.set(key, (yearCounts.get(key) || 0) + 1);
  });
  const maxYearCount = Math.max(...yearCounts.values(), 0);

  const monthCounts = new Map();
  items
    .filter((item) => `${item.year}` === selectedYear)
    .forEach((item) => {
      const key = `${item.month}`;
      monthCounts.set(key, (monthCounts.get(key) || 0) + 1);
    });
  const maxMonthCount = Math.max(...monthCounts.values(), 0);

  node.innerHTML = `
    <div class="activity-heatmap__years">
      ${years
        .map((year) => {
          const count = yearCounts.get(`${year}`) || 0;
          const level = getHeatLevel(count, maxYearCount);
          const active = `${year}` === selectedYear;
          return `
            <button type="button" class="activity-heatmap__year-pill activity-heatmap__cell--level-${level} ${active ? 'is-active' : ''}" data-action="select-year" data-year="${year}">
              <strong>${year}</strong>
              <span>${count}</span>
            </button>
          `;
        })
        .join('')}
    </div>
    <div class="activity-heatmap__months">
      ${Array.from({ length: 12 }, (_, index) => index + 1)
        .map((month) => {
          const count = monthCounts.get(`${month}`) || 0;
          const level = getHeatLevel(count, maxMonthCount);
          const active = `${dashboardState.selectedMonth}` === `${month}`;
          return `
            <button type="button" class="activity-heatmap__cell activity-heatmap__cell--compact activity-heatmap__cell--level-${level} ${active ? 'is-active' : ''}" data-action="select-month" data-year="${selectedYear}" data-month="${month}">
              <strong>${MONTH_LABELS[month - 1]}</strong>
              <span>${count} Meldungen</span>
            </button>
          `;
        })
        .join('')}
    </div>
  `;
};

const initMap = () => {
  if (!window.L || dashboardState.map) {
    return;
  }

  const mapElement = document.getElementById('issues-map');
  if (!mapElement) {
    return;
  }

  dashboardState.map = L.map(mapElement, {
    scrollWheelZoom: false,
  }).setView([52.435, 13.548], 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(dashboardState.map);

  dashboardState.markersLayer = L.layerGroup().addTo(dashboardState.map);
};

const updateMap = (items) => {
  if (!dashboardState.map || !dashboardState.markersLayer) {
    return;
  }

  dashboardState.markersLayer.clearLayers();
  const points = items.filter(
    (item) => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng))
  );

  if (!points.length) {
    dashboardState.map.setView([52.435, 13.548], 14);
    return;
  }

  const grouped = new Map();
  points.forEach((item) => {
    const lat = Number(item.lat);
    const lng = Number(item.lng);
    const key = `${lat.toFixed(4)}:${lng.toFixed(4)}`;
    const current = grouped.get(key) || { lat, lng, count: 0, sample: item };
    current.count += 1;
    grouped.set(key, current);
  });

  const weightedEntries = [...grouped.values()].sort((a, b) => b.count - a.count);
  const filteredEntries = weightedEntries.some((entry) => entry.count >= 2)
    ? weightedEntries.filter((entry) => entry.count >= 2)
    : weightedEntries;

  const bounds = [];
  filteredEntries.slice(0, 30).forEach((entry) => {
    const marker = L.circle([entry.lat, entry.lng], {
      radius: 35 + entry.count * 18,
      color: '#7f1d1d',
      weight: 2,
      fillColor: getHotspotColor(entry.count),
      fillOpacity: Math.min(0.7, 0.22 + entry.count * 0.06),
    });

    marker.bindPopup(`
      <strong>${escapeHtml(entry.sample.hotspot || entry.sample.address || entry.sample.strasse)}</strong><br>
      ${entry.count} Meldungen an diesem Hotspot<br>
      <a href="${escapeHtml(entry.sample.detailUrl)}" target="_blank" rel="noreferrer">Beispiel-Meldung oeffnen</a>
    `);

    marker.addTo(dashboardState.markersLayer);
    bounds.push([entry.lat, entry.lng]);
  });

  if (bounds.length === 1) {
    dashboardState.map.setView(bounds[0], 16);
  } else {
    dashboardState.map.fitBounds(bounds, { padding: [24, 24] });
  }
};

const syncExternalFilters = () => {
  const statusSelect = document.getElementById('issue-status');
  const providerSelect = document.getElementById('issue-provider');
  if (statusSelect) {
    statusSelect.value = dashboardState.selectedStatus;
  }
  if (providerSelect) {
    providerSelect.value = dashboardState.selectedProvider;
  }
  renderStatusButtons();
};

const renderDashboard = () => {
  const activityItems = getActivitySourceIssues();
  const items = getFilteredIssues();

  syncExternalFilters();
  updateSummary(items, activityItems);
  renderActivityHeatmap(activityItems);
  renderRanking('ranking-issue-types', aggregateCounts(items, (item) => item.betreff));
  renderRanking('ranking-streets', aggregateCounts(items, (item) => item.strasse));
  renderRanking('ranking-addresses', aggregateCounts(items, (item) => item.address));
  renderRanking('ranking-hotspots', aggregateCounts(items, (item) => item.hotspot));
  renderRanking('ranking-status', aggregateCounts(items, (item) => item.status));
  renderIssues(items);
  renderTodayIssues((dashboardState.data?.todayIssues || []).filter(matchesCommonFilters));
  updateMap(items);
  renderHotspotLegend();
  syncWidgetState();
};

const handleDashboardClick = (event) => {
  const button = event.target.closest('button');
  if (!button) {
    return;
  }

  const issueId = button.dataset.issueId;
  if (button.dataset.action === 'toggle-details' && issueId) {
    dashboardState.openDetails[issueId] = !dashboardState.openDetails[issueId];
    renderDashboard();
    return;
  }

  if (button.dataset.action === 'toggle-date' && issueId) {
    dashboardState.itemDateMode[issueId] = getItemDateMode(issueId) === 'created' ? 'updated' : 'created';
    renderDashboard();
    return;
  }

  if (button.dataset.action === 'select-year' && button.dataset.year) {
    dashboardState.selectedYear = button.dataset.year;
    dashboardState.selectedMonth = 'all';
    populateYearSelect();
    populateMonthSelect();
    renderDashboard();
    return;
  }

  if (button.dataset.action === 'select-month' && button.dataset.year && button.dataset.month) {
    dashboardState.selectedYear = button.dataset.year;
    dashboardState.selectedMonth = button.dataset.month;
    populateYearSelect();
    populateMonthSelect();
    renderDashboard();
    return;
  }

  if (button.dataset.action === 'set-status' && button.dataset.status) {
    dashboardState.selectedStatus = button.dataset.status;
    renderDashboard();
    return;
  }

  if (button.dataset.action === 'toggle-widget' && button.dataset.target) {
    const key = button.dataset.target;
    dashboardState.collapsedWidgets[key] = !dashboardState.collapsedWidgets[key];
    syncWidgetState();
  }
};

const initOrdnungsamtDashboard = () => {
  const dashboard = document.querySelector('[data-ordnungsamt-dashboard]');
  const dataNode = document.getElementById('ordnungsamt-data');

  if (!dashboard || !dataNode) {
    return;
  }

  dashboardState.data = JSON.parse(dataNode.textContent);

  const years = dashboardState.data.filters?.years || [];
  const latestYear = years[0] ? `${years[0]}` : 'all';
  const latestMonth = latestYear !== 'all'
    ? `${(dashboardState.data.filters?.monthsByYear?.[latestYear] || [])[0] || 'all'}`
    : 'all';

  dashboardState.selectedYear = latestYear;
  dashboardState.selectedMonth = latestMonth;

  populateYearSelect();
  populateMonthSelect();
  populateStatusSelect();
  populateProviderSelect();
  renderStatusButtons();
  initMap();
  syncWidgetState();

  const yearSelect = document.getElementById('issue-year');
  const monthSelect = document.getElementById('issue-month');
  const statusSelect = document.getElementById('issue-status');
  const providerSelect = document.getElementById('issue-provider');
  const searchInput = document.getElementById('issue-search');

  if (yearSelect) {
    yearSelect.addEventListener('change', (event) => {
      dashboardState.selectedYear = event.target.value;
      dashboardState.selectedMonth = 'all';
      populateMonthSelect();
      renderDashboard();
    });
  }

  if (monthSelect) {
    monthSelect.addEventListener('change', (event) => {
      dashboardState.selectedMonth = event.target.value;
      renderDashboard();
    });
  }

  if (statusSelect) {
    statusSelect.addEventListener('change', (event) => {
      dashboardState.selectedStatus = event.target.value;
      renderDashboard();
    });
  }

  if (providerSelect) {
    providerSelect.addEventListener('change', (event) => {
      dashboardState.selectedProvider = event.target.value;
      renderDashboard();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      dashboardState.searchValue = normalizeText(event.target.value);
      renderDashboard();
    });
  }

  dashboard.addEventListener('click', handleDashboardClick);
  renderDashboard();
};

const searchIssues = () => {
  const searchInput = document.getElementById('issue-search');
  dashboardState.searchValue = searchInput ? normalizeText(searchInput.value) : '';
  renderDashboard();
};

window.searchIssues = searchIssues;
document.addEventListener('DOMContentLoaded', initOrdnungsamtDashboard);
