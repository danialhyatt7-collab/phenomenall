/*
 * IANA timezone → approximate coordinates, for the admin live globe only.
 *
 * The browser reports its own timezone (e.g. "Asia/Karachi"); the server maps
 * it to the representative city of that zone. This is deliberately coarse — one
 * point per zone — and involves no IP lookup, no third-party call, and nothing
 * sent to Meta. It only decides where a dot lands on a globe.
 *
 * A zone that is not in the table resolves to null and the visitor is counted
 * as "locating", never placed at a guessed point.
 */
const TZ = {
  // Pakistan and neighbours (the store's core market)
  "Asia/Karachi": { lat: 24.86, lon: 67.0, city: "Karachi", cc: "PK" },
  "Asia/Kolkata": { lat: 28.61, lon: 77.21, city: "Delhi", cc: "IN" },
  "Asia/Calcutta": { lat: 28.61, lon: 77.21, city: "Delhi", cc: "IN" },
  "Asia/Dhaka": { lat: 23.81, lon: 90.41, city: "Dhaka", cc: "BD" },
  "Asia/Kabul": { lat: 34.53, lon: 69.17, city: "Kabul", cc: "AF" },
  "Asia/Colombo": { lat: 6.93, lon: 79.85, city: "Colombo", cc: "LK" },
  "Asia/Kathmandu": { lat: 27.72, lon: 85.32, city: "Kathmandu", cc: "NP" },

  // Gulf and Middle East (large PK diaspora)
  "Asia/Dubai": { lat: 25.2, lon: 55.27, city: "Dubai", cc: "AE" },
  "Asia/Riyadh": { lat: 24.71, lon: 46.68, city: "Riyadh", cc: "SA" },
  "Asia/Qatar": { lat: 25.29, lon: 51.53, city: "Doha", cc: "QA" },
  "Asia/Bahrain": { lat: 26.23, lon: 50.59, city: "Manama", cc: "BH" },
  "Asia/Kuwait": { lat: 29.38, lon: 47.99, city: "Kuwait City", cc: "KW" },
  "Asia/Muscat": { lat: 23.59, lon: 58.41, city: "Muscat", cc: "OM" },
  "Asia/Tehran": { lat: 35.69, lon: 51.39, city: "Tehran", cc: "IR" },
  "Asia/Baghdad": { lat: 33.32, lon: 44.36, city: "Baghdad", cc: "IQ" },
  "Asia/Jerusalem": { lat: 31.78, lon: 35.22, city: "Jerusalem", cc: "IL" },
  "Asia/Istanbul": { lat: 41.01, lon: 28.98, city: "Istanbul", cc: "TR" },
  "Europe/Istanbul": { lat: 41.01, lon: 28.98, city: "Istanbul", cc: "TR" },

  // UK, Ireland, Europe
  "Europe/London": { lat: 51.51, lon: -0.13, city: "London", cc: "GB" },
  "Europe/Dublin": { lat: 53.35, lon: -6.26, city: "Dublin", cc: "IE" },
  "Europe/Paris": { lat: 48.86, lon: 2.35, city: "Paris", cc: "FR" },
  "Europe/Berlin": { lat: 52.52, lon: 13.4, city: "Berlin", cc: "DE" },
  "Europe/Madrid": { lat: 40.42, lon: -3.7, city: "Madrid", cc: "ES" },
  "Europe/Rome": { lat: 41.9, lon: 12.5, city: "Rome", cc: "IT" },
  "Europe/Amsterdam": { lat: 52.37, lon: 4.9, city: "Amsterdam", cc: "NL" },
  "Europe/Brussels": { lat: 50.85, lon: 4.35, city: "Brussels", cc: "BE" },
  "Europe/Zurich": { lat: 47.37, lon: 8.54, city: "Zurich", cc: "CH" },
  "Europe/Stockholm": { lat: 59.33, lon: 18.07, city: "Stockholm", cc: "SE" },
  "Europe/Oslo": { lat: 59.91, lon: 10.75, city: "Oslo", cc: "NO" },
  "Europe/Warsaw": { lat: 52.23, lon: 21.01, city: "Warsaw", cc: "PL" },
  "Europe/Moscow": { lat: 55.76, lon: 37.62, city: "Moscow", cc: "RU" },
  "Europe/Athens": { lat: 37.98, lon: 23.73, city: "Athens", cc: "GR" },
  "Europe/Lisbon": { lat: 38.72, lon: -9.14, city: "Lisbon", cc: "PT" },

  // North America
  "America/New_York": { lat: 40.71, lon: -74.01, city: "New York", cc: "US" },
  "America/Toronto": { lat: 43.65, lon: -79.38, city: "Toronto", cc: "CA" },
  "America/Chicago": { lat: 41.88, lon: -87.63, city: "Chicago", cc: "US" },
  "America/Denver": { lat: 39.74, lon: -104.99, city: "Denver", cc: "US" },
  "America/Los_Angeles": { lat: 34.05, lon: -118.24, city: "Los Angeles", cc: "US" },
  "America/Vancouver": { lat: 49.28, lon: -123.12, city: "Vancouver", cc: "CA" },
  "America/Phoenix": { lat: 33.45, lon: -112.07, city: "Phoenix", cc: "US" },
  "America/Mexico_City": { lat: 19.43, lon: -99.13, city: "Mexico City", cc: "MX" },
  "America/Sao_Paulo": { lat: -23.55, lon: -46.63, city: "São Paulo", cc: "BR" },

  // Asia-Pacific
  "Asia/Singapore": { lat: 1.35, lon: 103.82, city: "Singapore", cc: "SG" },
  "Asia/Hong_Kong": { lat: 22.32, lon: 114.17, city: "Hong Kong", cc: "HK" },
  "Asia/Tokyo": { lat: 35.68, lon: 139.69, city: "Tokyo", cc: "JP" },
  "Asia/Shanghai": { lat: 31.23, lon: 121.47, city: "Shanghai", cc: "CN" },
  "Asia/Bangkok": { lat: 13.76, lon: 100.5, city: "Bangkok", cc: "TH" },
  "Asia/Jakarta": { lat: -6.21, lon: 106.85, city: "Jakarta", cc: "ID" },
  "Asia/Kuala_Lumpur": { lat: 3.14, lon: 101.69, city: "Kuala Lumpur", cc: "MY" },
  "Asia/Manila": { lat: 14.6, lon: 120.98, city: "Manila", cc: "PH" },
  "Asia/Seoul": { lat: 37.57, lon: 126.98, city: "Seoul", cc: "KR" },
  "Australia/Sydney": { lat: -33.87, lon: 151.21, city: "Sydney", cc: "AU" },
  "Australia/Melbourne": { lat: -37.81, lon: 144.96, city: "Melbourne", cc: "AU" },
  "Australia/Perth": { lat: -31.95, lon: 115.86, city: "Perth", cc: "AU" },
  "Pacific/Auckland": { lat: -36.85, lon: 174.76, city: "Auckland", cc: "NZ" },

  // Africa
  "Africa/Cairo": { lat: 30.04, lon: 31.24, city: "Cairo", cc: "EG" },
  "Africa/Lagos": { lat: 6.52, lon: 3.38, city: "Lagos", cc: "NG" },
  "Africa/Johannesburg": { lat: -26.2, lon: 28.05, city: "Johannesburg", cc: "ZA" },
  "Africa/Nairobi": { lat: -1.29, lon: 36.82, city: "Nairobi", cc: "KE" },
  "Africa/Casablanca": { lat: 33.57, lon: -7.59, city: "Casablanca", cc: "MA" },
};

