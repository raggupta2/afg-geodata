const API_URL = window.APP_CONFIG?.API_URL || "/api/v1/";
const getApiUrl = path =>
    `${API_URL.replace(/\/?$/, "/")}${path.replace(/^\//, "")}`;

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("departureDate").value =
        new Date().toISOString().slice(0, 10);

    setupStationAutocomplete("origin");
    setupStationAutocomplete("destination");
    document
        .getElementById("useLocationBtn")
        .addEventListener("click", useCurrentLocation);
    document
        .getElementById("searchBtn")
        .addEventListener("click", loadRoutes);
});

function setupStationAutocomplete(prefix) {
    const input = document.getElementById(`${prefix}Label`);
    const suggestions = document.getElementById(`${prefix}Suggestions`);
    let timer;

    input.addEventListener("input", () => {
        clearTimeout(timer);
        document.getElementById(`${prefix}Latitude`).value = "";
        document.getElementById(`${prefix}Longitude`).value = "";
        const query = input.value.trim();
        if (query.length < 2) {
            hideSuggestions(suggestions);
            return;
        }
        timer = setTimeout(
            () => loadStationSuggestions(prefix, query),
            250
        );
    });
    input.addEventListener("blur", () =>
        setTimeout(() => hideSuggestions(suggestions), 150)
    );
}

async function loadStationSuggestions(prefix, query) {
    const suggestions = document.getElementById(`${prefix}Suggestions`);
    try {
        const response = await fetch(
            getApiUrl(
                `railways/stations?q=${encodeURIComponent(query)}&limit=10`
            )
        );
        const body = await response.json();
        if (!response.ok || !body.success) {
            throw new Error(body.message || "Station search failed.");
        }
        renderStationSuggestions(
            prefix,
            body.data?.features ?? []
        );
    } catch {
        hideSuggestions(suggestions);
    }
}

function stationLabel(feature) {
    const name = String(feature.properties?.station_name ?? "Station")
        .toUpperCase();
    const code = feature.properties?.station_code;
    return code ? `${name} (${String(code).toUpperCase()})` : name;
}

function renderStationSuggestions(prefix, features) {
    const suggestions = document.getElementById(`${prefix}Suggestions`);
    suggestions.innerHTML = "";
    for (const feature of features) {
        const item = document.createElement("li");
        item.textContent = stationLabel(feature);
        item.addEventListener("mousedown", event => {
            event.preventDefault();
            selectStation(prefix, feature);
        });
        suggestions.appendChild(item);
    }
    suggestions.style.display = features.length > 0 ? "block" : "none";
}

function selectStation(prefix, feature) {
    const coordinates = feature.geometry?.coordinates ?? [];
    document.getElementById(`${prefix}Label`).value = stationLabel(feature);
    document.getElementById(`${prefix}Latitude`).value = coordinates[1] ?? "";
    document.getElementById(`${prefix}Longitude`).value = coordinates[0] ?? "";
    hideSuggestions(document.getElementById(`${prefix}Suggestions`));
}

function hideSuggestions(element) {
    element.style.display = "none";
    element.innerHTML = "";
}

function useCurrentLocation() {
    const result = document.getElementById("result");
    if (!navigator.geolocation) {
        result.innerHTML =
            '<div class="error">Geolocation is not supported.</div>';
        return;
    }

    navigator.geolocation.getCurrentPosition(
        async position => {
            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;
            document.getElementById("originLatitude").value = latitude;
            document.getElementById("originLongitude").value = longitude;
            document.getElementById("originLabel").value =
                "Current location";

            try {
                const response = await fetch(getApiUrl(
                    `railways/stations?latitude=${encodeURIComponent(latitude)}`
                    + `&longitude=${encodeURIComponent(longitude)}&limit=1`
                ));
                const body = await response.json();
                const nearest = body.data?.features?.[0];
                if (response.ok && body.success && nearest) {
                    document.getElementById("originLabel").value =
                        `${stationLabel(nearest)} AREA`;
                }
            } catch {
                // The exact geolocation remains valid if nearest-name lookup fails.
            }
        },
        error => {
            result.innerHTML =
                `<div class="error">${escapeHtml(error.message)}</div>`;
        },
        { enableHighAccuracy: true, timeout: 10_000 }
    );
}

