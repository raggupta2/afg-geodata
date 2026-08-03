const API_URL = window.APP_CONFIG?.API_URL || "/api/v1/";
const getApiUrl = path =>
    `${API_URL.replace(/\/?$/, "/")}${path.replace(/^\//, "")}`;

const map = L.map("map").setView([22.7196, 75.8577], 5);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19
}).addTo(map);

const escapeHtml = value => {
    const element = document.createElement("div");
    element.textContent = value ?? "";
    return element.innerHTML;
};

const detailRow = (label, value) =>
    value ? `<div><b>${label}:</b> ${escapeHtml(value)}</div>` : "";

const stationIcon = L.divIcon({
    className: "category-marker",
    html: '<span role="img" aria-label="Railway station">\uD83D\uDE89</span>',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -16]
});

const railwayStationLayer = L.geoJSON(null, {
    pointToLayer: (_feature, latlng) => L.marker(latlng, { icon: stationIcon }),
    onEachFeature: (feature, layer) => {
        const station = feature.properties;
        const title = station.station_code
            ? `${station.station_code} - ${station.station_name}`
            : station.station_name;

        layer.bindTooltip(escapeHtml(title), {
            direction: "top",
            offset: [0, -15]
        });
        layer.bindPopup(`
            <div class="map-popup">
                <h3>${escapeHtml(station.station_name)}</h3>
                ${detailRow("Station code", station.station_code)}
                ${detailRow("Network", station.network)}
                ${detailRow("Operator", station.operator)}
                ${detailRow("Railway type", station.railway_type)}
            </div>
        `);
    }
}).addTo(map);

const searchInput = document.getElementById("searchInput");
const resultStatus = document.getElementById("resultStatus");
let searchTimer;
let activeRequestId = 0;

const clearSearchLayers = () => railwayStationLayer.clearLayers();

const fitResultLayer = layer => {
    if (layer.getLayers().length === 0) return;
    map.flyToBounds(layer.getBounds(), {
        padding: [50, 50],
        maxZoom: 11,
        duration: 1.2
    });
};

const fetchApiJson = async path => {
    const response = await fetch(getApiUrl(path));
    const json = await response.json();
    if (!response.ok || !json.success) {
        throw new Error(json.message || "Request failed.");
    }
    return json;
};

const searchStations = async () => {
    const query = searchInput.value.trim();
    const requestId = ++activeRequestId;
    clearSearchLayers();

    if (!query) {
        resultStatus.textContent = "Search railway stations by name or station code.";
        return;
    }
    if (query.length < 2) {
        resultStatus.textContent = "Enter at least two characters.";
        return;
    }

    resultStatus.textContent = "Searching railway stations...";
    try {
        const parameters = new URLSearchParams({ q: query, limit: "1000" });
        const json = await fetchApiJson(`railways/stations?${parameters}`);
        if (requestId !== activeRequestId) return;

        railwayStationLayer.addData(json.data);
        const count = Number(json.count ?? json.data?.features?.length ?? 0);
        resultStatus.textContent = `${count} station${count === 1 ? "" : "s"} found`;
        fitResultLayer(railwayStationLayer);
    } catch (error) {
        if (requestId !== activeRequestId) return;
        clearSearchLayers();
        resultStatus.textContent = error.message;
        console.error(error);
    }
};

searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchStations, 300);
});

resultStatus.textContent = "Search railway stations by name or station code.";
