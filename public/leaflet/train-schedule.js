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
            !data.data ||
            !data.data.legs ||
            data.data.legs.length === 0
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

function renderRouteTable(route) {
    let html = `
    <div class="card">
    <h2>
        Route Summary
    </h2>

    <table>
    <tr>
        <th>From</th>
        <td>
            ${route.departureStation.name}
            (${route.departureStation.code})
        </td>
    </tr>

    <tr>
        <th>To</th>
        <td>
            ${route.arrivalStation.name}
            (${route.arrivalStation.code})
        </td>
    </tr>

    <tr>
        <th>Date</th>
        <td>
            ${route.searchDate}
        </td>
    </tr>

    <tr>
        <th>Total Duration</th>
        <td>
            ${formatDuration(route.totalDurationMinutes)}
        </td>
    </tr>

    <tr>
        <th>Transfers</th>
        <td>
            ${route.numberOfTransfers}
        </td>
    </tr>

    </table>

    <h2>
        Train Details
    </h2>
    <table>
    <tr>
        <th>No</th>
        <th>Train No</th>
        <th>Train Name</th>
        <th>From</th>
        <th>Departure</th>
        <th>To</th>
        <th>Arrival</th>
        <th>Duration</th>
        <th>Stops</th>
    </tr>
    `;



    route.legs.forEach((train, index) => {
        html += `
        <tr>
        <td>
            ${index + 1}
        </td>
        <td>
            ${train.trainNumber}
        </td>
        <td>
            ${train.trainName}
        </td>
        <td>
            ${train.departureStation.name}
            (${train.departureStation.code})
        </td>
        <td>
            ${train.departureDateTime}
        </td>
        <td>
            ${train.arrivalStation.name}
            (${train.arrivalStation.code})
        </td>
        <td>
            ${train.arrivalDateTime}
        </td>
        <td>
            ${formatDuration(train.durationMinutes)}
        </td>
        <td>
            ${train.numberOfStops}
        </td>
        </tr>
        `;
    });

    html += `
    </table>
    </div>
    `;

    document.getElementById("result").innerHTML = html;
}

function formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours} hours ${mins} minutes`;
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