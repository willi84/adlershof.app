const https = require('https');
const fs = require('fs');
const path = require('path');

const HERE_API_KEY = process.env.HERE_API_KEY;

const bbox = {
  north: 52.4445,
  south: 52.425,
  west: 13.509,
  east: 13.566
};

console.log("🛰️ Erwartete Requests:");
console.log("- OSM Overpass-Abfrage für: shop, amenity, office, healthcare, tourism, leisure, club");
console.log("- HERE Discover API mit bbox:", bbox);
console.log("- HERE Reverse-Geocoding für jeden POI (" + bbox.north + "," + bbox.east + ")");

function fetchOSMData() {
  const query = `
    [out:json][timeout:25];
    (
      node["shop"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      node["amenity"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      node["office"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      node["healthcare"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      node["tourism"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      node["leisure"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      node["club"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
    );
    out center;
  `;

  return new Promise((resolve, reject) => {
    const req = https.request('https://overpass-api.de/api/interpreter', { method: 'POST' }, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const results = json.elements
            .filter(e => e.tags?.name)
            .map(e => ({
              name: e.tags.name,
              type: e.tags.shop || e.tags.amenity || e.tags.office || e.tags.healthcare || e.tags.tourism || e.tags.leisure || e.tags.club || '',
              latitude: e.lat,
              longitude: e.lon,
              opening_hours: e.tags.opening_hours || '',
              website: e.tags.website || '',
              source: 'OSM'
            }));
          resolve(results);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(`data=${encodeURIComponent(query)}`);
    req.end();
  });
}

function fetchHereData() {
  const url = `https://discover.search.hereapi.com/v1/discover?in=bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}&limit=100&apiKey=${HERE_API_KEY}`;
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const items = json.items || [];
          const results = items.map(item => ({
            name: item.title,
            type: item.categories?.[0]?.name || '',
            latitude: item.position.lat,
            longitude: item.position.lng,
            opening_hours: item.openingHours?.text || '',
            website: item.contacts?.[0]?.www?.[0]?.value || '',
            source: 'HERE'
          }));
          resolve(results);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function reverseGeocode(lat, lon) {
  const url = `https://revgeocode.search.hereapi.com/v1/revgeocode?at=${lat},${lon}&lang=de-DE&apiKey=${HERE_API_KEY}`;
  return new Promise((resolve) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const item = json.items?.[0];
          if (item) {
            const address = item.address;
            resolve({
              address: address.label || '',
              stadtteil: address.district || ''
            });
          } else {
            resolve({ address: '', stadtteil: '' });
          }
        } catch {
          resolve({ address: '', stadtteil: '' });
        }
      });
    }).on('error', () => resolve({ address: '', stadtteil: '' }));
  });
}

async function mergeSources(osm, here) {
  const combined = [];

  for (const poi of [...osm, ...here]) {
    const duplicate = combined.find(existing =>
      poi.name === existing.name &&
      Math.abs(poi.latitude - existing.latitude) < 0.001 &&
      Math.abs(poi.longitude - existing.longitude) < 0.001
    );

    if (!duplicate) {
      combined.push({
        name: poi.name,
        type: poi.type,
        latitude: poi.latitude,
        longitude: poi.longitude,
        source: poi.source,
        address: '',
        stadtteil: '',
        opening_hours: poi.opening_hours,
        website: poi.website
      });
    } else {
      duplicate.source = 'Beide';
      duplicate.opening_hours ||= poi.opening_hours;
      duplicate.website ||= poi.website;
    }
  }

  for (let i = 0; i < combined.length; i++) {
    const entry = combined[i];
    const { address, stadtteil } = await reverseGeocode(entry.latitude, entry.longitude);
    entry.address = address;
    entry.stadtteil = stadtteil;
    console.log(`📍 ${i + 1}/${combined.length}: ${entry.name} → ${stadtteil}`);
    await new Promise(r => setTimeout(r, 300));
  }

  return combined;
}

function writeCSV(data, outputPath = path.join('tmp', 'adlershof-pois.csv')) {
  if (!fs.existsSync('tmp')) {
    fs.mkdirSync('tmp');
  }
  const header = 'Name,Typ,Adresse,Stadtteil,Latitude,Longitude,Quelle,Öffnungszeiten,Website\n';
  const rows = data.map(d =>
    `"${d.name.replace(/"/g, '""')}","${d.type.replace(/"/g, '""')}","${d.address.replace(/"/g, '""')}","${d.stadtteil.replace(/"/g, '""')}",${d.latitude},${d.longitude},${d.source},"${d.opening_hours.replace(/"/g, '""')}","${d.website.replace(/"/g, '""')}`
  );
  fs.writeFileSync(outputPath, header + rows.join('\n'), 'utf8');
  console.log(`✅ CSV gespeichert unter ${outputPath}`);
}

async function main() {
  if (!HERE_API_KEY) {
    console.error("❌ Bitte setze die Umgebungsvariable HERE_API_KEY");
    process.exit(1);
  }

  console.log('⬇️ Lade OSM-Daten …');
  const osm = await fetchOSMData();
  console.log(`📦 OSM: ${osm.length} Einträge`);

  console.log('⬇️ Lade HERE-Daten …');
  const here = await fetchHereData();
  console.log(`📦 HERE: ${here.length} Einträge`);

  console.log('🔀 Führe zusammen und ergänze Adressen …');
  const merged = await mergeSources(osm, here);
  console.log(`✅ Gesamt: ${merged.length} POIs`);

  writeCSV(merged);
}

main().catch(err => console.error('❌ Fehler:', err));