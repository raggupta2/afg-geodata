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

const heliportIcon = L.divIcon({
    className: "category-marker heliport-marker",
    html: '<span role="img" aria-label="Heliport">\uD83D\uDE81</span>',
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

const airportLayer = L.geoJSON(null, {
    pointToLayer: (feature, latlng) => {
        const airportType = feature.properties.airport_type;
        const icon = typeof airportType === "string" &&
            airportType.toLowerCase() === "heliport"
            ? heliportIcon
            : airportIcon;
        return L.marker(latlng, { icon });
    },
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

const flightRouteLayer = L.layerGroup().addTo(map);
const flightMarkerLayer = L.layerGroup().addTo(map);

const searchInput = document.getElementById("searchInput");
const resultStatus = document.getElementById("resultStatus");
const categoryButtons = document.querySelectorAll("[data-category]");
const flightTools = document.getElementById("flightTools");
const sourceAirportInput = document.getElementById("sourceAirport");
const destinationAirportInput = document.getElementById("destinationAirport");
const sourceAirportOptions = document.getElementById("sourceAirportOptions");
const destinationAirportOptions = document.getElementById("destinationAirportOptions");
const routeSearchButton = document.getElementById("routeSearchButton");
const connectivityButton = document.getElementById("connectivityButton");
const airlineButton = document.getElementById("airlineButton");
const flightResults = document.getElementById("flightResults");
const flightActionButtons = [routeSearchButton, connectivityButton, airlineButton];

let selectedCategory = "railway";
let searchTimer;
let activeRequestId = 0;
let flightRequestId = 0;
const airportOptionTimers = new Map();

const clearSearchLayers = () => {
    railwayStationLayer.clearLayers();
    airportLayer.clearLayers();
};

const clearFlightLayers = () => {
    flightRouteLayer.clearLayers();
    flightMarkerLayer.clearLayers();
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
    if (query.length < 3) {
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


const setFlightBusy = (busy, message = "") => {
    flightActionButtons.forEach(button => {
        button.disabled = busy;
    });
    flightResults.classList.toggle("loading", busy);
    if (message) {
        flightResults.innerHTML = `<div class="flight-result">${escapeHtml(message)}</div>`;
    }
};

const getAirportCode = input => input.value.trim().toUpperCase();

const fetchApiJson = async path => {
    const response = await fetch(getApiUrl(path));
    let json;

    try {
        json = await response.json();
    } catch (_error) {
        throw new Error("The server returned an unreadable response.");
    }

    if (!response.ok || !json.success) {
        throw new Error(json.message || "The flight search failed.");
    }
    return json;
};

const airportLatLng = airport => [airport.latitude, airport.longitude];

const fitFlightPoints = points => {
    if (!points.length) return;

    if (points.length === 1) {
        map.flyTo(points[0], 8, { duration: 1 });
        return;
    }

    map.flyToBounds(L.latLngBounds(points), {
        padding: [55, 55],
        maxZoom: 8,
        duration: 1.2
    });
};

const addFlightAirportMarker = (airport, role, seen, points) => {
    if (seen.has(airport.id)) return;
    seen.add(airport.id);

    const colors = {
        source: "#138a4a",
        stop: "#f59e0b",
        destination: "#dc2626",
        connection: "#7c3aed"
    };
    const labels = {
        source: "Source",
        stop: "Stop",
        destination: "Destination",
        connection: "Connected airport"
    };
    const latlng = airportLatLng(airport);
    points.push(latlng);

    L.circleMarker(latlng, {
        radius: role === "stop" ? 9 : 8,
        color: "#fff",
        weight: 2,
        fillColor: colors[role],
        fillOpacity: 1
    })
        .bindTooltip(`${escapeHtml(airport.code)}  -  ${escapeHtml(airport.name)}`, {
            direction: "top"
        })
        .bindPopup(`
            <div class="map-popup">
                <h3>${escapeHtml(airport.code)}  -  ${escapeHtml(airport.name)}</h3>
                ${detailRow("Role", labels[role])}
                ${detailRow("City", airport.city)}
                ${detailRow("Country", airport.countryCode)}
            </div>
        `)
        .addTo(flightMarkerLayer);
};

const legDescription = leg => {
    const airlineCode = leg.airline.iataCode || leg.airline.icaoCode;
    const flight = leg.flightNumber || "Flight number unavailable";
    return `${leg.airline.name}${airlineCode ? ` (${airlineCode})` : ""}  -  ${flight}`;
};

const renderRoutes = data => {
    const points = [];
    const seen = new Set();

    addFlightAirportMarker(data.sourceAirport, "source", seen, points);
    addFlightAirportMarker(data.destinationAirport, "destination", seen, points);

    data.routes.forEach((route, routeIndex) => {
        if (route.stopAirport) {
            addFlightAirportMarker(route.stopAirport, "stop", seen, points);
        }

        route.legs.forEach((leg, legIndex) => {
            const line = L.polyline(
                [airportLatLng(leg.sourceAirport), airportLatLng(leg.destinationAirport)],
                {
                    color: route.totalStops ? (legIndex === 0 ? "#0b63ce" : "#7c3aed") : "#0b63ce",
                    opacity: Math.max(.4, 1 - routeIndex * .04),
                    weight: 4
                }
            );
            line.bindPopup(`
                <div class="map-popup">
                    <h3>${escapeHtml(leg.route)}</h3>
                    ${detailRow("Airline", leg.airline.name)}
                    ${detailRow("Flight", leg.flightNumber || "Not available")}
                    ${detailRow("Equipment", leg.equipment)}
                </div>
            `);
            line.addTo(flightRouteLayer);
        });
    });

    if (!data.routes.length) {
        flightResults.innerHTML = '<div class="flight-result">No matching routes are available.</div>';
    } else {
        flightResults.innerHTML = data.routes.map(route => `
            <div class="flight-result">
                <strong>${escapeHtml(route.route)}  |  ${route.totalStops} stop${route.totalStops === 1 ? "" : "s"}</strong>
                ${route.legs.map(leg => escapeHtml(legDescription(leg))).join("<br>")}
            </div>
        `).join("");
    }
    fitFlightPoints(points);
};

const renderConnectivity = data => {
    const points = [];
    const seen = new Set();
    const source = data.sourceAirport;

    addFlightAirportMarker(source, "source", seen, points);
    data.connections.forEach(connection => {
        addFlightAirportMarker(connection.airport, "connection", seen, points);

        L.polyline(
            [airportLatLng(source), airportLatLng(connection.airport)],
            { color: "#7c3aed", opacity: .7, weight: 3 }
        )
            .bindPopup(`
                <div class="map-popup">
                    <h3>${escapeHtml(source.code)}  |  ${escapeHtml(connection.airport.code)}</h3>
                    ${detailRow("Airlines", connection.airlines.map(airline => airline.name).join(", "))}
                    ${detailRow("Distinct routes", String(connection.routeCount))}
                </div>
            `)
            .addTo(flightRouteLayer);
    });

    flightResults.innerHTML = data.connections.length
        ? data.connections.map(connection => `
            <div class="flight-result">
                <strong>${escapeHtml(connection.airport.code)}  -  ${escapeHtml(connection.airport.name)}</strong>
                ${escapeHtml(connection.airlines.map(airline => airline.name).join(", "))}
            </div>
        `).join("")
        : '<div class="flight-result">No directly connected airports are available.</div>';
    fitFlightPoints(points);
};

const renderAirlines = data => {
    const points = [];
    const seen = new Set();

    addFlightAirportMarker(data.sourceAirport, "source", seen, points);
    addFlightAirportMarker(data.destinationAirport, "destination", seen, points);

    if (data.airlines.length) {
        L.polyline(
            [airportLatLng(data.sourceAirport), airportLatLng(data.destinationAirport)],
            { color: "#0b63ce", opacity: .8, weight: 4 }
        ).addTo(flightRouteLayer);
    }

    flightResults.innerHTML = data.airlines.length
        ? data.airlines.map(airline => {
            const codes = [airline.iataCode, airline.icaoCode].filter(Boolean).join(" / ");
            return `
                <div class="flight-result">
                    <strong>${escapeHtml(airline.name)}</strong>
                    ${codes ? escapeHtml(codes) : "No published airline code"}
                </div>
            `;
        }).join("")
        : '<div class="flight-result">No airlines operate a direct route between these airports.</div>';
    fitFlightPoints(points);
};

const runFlightAction = async action => {
    const source = getAirportCode(sourceAirportInput);
    const destination = getAirportCode(destinationAirportInput);
    const requestId = ++flightRequestId;

    if (!source) {
        flightResults.innerHTML = '<div class="flight-result">Choose a source airport first.</div>';
        sourceAirportInput.focus();
        return;
    }
    if (action !== "connectivity" && !destination) {
        flightResults.innerHTML = '<div class="flight-result">Choose a destination airport first.</div>';
        destinationAirportInput.focus();
        return;
    }

    clearSearchLayers();
    clearFlightLayers();
    setFlightBusy(true, action === "routes"
        ? "Searching flight routes..."
        : action === "connectivity"
            ? "Loading airport connections..."
            : "Loading airlines...");

    try {
        let json;
        if (action === "routes") {
            const type = document.querySelector('input[name="routeType"]:checked').value;
            const params = new URLSearchParams({ source, destination, type });
            json = await fetchApiJson(`airports/routes?${params}`);
            if (requestId === flightRequestId) renderRoutes(json.data);
        } else if (action === "connectivity") {
            const params = new URLSearchParams({ source });
            json = await fetchApiJson(`airports/connectivity?${params}`);
            if (requestId === flightRequestId) renderConnectivity(json.data);
        } else {
            const params = new URLSearchParams({ source, destination });
            json = await fetchApiJson(`airports/airlines?${params}`);
            if (requestId === flightRequestId) renderAirlines(json.data);
        }
    } catch (error) {
        if (requestId !== flightRequestId) return;
        clearFlightLayers();
        flightResults.innerHTML = `<div class="flight-result">${escapeHtml(error.message)}</div>`;
        console.error(error);
    } finally {
        if (requestId === flightRequestId) setFlightBusy(false);
    }
};

const loadAirportOptions = async (input, datalist) => {
    const query = input.value.trim();
    if (query.length < 2) {
        datalist.replaceChildren();
        return;
    }

    try {
        const parameters = new URLSearchParams({ q: query, limit: "20" });
        const json = await fetchApiJson(`airports/?${parameters}`);
        const options = json.data.features
            .map(feature => {
                const airport = feature.properties;
                const code = airport.iata_code || airport.icao_code;
                if (!code) return null;

                const option = document.createElement("option");
                option.value = code;
                option.label = `${airport.airport_name}${airport.city ? `  -  ${airport.city}` : ""}`;
                return option;
            })
            .filter(Boolean);
        datalist.replaceChildren(...options);
    } catch (error) {
        datalist.replaceChildren();
        console.error(error);
    }
};

const bindAirportOptions = (input, datalist) => {
    input.addEventListener("input", () => {
        input.value = input.value.toUpperCase();
        clearTimeout(airportOptionTimers.get(input));
        airportOptionTimers.set(
            input,
            setTimeout(() => loadAirportOptions(input, datalist), 250)
        );
    });
};


const selectCategory = category => {
    if (category !== "railway" && category !== "flight") return;

    selectedCategory = category;
    clearTimeout(searchTimer);
    flightTools.hidden = category !== "flight";
    if (category === "railway") {
        flightRequestId++;
        clearFlightLayers();
        flightResults.replaceChildren();
    }

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
routeSearchButton.addEventListener("click", () => runFlightAction("routes"));
connectivityButton.addEventListener("click", () => runFlightAction("connectivity"));
airlineButton.addEventListener("click", () => runFlightAction("airlines"));

bindAirportOptions(sourceAirportInput, sourceAirportOptions);
bindAirportOptions(destinationAirportInput, destinationAirportOptions);

selectCategory("railway");
