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
        // The in-memory cache remains available.
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
            // No cleanup is required when storage is unavailable.
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
        // Keep the in-memory value when storage is unavailable.
    }
    return cached;
};

const formatDistance = distance => {
    const value = Number(distance);
    if (!Number.isFinite(value)) return "Distance unavailable";
    return value < 10 ? `${value.toFixed(1)} km away` : `${Math.round(value)} km away`;
};

const renderNearbyCards = features => {
    if (!features.length) {
        setNearbyState("No nearby railway stations were found.");
        return;
    }

    nearbyList.innerHTML = features.map(feature => {
        const station = feature.properties;
        const longitude = feature.geometry.coordinates[0];
        const latitude = feature.geometry.coordinates[1];
        const address = station.address || "Address not available in the source data";
        const coordinates = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        const mapsUrl = "https://www.google.com/maps/search/?api=1&query=" +
            encodeURIComponent(`${latitude},${longitude}`);

        return [
            '<article class="nearby-card">',
            '<h3>' + escapeHtml(station.station_name) + '</h3>',
            '<div class="distance">' + escapeHtml(formatDistance(station.distance_km)) + '</div>',
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
            detailRow("Coordinates", `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`) +
            '</div>'
        )
        .addTo(userLocationLayer);
};

const loadNearbyStations = async (location, requestId) => {
    nearbyResults.hidden = false;
    nearbyResultsTitle.textContent = "Closest Railway Stations";
    setNearbyState("Finding nearby railway stations", true);
    resultStatus.textContent = "Searching for nearby railway stations...";
    nearMeButton.disabled = true;

    clearSearchLayers();
    showUserLocation(location.latitude, location.longitude);
    const parameters = new URLSearchParams({
        latitude: String(location.latitude),
        longitude: String(location.longitude),
        limit: "2"
    });

    try {
        const json = await fetchApiJson(`railways/stations?${parameters}`);
        if (requestId !== nearbyRequestId) return;

        const features = json.data.features;
        railwayStationLayer.addData(json.data);
        renderNearbyCards(features);
        resultStatus.textContent = features.length
            ? `${features.length} nearby railway stations found`
            : "No nearby railway stations found.";

        const points = [[location.latitude, location.longitude]];
        features.forEach(feature => points.push([
            feature.geometry.coordinates[1],
            feature.geometry.coordinates[0]
        ]));
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

const requestCurrentLocation = requestId => {
    if (!navigator.geolocation) {
        nearbyResults.hidden = false;
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
            loadNearbyStations(location, requestId);
        },
        error => {
            if (requestId !== nearbyRequestId) return;
            const message = error.code === error.PERMISSION_DENIED
                ? "Location access was denied."
                : "Your location could not be determined.";
            nearbyResults.hidden = false;
            setNearbyState(message);
            resultStatus.textContent = message;
            nearMeButton.disabled = false;
        },
        { enableHighAccuracy: false, maximumAge: 0, timeout: 10000 }
    );
};

nearMeButton.addEventListener("click", () => {
    const requestId = ++nearbyRequestId;
    const cached = readCachedLocation();
    if (cached && !hasRunNearMe) {
        hasRunNearMe = true;
        loadNearbyStations(cached, requestId);
        return;
    }
    requestCurrentLocation(requestId);
});

searchInput.addEventListener("input", hideNearbyResults);
