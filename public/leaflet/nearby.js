const nearMeButton = document.getElementById("nearMeButton");
const nearbyResults = document.getElementById("nearbyResults");
const nearbyResultsTitle = document.getElementById("nearbyResultsTitle");
const nearbyList = document.getElementById("nearbyList");
const userLocationLayer = L.layerGroup().addTo(map);
const NEARBY_LOCATION_CACHE_KEY = "travelSearchLocation";
const NEARBY_LOCATION_CACHE_MS = 30 * 60 * 1000;

let memoryCachedLocation = null;
let hasRunNearMe = false;
let nearbyRequestId = 0;

const activeTransport = () => {
    const activeButton = document.querySelector("[data-category].active");
    return activeButton && activeButton.dataset.category === "flight"
        ? "flight"
        : "railway";
};

const setNearbyState = (message, loading = false) => {
    nearbyList.innerHTML = '<div class="nearby-state' +
        (loading ? ' loading' : '') +
        '">' + escapeHtml(message) + '</div>';
};

const hideNearbyResults = () => {
    nearbyRequestId++;
    nearbyResults.hidden = true;
    nearbyList.replaceChildren();
    userLocationLayer.clearLayers();
};

const readCachedLocation = () => {
    let cached = memoryCachedLocation;

    try {
        cached = JSON.parse(localStorage.getItem(NEARBY_LOCATION_CACHE_KEY)) || cached;
    } catch (_error) {
        // The in-memory cache still works when local storage is unavailable.
    }

    if (
        !cached ||
        !Number.isFinite(cached.latitude) ||
        !Number.isFinite(cached.longitude) ||
        !Number.isFinite(cached.savedAt) ||
        Date.now() - cached.savedAt > NEARBY_LOCATION_CACHE_MS
    ) {
        memoryCachedLocation = null;
        try {
            localStorage.removeItem(NEARBY_LOCATION_CACHE_KEY);
        } catch (_error) {
            // Nothing else is required when storage is unavailable.
        }
        return null;
    }

    memoryCachedLocation = cached;
    return cached;
};

const cacheLocation = (latitude, longitude) => {
    const cached = { latitude, longitude, savedAt: Date.now() };
    memoryCachedLocation = cached;

    try {
        localStorage.setItem(NEARBY_LOCATION_CACHE_KEY, JSON.stringify(cached));
    } catch (_error) {
        // Keep using the in-memory cache for this page.
    }

    return cached;
};

const formatDistance = distance => {
    const value = Number(distance);
    if (!Number.isFinite(value)) return "Distance unavailable";
    return value < 10
        ? value.toFixed(1) + " km away"
        : Math.round(value) + " km away";
};

const renderNearbyCards = (features, transport) => {
    if (!features.length) {
        setNearbyState(
            transport === "railway"
                ? "No nearby railway stations were found."
                : "No nearby airports were found."
        );
        return;
    }

    nearbyList.innerHTML = features.map(feature => {
        const item = feature.properties;
        const longitude = feature.geometry.coordinates[0];
        const latitude = feature.geometry.coordinates[1];
        const name = transport === "railway"
            ? item.station_name
            : item.airport_name;
        const address = item.address || "Address not available in the source data";
        const coordinates = latitude.toFixed(5) + ", " + longitude.toFixed(5);
        const mapsUrl = "https://www.google.com/maps/search/?api=1&query=" +
            encodeURIComponent(latitude + "," + longitude);

        return [
            '<article class="nearby-card">',
            '<h3>' + escapeHtml(name) + '</h3>',
            '<div class="distance">' + escapeHtml(formatDistance(item.distance_km)) + '</div>',
            '<div><b>Address:</b> ' + escapeHtml(address) + '</div>',
            '<div class="coordinates"><b>Coordinates:</b> ' + escapeHtml(coordinates) + '</div>',
            '<a class="maps-link" href="' + mapsUrl + '" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>',
            '</article>'
        ].join("");
    }).join("");
};

const showUserLocation = (latitude, longitude) => {
    userLocationLayer.clearLayers();
    L.circleMarker([latitude, longitude], {
        color: "#fff",
        fillColor: "#dc2626",
        fillOpacity: 1,
        radius: 8,
        weight: 3
    })
        .bindPopup(
            '<div class="map-popup"><h3>Your location</h3>' +
            detailRow("Coordinates", latitude.toFixed(5) + ", " + longitude.toFixed(5)) +
            '</div>'
        )
        .addTo(userLocationLayer);
};