function tzToPoint(tz) {
  if (!tz || typeof tz !== "string") return null;
  return TZ[tz] || null;
}

/*
 * City gazetteer for placing ORDER pins precisely. Every order carries the
 * delivery address the customer typed, so an order from Lahore and one from
 * Islamabad land on their real cities — something the timezone can never tell
 * apart, since all of Pakistan is one zone. First-party data, no IP lookup.
 *
 * Pakistan is covered densely; a few common destination cities abroad are here
 * too for diaspora orders. Longest name is matched first so "Islamabad" wins
 * over a stray "Islam" and "Dera Ghazi Khan" over "Khan".
 */
const CITIES = [
  ["Karachi", 24.86, 67.0], ["Lahore", 31.52, 74.36], ["Islamabad", 33.68, 73.05],
  ["Rawalpindi", 33.6, 73.04], ["Faisalabad", 31.42, 73.08], ["Multan", 30.16, 71.52],
  ["Peshawar", 34.02, 71.58], ["Quetta", 30.18, 66.98], ["Gujranwala", 32.16, 74.19],
  ["Sialkot", 32.49, 74.53], ["Hyderabad", 25.4, 68.37], ["Bahawalpur", 29.4, 71.68],
  ["Sargodha", 32.08, 72.67], ["Sukkur", 27.7, 68.86], ["Larkana", 27.56, 68.21],
  ["Sheikhupura", 31.71, 73.99], ["Gujrat", 32.57, 74.08], ["Mardan", 34.2, 72.05],
  ["Kasur", 31.12, 74.45], ["Rahim Yar Khan", 28.42, 70.3], ["Sahiwal", 30.66, 73.11],
  ["Okara", 30.81, 73.45], ["Wah Cantt", 33.8, 72.71], ["Wah", 33.8, 72.71],
  ["Dera Ghazi Khan", 30.05, 70.64], ["Mirpur Khas", 25.53, 69.01], ["Nawabshah", 26.24, 68.41],
  ["Mingora", 34.78, 72.36], ["Chiniot", 31.72, 72.98], ["Kotri", 25.37, 68.31],
  ["Kāmoke", 31.97, 74.22], ["Kamoke", 31.97, 74.22], ["Hafizabad", 32.07, 73.69],
  ["Jhang", 31.27, 72.32], ["Jhelum", 32.94, 73.73], ["Abbottabad", 34.15, 73.21],
  ["Muzaffarabad", 34.37, 73.47], ["Mansehra", 34.33, 73.2], ["Nowshera", 34.02, 71.98],
  ["Attock", 33.77, 72.36], ["Bahawalnagar", 29.99, 73.25], ["Vehari", 30.03, 72.35],
  ["Dadu", 26.73, 67.78], ["Khuzdar", 27.8, 66.61], ["Gwadar", 25.13, 62.32],
  ["Turbat", 26.0, 63.05], ["Chakwal", 32.93, 72.85], ["Mianwali", 32.58, 71.54],
  ["Kohat", 33.58, 71.44], ["Bannu", 32.99, 70.6], ["Swat", 34.81, 72.35],
  ["Gilgit", 35.92, 74.31], ["Skardu", 35.29, 75.63], ["Zhob", 31.34, 69.45],
  // Common diaspora destinations, matched only if the address clearly names them.
  ["Dubai", 25.2, 55.27], ["Abu Dhabi", 24.45, 54.38], ["Sharjah", 25.35, 55.39],
  ["Riyadh", 24.71, 46.68], ["Jeddah", 21.49, 39.19], ["Doha", 25.29, 51.53],
  ["London", 51.51, -0.13], ["Manchester", 53.48, -2.24], ["Birmingham", 52.49, -1.89],
  ["Toronto", 43.65, -79.38], ["New York", 40.71, -74.01],
];
// Longest names first so a city that contains another as a substring wins.
CITIES.sort((a, b) => b[0].length - a[0].length);

function addressToPoint(address) {
  if (!address || typeof address !== "string") return null;
  const hay = address.toLowerCase();
  for (const [name, lat, lon] of CITIES) {
    if (hay.indexOf(name.toLowerCase()) !== -1) return { lat, lon, city: name, cc: null };
  }
  return null;
}

module.exports = { tzToPoint, addressToPoint };
