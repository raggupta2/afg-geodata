document.addEventListener("DOMContentLoaded", () => {

    const today = new Date()
        .toISOString()
        .split("T")[0];


    document.getElementById("date").min = today;
    document.getElementById("date").value = today;


    document
        .getElementById("searchBtn")
        .addEventListener("click", loadRoute);


});



async function loadRoute() {    

    const result =  document.getElementById("result");
    const loader = document.getElementById("loader");

    // Show loader
    loader.style.display = "block";

    loader.innerHTML = `
        <div class="spinner"></div>
        <p>Searching route...</p>
    `;

    result.innerHTML = "";
    try {
        const departure = document.getElementById("departure").value;

        const arrival = document.getElementById("arrival").value;

        const date = document.getElementById("date").value;

        const response = await fetch(
            `/api/routes?departure=${departure}&arrival=${arrival}&date=${date}`
        );

        const data = await response.json();

        // Hide loader
        loader.style.display = "none";

        // Empty response check

        if (
            !data.success ||
            !Array.isArray(data.data) ||
            data.data.length === 0
        ) {

            result.innerHTML = `
                <div class="empty-result">
                    No trains found for this route.
                    <br>
                    Please try another date.
                </div>
            `;
            return;
        }
        // Continue your existing table rendering here
        renderRouteTable(data.data);
    }
    catch (error) {
        loader.style.display = "none";
        result.innerHTML = `
            <div class="error">
                Server error:
                ${error.message}
            </div>
        `;
    }


}

function renderRouteTable(routes) {
    let html = `
        <div class="results-header">
            <h2>Available Journeys</h2>
            <div class="route-count">
                ${routes.length} ${routes.length === 1 ? "route" : "routes"} found
            </div>
        </div>
    `;

    routes.forEach((journey, routeIndex) => {
        const routeStations = [
            journey.legs[0].departureStation,
            ...journey.legs.map(train => train.arrivalStation)
        ];
        const routePath = routeStations
            .map(station => station.code)
            .join(" &rarr; ");
        const totalDistanceKm = calculateJourneyDistance(journey);
        const totalJourneyMinutes = calculateJourneyDuration(journey);
        const trainChanges = Math.max(0, journey.legs.length - 1);

        html += `
            <section class="journey-card">
                <div class="journey-header">
                    <span class="route-number">${routeIndex + 1}</span>
                    <div class="route-path">${routePath}</div>
                </div>

                <div class="journey-metrics">
                    <div class="journey-metric">
                        <span>Total Distance</span>
                        <strong>${formatDistance(totalDistanceKm)}</strong>
                    </div>
                    <div class="journey-metric">
                        <span>Total Journey Time</span>
                        <strong>${formatDuration(totalJourneyMinutes)}</strong>
                    </div>
                    <div class="journey-metric">
                        <span>Train Changes</span>
                        <strong>${trainChanges}</strong>
                    </div>
                </div>

                <div class="journey-table">
                    <table>
                        <tr>
                            <th>Leg</th>
                            <th>Train No</th>
                            <th>Train Name</th>
                            <th>From</th>
                            <th>Departure</th>
                            <th>To</th>
                            <th>Arrival</th>
                            <th>Travel Time</th>
                            <th>Layover</th>
                            <th>Distance</th>
                            <th>Stops</th>
                        </tr>
        `;

        journey.legs.forEach((train, legIndex) => {
            const previousTrain = journey.legs[legIndex - 1];
            const layoverMinutes = previousTrain
                ? calculateLayover(previousTrain, train)
                : null;

            html += `
                <tr>
                    <td>${legIndex + 1}</td>
                    <td>${train.trainNumber}</td>
                    <td>${train.trainName}</td>
                    <td>
                        ${train.departureStation.name}
                        (${train.departureStation.code})
                    </td>
                    <td>${formatDateTime(train.departureDateTime)}</td>
                    <td>
                        ${train.arrivalStation.name}
                        (${train.arrivalStation.code})
                    </td>
                    <td>${formatDateTime(train.arrivalDateTime)}</td>
                    <td>${formatDuration(train.durationMinutes)}</td>
                    <td>
                        ${layoverMinutes === null
                            ? "—"
                            : formatDuration(layoverMinutes)}
                    </td>
                    <td>${formatDistance(train.totalDistanceKm)}</td>
                    <td>${train.numberOfStops}</td>
                </tr>
            `;
        });

        html += `
                    </table>
                </div>
            </section>
        `;
    });

    document.getElementById("result").innerHTML = html;
}