function numberValue(id) {
    const raw = document.getElementById(id).value;
    if (!raw.trim()) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

async function loadRoutes() {
    const result = document.getElementById("result");
    const loader = document.getElementById("loader");
    const originLatitude = numberValue("originLatitude");
    const originLongitude = numberValue("originLongitude");
    const destinationLatitude = numberValue("destinationLatitude");
    const destinationLongitude = numberValue("destinationLongitude");
    const departureDate = document.getElementById("departureDate").value;

    if (
        originLatitude === null
        || originLongitude === null
        || destinationLatitude === null
        || destinationLongitude === null
        || !departureDate
    ) {
        result.innerHTML =
            '<div class="error">Select an origin and destination, then choose a departure date.</div>';
        return;
    }

    loader.style.display = "block";
    result.innerHTML = "";
    try {
        const response = await fetch(getApiUrl("railways/search"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                origin: {
                    latitude: originLatitude,
                    longitude: originLongitude,
                    label: document.getElementById("originLabel").value
                        || undefined
                },
                destination: {
                    latitude: destinationLatitude,
                    longitude: destinationLongitude,
                    label: document.getElementById("destinationLabel").value
                        || undefined
                },
                departureDate
            })
        });
        const body = await response.json();
        if (!response.ok || !body.success) {
            throw new Error(body.message || "Route search failed.");
        }
        renderResults(body.data);
    } catch (error) {
        result.innerHTML =
            `<div class="error">${escapeHtml(error.message)}</div>`;
    } finally {
        loader.style.display = "none";
    }
}

function renderResults(data) {
    const result = document.getElementById("result");
    const trainResults = Array.isArray(data.trainResults)
        ? data.trainResults
        : [];
    if (trainResults.length === 0) {
        result.innerHTML =
            '<div class="empty-result">No railway journey is available.</div>';
        return;
    }

    result.innerHTML = `
        ${renderStationSummary(data.boardingStations)}
        <div class="results-header">
            <h2>Recommended trains</h2>
            <div class="route-count">${trainResults.length} choices</div>
        </div>

        ${trainResults.map(option =>
            renderTrainResult(option, data.request?.destination)
        ).join("")}
    `;
    //  ${renderAdditionalStations(data.nearbyStationsWithAdditionalTrains)}
}

function renderTrainResult(option, searchedDestination) {
    const trainRows = option.trains.map(train => `
        <tr>
            <td>${escapeHtml(train.trainNumber)}</td>
            <td>${escapeHtml(train.trainName)}</td>
            <td>${escapeHtml(train.from.code)} &rarr; ${escapeHtml(train.to.code)}</td>
            <td>${formatDateTime(train.departureAt)}</td>
            <td>${formatDateTime(train.arrivalAt)}</td>
            <td>${formatTrainDistance(train.distanceKm)}</td>
        </tr>
    `).join("");
    const searchedDestinationCode = stationCodeFromLabel(
        searchedDestination?.label
    );
    const destinations = option.availableDestinationStations.map(item => `
        <li>
            ${escapeHtml(item.station.name)}
            (${escapeHtml(item.station.code)}) &mdash;
            train arrival ${formatDateTime(item.trainArrivalAt)}
            ${renderDestinationRoadAccess(item, searchedDestinationCode)}
        </li></br>
    `).join("");
    const alternatives = option.alternativeBoardingStations.map(item => `
        <li>
            ${escapeHtml(item.station.name)}
            (${escapeHtml(item.station.code)}) &mdash;
            ${formatDistance(item.sourceAccess.estimatedRoadDistanceKm)}
            estimated road, ${formatDuration(item.sourceAccess.travelMinutes)},
            departs ${formatDateTime(item.trainDepartureAt)}
        </li>
    `).join("");
    const transfers = option.transferDetails.map(item => `
        <li>
            ${escapeHtml(item.from.name)}
            (${escapeHtml(item.from.code)}) &mdash;
            ${formatDuration(item.durationMinutes)} transfer
        </li>
    `).join("");

    return `
        <section class="journey-card">
            <div class="journey-header">
                <span class="route-number">${option.rank}</span>
                <div class="route-path">
                    ${escapeHtml(option.trainNumber)}
                    ${escapeHtml(option.trainName)}
                    <br>
                    <span class="journey-badge">
                        ${option.journeyType === "DIRECT" ? "Direct" : "Transfer"}
                        &bull; ${option.numberOfTransfers} Transfers
                    </span>
                </div>
            </div>
            <div class="journey-metrics">
                <div class="journey-metric">
                    <span>Recommended boarding station</span>
                    <strong>
                        ${escapeHtml(option.recommendedBoardingStation.name)}
                        (${escapeHtml(option.recommendedBoardingStation.code)})
                    </strong>
                </div>
                <div class="journey-metric">
                    <span>Estimated road distance and travel</span>
                    <strong>
                        ${formatDistance(option.sourceAccess.estimatedRoadDistanceKm)}
                        &bull;  ${formatDuration(option.sourceAccess.travelMinutes)}
                    </strong>
                </div>
                <div class="journey-metric">
                    <!--<span>Leave home &bull; first train</span> -->
                    <span>First train</span>
                    <strong>
                       <!-- ${formatDateTime(option.suggestedLeaveHomeAt)} &bull; -->
                         ${formatDateTime(option.firstTrainDepartureAt)}
                    </strong>
                </div>
                <div class="journey-metric">
                    <span>Total journey</span>
                    <strong>${formatDuration(option.totalJourneyMinutes)}</strong>
                </div>
                <div class="journey-metric">
                    <span>Total train distance</span>
                    <strong>${formatTrainDistance(option.totalTrainDistanceKm)}</strong>
                </div>
                <div class="journey-metric">
                    <span>Rail transfer waiting</span>
                    <strong>${formatDuration(option.railTransferWaitingMinutes)}</strong>
                </div>
                <div class="journey-metric">
                    <span>Final arrival</span>
                    <strong>${formatDateTime(option.finalArrivalAt)}</strong>
                </div>
            </div>
            <div class="journey-section">
                <h3>Available destination stations</h3>
                <ul>${destinations}</ul>
            </div>
            ${alternatives ? `
                <div class="journey-section">
                    <h3>Other nearby boarding stations</h3>
                    <ul>${alternatives}</ul>
                </div>
                <br>
            ` : ""}
            ${transfers ? `
                <div class="journey-section">
                    <h3>Transfer details</h3>
                    <ul>${transfers}</ul>
                </div>
            ` : ""}
            <div class="journey-table">
                <table>
                    <thead>
                        <tr>
                            <th>Train</th>
                            <th>Name</th>
                            <th>Rail segment</th>
                            <th>Departure</th>
                            <th>Arrival</th>
                            <th>Train Route Distance</th>
                        </tr>
                    </thead>
                    <tbody>${trainRows}</tbody>
                </table>
            </div>
        </section>
    `;
}

