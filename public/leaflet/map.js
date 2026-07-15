const API_URL = window.APP_CONFIG.API_URL || "/api/v1/";

const getApiUrl = path =>
    `${API_URL.replace(/\/?$/, "/")}${path.replace(/^\//, "")}`;

const map = L.map("map").setView([22.7196, 75.8577], 5);

L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19
    }
).addTo(map);

const escapeHtml = value => {
    const element = document.createElement("div");
    element.textContent = value ?? "";
    return element.innerHTML;
};

const detailRow = (label, value) =>
    value ? `<div><b>${label}:</b> ${escapeHtml(value)}</div>` : "";

const stationIcon = L.divIcon({
    className: "category-marker station-marker",
    html: '<span role="img" aria-label="Railway station">\uD83D\uDE89</span>',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -16]
});

const airportIcon = L.divIcon({
    className: "category-marker airport-marker",
    html: '<span role="img" aria-label="Airport">\u2708</span>',
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
                ${detailRow("Hindi name", station.station_name_hi)}
                ${detailRow("Network", station.network)}
                ${detailRow("Operator", station.operator)}
                ${detailRow("Railway type", station.railway_type)}
            </div>
        `);
    }
}).addTo(map);

const airportLayer = L.geoJSON(null, {
    pointToLayer: (_feature, latlng) => L.marker(latlng, { icon: airportIcon }),
    onEachFeature: (feature, layer) => {
        const airport = feature.properties;
        const codes = [airport.iata_code, airport.icao_code]
            .filter(Boolean)
            .join(" / ");

        layer.bindTooltip(escapeHtml(airport.airport_name), {
            direction: "top",
            offset: [0, -15]
        });

        layer.bindPopup(`
            <div class="map-popup">
                <h3>${escapeHtml(airport.airport_name)}</h3>
                ${detailRow("Codes", codes)}
                ${detailRow("City", airport.city)}
                ${detailRow("Region", airport.region)}
                ${detailRow("Country", airport.country || airport.country_code)}
                ${detailRow("Type", airport.airport_type)}
                ${detailRow("Operator", airport.operator)}
                ${detailRow(
                    "Elevation",
                    airport.elevation_m == null ? null : `${airport.elevation_m} m`
                )}
            </div>
        `);
    }
}).addTo(map);

const searchInput = document.getElementById("searchInput");
const resultStatus = document.getElementById("resultStatus");
const categoryButtons = document.querySelectorAll("[data-category]");

let selectedCategory = "railway";
let searchTimer;
let activeRequestId = 0;

const clearSearchLayers = () => {
    railwayStationLayer.clearLayers();
    airportLayer.clearLayers();
};

const setEmptySearchStatus = () => {
    resultStatus.textContent = selectedCategory === "railway"
        ? "Search railway stations by name or station code."
        : "Search airports by name, city, IATA or ICAO code.";
};

const fitResultLayer = layer => {
    if (layer.getLayers().length === 0) return;

    map.flyToBounds(layer.getBounds(), {
        padding: [50, 50],
        maxZoom: 11,
        duration: 1.2
    });
};

async function searchSelectedCategory() {
    const query = searchInput.value.trim();
    const category = selectedCategory;
    const requestId = ++activeRequestId;

    clearSearchLayers();

    if (!query) {
        setEmptySearchStatus();
        return;
    }

    const isRailway = category === "railway";
    const endpoint = isRailway ? "railways/stations" : "airports/";
    const parameters = new URLSearchParams({ q: query, limit: "1000" });

    resultStatus.textContent = isRailway
        ? "Searching railway stations..."
        : "Searching airports...";

    try {
        const response = await fetch(
            `${getApiUrl(endpoint)}?${parameters.toString()}`
        );
        const json = await response.json();

        if (!response.ok || !json.success) {
            throw new Error(json.message || "Search failed.");
        }

        if (requestId !== activeRequestId || category !== selectedCategory) {
            return;
        }

        const resultLayer = isRailway ? railwayStationLayer : airportLayer;
        resultLayer.addData(json.data);

        const resultName = isRailway ? "station" : "airport";
        resultStatus.textContent = `${json.count} ${resultName}${json.count === 1 ? "" : "s"} found`;
        fitResultLayer(resultLayer);
    } catch (error) {
        if (requestId !== activeRequestId || category !== selectedCategory) {
            return;
        }

        clearSearchLayers();
        resultStatus.textContent = error.message;
        console.error(error);
    }
}

const selectCategory = category => {
    if (category !== "railway" && category !== "flight") return;

    selectedCategory = category;
    clearTimeout(searchTimer);

    categoryButtons.forEach(button => {
        const isSelected = button.dataset.category === category;
        button.classList.toggle("active", isSelected);
        button.setAttribute("aria-pressed", String(isSelected));
    });

    searchInput.placeholder = category === "railway"
        ? "Search station name or code"
        : "Search airport, city, IATA or ICAO code";
    searchInput.setAttribute(
        "aria-label",
        category === "railway" ? "Search railway stations" : "Search airports"
    );

    searchSelectedCategory();
};

categoryButtons.forEach(button => {
    button.addEventListener("click", () => {
        selectCategory(button.dataset.category);
    });
});

searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);

    if (!searchInput.value.trim()) {
        searchSelectedCategory();
        return;
    }

    searchTimer = setTimeout(searchSelectedCategory, 300);
});

selectCategory("railway");