function formatDuration(minutes) {
    if (!Number.isFinite(minutes)) return "Not available";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
}

function formatDistance(distanceKm) {
    return !Number.isFinite(distanceKm)
        ? "Not available"
        : `${distanceKm.toLocaleString()} km`;
}

function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function calculateJourneyDistance(journey) {
    const distances = journey.legs.map(train => train.totalDistanceKm);
    if (distances.every(Number.isFinite)) {
        return distances.reduce((total, distance) => total + distance, 0);
    }
    return Number.isFinite(journey.totalDistanceKm)
        ? journey.totalDistanceKm
        : null;
}

function calculateJourneyDuration(journey) {
    const departure = Date.parse(journey.departureDateTime);
    const arrival = Date.parse(journey.arrivalDateTime);
    if (Number.isFinite(departure) && Number.isFinite(arrival)) {
        return Math.max(0, Math.round((arrival - departure) / 60000));
    }
    return journey.totalDurationMinutes;
}

function calculateLayover(previousTrain, train) {
    const arrival = Date.parse(previousTrain.arrivalDateTime);
    const departure = Date.parse(train.departureDateTime);
    if (!Number.isFinite(arrival) || !Number.isFinite(departure)) {
        return null;
    }
    return Math.max(0, Math.round((departure - arrival) / 60000));
}


const API_URL = window.APP_CONFIG?.API_URL || "/api/v1/";
const getApiUrl = path =>
    `${API_URL.replace(/\/?$/, "/")}${path.replace(/^\//, "")}`;

function setupAutocomplete(inputId, suggestionId) {
    const input = document.getElementById(inputId);
    const suggestionBox = document.getElementById(suggestionId);

    let timer;

    input.addEventListener("input", () => {
        clearTimeout(timer);

        timer = setTimeout(() => {
            fetchSuggestions(input, suggestionBox);
        }, 300);
    });
}

async function fetchSuggestions(input, suggestionBox) {
    const query = input.value.trim();

    suggestionBox.innerHTML = "";

    if (query.length < 2) {
        suggestionBox.style.display = "none";
        return;
    }

    try {
        const params = new URLSearchParams({
            q: query,
            limit: 10
        });

        const response = await fetch(
            `${getApiUrl("railways/stations")}?${params.toString()}`
        );

        const json = await response.json();

        if (!json.success || !Array.isArray(json.data.features)) {
            suggestionBox.style.display = "none";
            return;
        }

        json.data.features.forEach(feature => {
            const { station_name, station_code } = feature.properties;

            const li = document.createElement("li");
            li.textContent = `${station_name} (${station_code})`;

            li.addEventListener("click", () => {
                input.value = station_code; // or `${station_name} (${station_code})`
                suggestionBox.style.display = "none";
            });

            suggestionBox.appendChild(li);
        });

        suggestionBox.style.display = "block";
    } catch (err) {
        console.error(err);
    }
}

// Enable autocomplete for both inputs
setupAutocomplete("departure", "departureSuggestions");
setupAutocomplete("arrival", "arrivalSuggestions");

document.addEventListener("click", e => {
    document.querySelectorAll(".suggestions").forEach(box => {
        if (!e.target.closest(".autocomplete")) {
            box.style.display = "none";
        }
    });
});