function stationCodeFromLabel(label) {
    const match = String(label ?? "").trim().match(/\(([^()]+)\)\s*$/);
    return match ? match[1].trim().toUpperCase() : null;
}

function renderDestinationRoadAccess(item, searchedDestinationCode) {
    const arrivalStationCode = String(item.station?.code ?? "").toUpperCase();
    if (
        !searchedDestinationCode
        || !arrivalStationCode
        || arrivalStationCode === searchedDestinationCode
        || !item.destinationAccess
    ) {
        return "";
    }

    return `
        <div class="destination-road-access">
            Estimated road distance (${escapeHtml(arrivalStationCode)})
            to destination (${escapeHtml(searchedDestinationCode)})
            <br>
            <strong>
                ${formatCompactDistance(
                    item.destinationAccess.estimatedRoadDistanceKm
                )}
                &bull;
                ${formatDuration(item.destinationAccess.travelMinutes)}
            </strong>
        </div>
    `;
}

function formatCompactDistance(kilometres) {
    const value = Number(kilometres);
    if (!Number.isFinite(value)) return "Unknown";
    return `${Number(value.toFixed(1))} km`;
}

function formatTrainDistance(kilometres) {
    if (kilometres === null || kilometres === undefined) return "-";
    const value = Number(kilometres);
    if (!Number.isFinite(value)) return "-";
    return `${Number(value.toFixed(1))} km`;
}

function renderStationSummary(stations) {
    if (!Array.isArray(stations) || stations.length === 0) return "";
    const rows = stations.map(station => `
        <tr>
            <td>
                ${escapeHtml(station.name)} (${escapeHtml(station.code)})
                ${station.recommended
                    ? '<span class="recommended-label">Recommended</span>'
                    : ""}
            </td>
            <td>${formatDistance(station.estimatedRoadDistanceKm)}</td>
            <td>${formatDuration(station.roadTravelMinutes)}</td>
            <td>${station.matchingTrainCount}</td>
        </tr>
    `).join("");
    return `
        <section class="station-summary">
            <h2>Nearby railway stations</h2>
            <table>
                <thead>
                    <tr>
                        <th>Station</th>
                        <th>Estimated road distance</th>
                        <th>Road travel</th>
                        <th>Matching trains</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </section>
    `;
}

function renderAdditionalStations(stations) {
    if (!Array.isArray(stations) || stations.length === 0) return "";
    return `
        <section class="station-summary">
            <h2>Nearby stations with additional trains</h2>
            <ul>
                ${stations.map(station => `
                    <li>
                        ${escapeHtml(station.name)}
                        (${escapeHtml(station.code)}) &mdash;
                        ${station.additionalTrainCount} additional trains
                    </li>
                `).join("")}
            </ul>
        </section>
    `;
}

function formatDistance(kilometres) {
    const value = Number(kilometres);
    return Number.isFinite(value) ? `${value.toFixed(1)} km` : "Unknown";
}

function formatDuration(minutes) {
    const value = Math.max(0, Number(minutes) || 0);
    const hours = Math.floor(value / 60);
    return hours > 0 ? `${hours}h ${value % 60}m` : `${value}m`;
}

function formatDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? escapeHtml(value)
        : date.toLocaleString("en-IN", {
            dateStyle: "medium",
            timeStyle: "short"
        });
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