const loadNearbyForTransport = async (location, transport, requestId) => {
    const isRailway = transport === "railway";
    const resultLabel = isRailway ? "railway stations" : "airports";
    const endpoint = isRailway ? "railways/stations" : "airports/";

    nearbyResults.hidden = false;
    nearbyResultsTitle.textContent = isRailway
        ? "Closest Railway Stations"
        : "Closest Airports";
    setNearbyState("Finding nearby " + resultLabel, true);
    resultStatus.textContent = "Searching for nearby " + resultLabel + "...";
    nearMeButton.disabled = true;

    clearSearchLayers();
    clearFlightLayers();
    showUserLocation(location.latitude, location.longitude);

    const parameters = new URLSearchParams({
        latitude: String(location.latitude),
        longitude: String(location.longitude),
        limit: "2"
    });

    try {
        const json = await fetchApiJson(endpoint + "?" + parameters);
        if (requestId !== nearbyRequestId || transport !== activeTransport()) return;

        const features = json.data.features;
        const resultLayer = isRailway ? railwayStationLayer : airportLayer;
        resultLayer.addData(json.data);
        renderNearbyCards(features, transport);

        resultStatus.textContent = features.length
            ? features.length + " nearby " + resultLabel + " found"
            : "No nearby " + resultLabel + " found.";

        const points = [[location.latitude, location.longitude]];
        features.forEach(feature => {
            points.push([
                feature.geometry.coordinates[1],
                feature.geometry.coordinates[0]
            ]);
        });

        if (points.length > 1) {
            map.flyToBounds(L.latLngBounds(points), {
                padding: [55, 55],
                maxZoom: 11,
                duration: 1.2
            });
        } else {
            map.flyTo([location.latitude, location.longitude], 11, { duration: 1 });
        }
    } catch (error) {
        if (requestId !== nearbyRequestId) return;
        setNearbyState(error.message || "Nearby results could not be loaded.");
        resultStatus.textContent = error.message || "Nearby results could not be loaded.";
    } finally {
        if (requestId === nearbyRequestId) nearMeButton.disabled = false;
    }
};

const requestCurrentLocation = (transport, requestId) => {
    if (!navigator.geolocation) {
        nearbyResults.hidden = false;
        nearbyResultsTitle.textContent = transport === "railway"
            ? "Closest Railway Stations"
            : "Closest Airports";
        setNearbyState("Location is not supported by this browser.");
        resultStatus.textContent = "Location is not supported by this browser.";
        return;
    }

    nearMeButton.disabled = true;
    resultStatus.textContent = "Requesting your location...";

    navigator.geolocation.getCurrentPosition(
        position => {
            if (requestId !== nearbyRequestId) return;
            const location = cacheLocation(
                position.coords.latitude,
                position.coords.longitude
            );
            hasRunNearMe = true;
            loadNearbyForTransport(location, transport, requestId);
        },
        error => {
            if (requestId !== nearbyRequestId) return;
            const message = error.code === error.PERMISSION_DENIED
                ? "Location access was denied."
                : "Your location could not be determined.";
            nearbyResults.hidden = false;
            nearbyResultsTitle.textContent = transport === "railway"
                ? "Closest Railway Stations"
                : "Closest Airports";
            setNearbyState(message);
            resultStatus.textContent = message;
            nearMeButton.disabled = false;
        },
        { enableHighAccuracy: false, maximumAge: 0, timeout: 10000 }
    );
};

const runNearMe = () => {
    const transport = activeTransport();
    const requestId = ++nearbyRequestId;
    const cached = readCachedLocation();

    if (cached && !hasRunNearMe) {
        hasRunNearMe = true;
        loadNearbyForTransport(cached, transport, requestId);
        return;
    }

    requestCurrentLocation(transport, requestId);
};

nearMeButton.addEventListener("click", runNearMe);

categoryButtons.forEach(button => {
    button.addEventListener("click", hideNearbyResults);
});

searchInput.addEventListener("input", hideNearbyResults);