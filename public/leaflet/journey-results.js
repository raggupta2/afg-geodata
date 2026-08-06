"use strict";

const API_URL = window.APP_CONFIG?.API_URL || "/api/v1/";
const PAGE_SIZE = 12;
const SCHEDULED_MODES = new Set(["RAIL", "FLIGHT"]);
const mobileFilterMedia = window.matchMedia("(max-width: 780px)");

const state = {
    journeys: [],
    visibleJourneys: [],
    journeyById: new Map(),
    renderedCount: PAGE_SIZE,
    abortController: null,
    lastRequest: null,
    requestSequence: 0,
    quickFilter: null,
    maximumTransferLimit: null,
    timeZone: "Asia/Kolkata"
};

const elements = {};

document.addEventListener("DOMContentLoaded", initialize);

function initialize() {
    for (const id of [
        "journeySearchForm", "originLabel", "originLatitude", "originLongitude",
        "originSuggestions", "destinationLabel", "destinationLatitude",
        "destinationLongitude", "destinationSuggestions", "departureAt",
        "searchButton", "useLocationButton", "swapLocationsButton", "formError",
        "resultsWorkspace", "filterPanel", "filterBackdrop", "openFiltersButton",
        "closeFiltersButton", "maximumTransfers", "maximumTransfersValue",
        "departureAfter", "departureBefore", "arrivalAfter", "arrivalBefore",
        "airlineFilterSection", "airlineFilters", "clearFiltersButton", "sortBy",
        "activeFilters", "journeyResults", "showMoreButton", "routeContext",
        "resultCount", "initialState", "loadingState", "errorState", "errorMessage",
        "retryButton", "emptyState", "emptyTitle", "emptyMessage", "emptyActionButton",
        "journeyCardTemplate"
    ]) elements[id] = document.getElementById(id);

    setDefaultDeparture();
    setupAutocomplete("origin");
    setupAutocomplete("destination");
    bindEvents();
}

function bindEvents() {
    elements.journeySearchForm.addEventListener("submit", event => {
        event.preventDefault();
        submitSearch();
    });
    elements.useLocationButton.addEventListener("click", useCurrentLocation);
    elements.swapLocationsButton.addEventListener("click", swapLocations);
    elements.sortBy.addEventListener("change", applyFiltersAndSort);
    elements.maximumTransfers.addEventListener("input", () => {
        state.maximumTransferLimit = Number(elements.maximumTransfers.value);
        updateMaximumTransfersLabel();
        applyFiltersAndSort();
    });
    for (const input of [
        elements.departureAfter, elements.departureBefore,
        elements.arrivalAfter, elements.arrivalBefore
    ]) input.addEventListener("change", applyFiltersAndSort);

    document.querySelectorAll('input[name="journeyType"]').forEach(input =>
        input.addEventListener("change", applyFiltersAndSort)
    );
    document.querySelectorAll("[data-quick-filter]").forEach(button =>
        button.addEventListener("click", () => toggleQuickFilter(button.dataset.quickFilter))
    );
    elements.airlineFilters.addEventListener("change", applyFiltersAndSort);
    elements.clearFiltersButton.addEventListener("click", clearFilters);
    elements.activeFilters.addEventListener("click", removeFilterFromChip);
    elements.showMoreButton.addEventListener("click", () => {
        state.renderedCount += PAGE_SIZE;
        renderJourneyCards();
    });
    elements.journeyResults.addEventListener("click", toggleJourneyDetails);
    elements.retryButton.addEventListener("click", () => submitSearch(state.lastRequest));
    elements.emptyActionButton.addEventListener("click", () => {
        if (state.journeys.length) clearFilters();
        else elements.departureAt.focus();
    });
    elements.openFiltersButton.addEventListener("click", openFilters);
    elements.closeFiltersButton.addEventListener("click", closeFilters);
    elements.filterBackdrop.addEventListener("click", closeFilters);
    mobileFilterMedia.addEventListener("change", syncFilterPanelAccessibility);
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") closeFilters();
    });
    syncFilterPanelAccessibility();
}

function apiUrl(path) {
    return `${API_URL.replace(/\/?$/, "/")}${path.replace(/^\//, "")}`;
}

function setDefaultDeparture() {
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
        .toISOString().slice(0, 10);
    elements.departureAt.value = today;
    elements.departureAt.min = today;
}

function setupAutocomplete(prefix) {
    const input = elements[`${prefix}Label`];
    const list = elements[`${prefix}Suggestions`];
    let timer = null;
    let activeIndex = -1;
    let queryController = null;

    input.addEventListener("input", () => {
        clearTimeout(timer);
        clearCoordinates(prefix);
        activeIndex = -1;
        const query = input.value.trim();
        if (query.length < 2) {
            closeSuggestions(input, list);
            return;
        }
        timer = setTimeout(async () => {
            queryController?.abort();
            queryController = new AbortController();
            try {
                const response = await fetch(
                    apiUrl(`railways/stations?q=${encodeURIComponent(query)}&limit=10`),
                    { signal: queryController.signal }
                );
                const body = await response.json();
                if (!response.ok || !body.success) throw new Error();
                renderSuggestions(prefix, body.data?.features || []);
            } catch (error) {
                if (error.name !== "AbortError") closeSuggestions(input, list);
            }
        }, 250);
    });

    input.addEventListener("keydown", event => {
        const options = [...list.querySelectorAll("li")];
        if (!options.length) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            activeIndex = event.key === "ArrowDown"
                ? (activeIndex + 1) % options.length
                : (activeIndex - 1 + options.length) % options.length;
            options.forEach((option, index) =>
                option.setAttribute("aria-selected", String(index === activeIndex))
            );
            options[activeIndex].scrollIntoView({ block: "nearest" });
        } else if (event.key === "Enter" && activeIndex >= 0) {
            event.preventDefault();
            options[activeIndex].dispatchEvent(new MouseEvent("mousedown"));
        } else if (event.key === "Escape") {
            closeSuggestions(input, list);
        }
    });
    input.addEventListener("blur", () =>
        setTimeout(() => closeSuggestions(input, list), 140)
    );
}

function renderSuggestions(prefix, features) {
    const input = elements[`${prefix}Label`];
    const list = elements[`${prefix}Suggestions`];
    list.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const feature of features) {
        const item = document.createElement("li");
        const label = stationLabel(feature);
        const code = feature.properties?.station_code;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", "false");
        item.innerHTML = `<strong>${escapeHtml(label)}</strong>`
            + `<small>${code ? `Railway station · ${escapeHtml(String(code).toUpperCase())}` : "Railway station"}</small>`;
        item.addEventListener("mousedown", event => {
            event.preventDefault();
            selectStation(prefix, feature);
        });
        fragment.appendChild(item);
    }
    list.appendChild(fragment);
    list.classList.toggle("is-open", features.length > 0);
    input.setAttribute("aria-expanded", String(features.length > 0));
}

function stationLabel(feature) {
    const name = String(feature.properties?.station_name || "Station").toUpperCase();
    const code = feature.properties?.station_code;
    return code ? `${name} (${String(code).toUpperCase()})` : name;
}

function selectStation(prefix, feature) {
    const coordinates = feature.geometry?.coordinates || [];
    elements[`${prefix}Label`].value = stationLabel(feature);
    elements[`${prefix}Latitude`].value = coordinates[1] ?? "";
    elements[`${prefix}Longitude`].value = coordinates[0] ?? "";
    elements[`${prefix}Label`].removeAttribute("aria-invalid");
    closeSuggestions(
        elements[`${prefix}Label`], elements[`${prefix}Suggestions`]
    );
}

function closeSuggestions(input, list) {
    list.classList.remove("is-open");
    list.replaceChildren();
    input.setAttribute("aria-expanded", "false");
}

function clearCoordinates(prefix) {
    elements[`${prefix}Latitude`].value = "";
    elements[`${prefix}Longitude`].value = "";
}

function swapLocations() {
    for (const suffix of ["Label", "Latitude", "Longitude"]) {
        const origin = elements[`origin${suffix}`];
        const destination = elements[`destination${suffix}`];
        [origin.value, destination.value] = [destination.value, origin.value];
    }
}

function useCurrentLocation() {
    if (!navigator.geolocation) {
        showFormError("Geolocation is not supported by this browser.");
        return;
    }
    elements.useLocationButton.disabled = true;
    elements.useLocationButton.textContent = "Locating…";
    navigator.geolocation.getCurrentPosition(async position => {
        const { latitude, longitude } = position.coords;
        elements.originLatitude.value = latitude;
        elements.originLongitude.value = longitude;
        elements.originLabel.value = "Current location";
        elements.originLabel.removeAttribute("aria-invalid");
        elements.useLocationButton.disabled = false;
        elements.useLocationButton.innerHTML = '<span aria-hidden="true">⌖</span> Use my location';
        try {
            const response = await fetch(apiUrl(
                `railways/stations?latitude=${encodeURIComponent(latitude)}`
                + `&longitude=${encodeURIComponent(longitude)}&limit=1`
            ));
            const body = await response.json();
            const nearest = body.data?.features?.[0];
            if (response.ok && body.success && nearest) {
                elements.originLabel.value = `${stationLabel(nearest)} area`;
            }
        } catch {
            // Exact coordinates remain usable when the readable-name lookup fails.
        }
    }, error => {
        elements.useLocationButton.disabled = false;
        elements.useLocationButton.innerHTML = '<span aria-hidden="true">⌖</span> Use my location';
        showFormError(error.message || "Your current location could not be read.");
    }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 });
}

function validateAndBuildRequest() {
    let valid = true;
    for (const prefix of ["origin", "destination"]) {
        const label = elements[`${prefix}Label`];
        const latitude = Number(elements[`${prefix}Latitude`].value);
        const longitude = Number(elements[`${prefix}Longitude`].value);
        const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude)
            && elements[`${prefix}Latitude`].value !== ""
            && elements[`${prefix}Longitude`].value !== "";
        label.setAttribute("aria-invalid", String(!hasCoordinates));
        if (!hasCoordinates) valid = false;
    }
    const departureDate = elements.departureAt.value;
    const hasDeparture = /^\d{4}-\d{2}-\d{2}$/.test(departureDate)
        && Number.isFinite(Date.parse(`${departureDate}T00:00:00+05:30`));
    elements.departureAt.setAttribute("aria-invalid", String(!hasDeparture));
    if (!hasDeparture) valid = false;
    if (!valid) {
        showFormError("Select an origin and destination from the suggestions, then choose a departure time.");
        return null;
    }
    hideFormError();
    return {
        origin: {
            latitude: Number(elements.originLatitude.value),
            longitude: Number(elements.originLongitude.value),
            label: elements.originLabel.value.trim() || undefined
        },
        destination: {
            latitude: Number(elements.destinationLatitude.value),
            longitude: Number(elements.destinationLongitude.value),
            label: elements.destinationLabel.value.trim() || undefined
        },
        departureAt: departureDate,
        options: { resultLimit: 50 }
    };
}

async function submitSearch(existingRequest = null) {
    const request = existingRequest || validateAndBuildRequest();
    if (!request) return; 
    state.lastRequest = request;
    state.abortController?.abort();
    state.abortController = new AbortController();
    const sequence = ++state.requestSequence;
    setLoading(true);
    try {
        const response = await fetch(apiUrl("journeys/search"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
            signal: state.abortController.signal
        });
        const body = await readResponseBody(response);
        if (!response.ok || !body.success) {
            throw new Error(body.message || `Journey search failed (${response.status}).`);
        }
        if (sequence !== state.requestSequence) return;
        receiveResults(body.data || {}, request);
    } catch (error) {
        if (error.name === "AbortError" || sequence !== state.requestSequence) return;
        showError(error.message || "An unexpected error occurred while searching.");
    } finally {
        if (sequence === state.requestSequence) setLoading(false, true);
    }
}

async function readResponseBody(response) {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); }
    catch { throw new Error("The server returned an unreadable response."); }
}

function receiveResults(data, request) {
    state.timeZone = data.request?.timezone || "Asia/Kolkata";
    state.journeys = (Array.isArray(data.journeyResults) ? data.journeyResults : [])
        .map(normalizeJourney);
    state.journeyById = new Map(state.journeys.map(journey => [journey.id, journey]));
    state.renderedCount = PAGE_SIZE;
    resetFilterControls();
    configureTransferFilter();
    renderAirlineFilters();
    elements.routeContext.textContent = `${request.origin.label || "Origin"} → ${request.destination.label || "Destination"}`;
    if (!state.journeys.length) {
        showEmpty(false);
        return;
    }
    elements.resultsWorkspace.hidden = false;
    hideStandaloneStates();
    applyFiltersAndSort();
}

function normalizeJourney(journey) {
    const legs = Array.isArray(journey.legs) ? journey.legs : [];
    const scheduledLegs = legs.filter(leg => SCHEDULED_MODES.has(leg.mode));
    const modeSequence = scheduledLegs.map(leg => leg.mode);
    const airlines = [...new Set(
        scheduledLegs.filter(leg => leg.mode === "FLIGHT")
            .map(leg => leg.serviceName || "Airline unavailable")
    )];
    return {
        ...journey,
        id: String(journey.id),
        legs,
        modeSequence,
        airlines,
        departureMs: safeTimestamp(journey.departureAt),
        arrivalMs: safeTimestamp(journey.finalArrivalAt),
        departureMinute: clockMinute(journey.departureAt),
        arrivalMinute: clockMinute(journey.finalArrivalAt),
        totalJourneyMinutes: Number(journey.totalJourneyMinutes) || 0,
        numberOfTransfers: Number(journey.numberOfTransfers) || 0
    };
}

function configureTransferFilter() {
    const maximum = Math.max(0, ...state.journeys.map(journey => journey.numberOfTransfers));
    elements.maximumTransfers.max = String(maximum || 1);
    elements.maximumTransfers.value = String(maximum || 1);
    state.maximumTransferLimit = null;
    updateMaximumTransfersLabel();
}

function renderAirlineFilters() {
    const airlines = [...new Set(state.journeys.flatMap(journey => journey.airlines))]
        .sort((left, right) => left.localeCompare(right));
    elements.airlineFilters.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const airline of airlines) {
        const label = document.createElement("label");
        label.className = "check-row";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.name = "airline";
        input.value = airline;
        const text = document.createElement("span");
        text.textContent = airline;
        label.append(input, text);
        fragment.appendChild(label);
    }
    elements.airlineFilters.appendChild(fragment);
    elements.airlineFilterSection.hidden = airlines.length === 0;
}

function applyFiltersAndSort() {
    if (!state.journeys.length) return;
    const selectedTypes = checkedValues('input[name="journeyType"]');
    const selectedAirlines = checkedValues('input[name="airline"]');
    const departureAfter = timeToMinutes(elements.departureAfter.value);
    const departureBefore = timeToMinutes(elements.departureBefore.value);
    const arrivalAfter = timeToMinutes(elements.arrivalAfter.value);
    const arrivalBefore = timeToMinutes(elements.arrivalBefore.value);
    const fastestDuration = Math.min(...state.journeys.map(item => item.totalJourneyMinutes));
    const fewestTransfers = Math.min(...state.journeys.map(item => item.numberOfTransfers));

    state.visibleJourneys = state.journeys.filter(journey => {
        if (state.quickFilter === "fastest" && journey.totalJourneyMinutes !== fastestDuration) return false;
        if (state.quickFilter === "fewest" && journey.numberOfTransfers !== fewestTransfers) return false;
        if (selectedTypes.length && !selectedTypes.some(type => matchesJourneyType(journey, type))) return false;
        if (state.maximumTransferLimit !== null
            && journey.numberOfTransfers > state.maximumTransferLimit) return false;
        if (!withinTimeRange(journey.departureMinute, departureAfter, departureBefore)) return false;
        if (!withinTimeRange(journey.arrivalMinute, arrivalAfter, arrivalBefore)) return false;
        if (selectedAirlines.length
            && !selectedAirlines.some(airline => journey.airlines.includes(airline))) return false;
        return true;
    });
    state.visibleJourneys.sort(sortComparator(elements.sortBy.value));
    state.renderedCount = PAGE_SIZE;
    renderActiveFilters();
    renderJourneyCards();
}

function matchesJourneyType(journey, type) {
    if (type === "RAIL_ONLY") return journey.modeSequence.length > 0
        && journey.modeSequence.every(mode => mode === "RAIL");
    if (type === "FLIGHT_ONLY") return journey.modeSequence.length > 0
        && journey.modeSequence.every(mode => mode === "FLIGHT");
    if (type === "RAIL_TO_FLIGHT") return hasTransition(journey.modeSequence, "RAIL", "FLIGHT");
    if (type === "FLIGHT_TO_RAIL") return hasTransition(journey.modeSequence, "FLIGHT", "RAIL");
    return true;
}

function hasTransition(sequence, from, to) {
    return sequence.some((mode, index) => mode === from && sequence[index + 1] === to);
}

function sortComparator(sortBy) {
    const tieBreak = (left, right) => left.arrivalMs - right.arrivalMs
        || left.totalJourneyMinutes - right.totalJourneyMinutes
        || left.numberOfTransfers - right.numberOfTransfers;
    if (sortBy === "departure") return (left, right) => left.departureMs - right.departureMs || tieBreak(left, right);
    if (sortBy === "arrival") return (left, right) => left.arrivalMs - right.arrivalMs || left.numberOfTransfers - right.numberOfTransfers;
    if (sortBy === "transfers") return (left, right) => left.numberOfTransfers - right.numberOfTransfers || tieBreak(left, right);
    return (left, right) => left.totalJourneyMinutes - right.totalJourneyMinutes || tieBreak(left, right);
}

function renderJourneyCards() {
    elements.journeyResults.replaceChildren();
    const count = state.visibleJourneys.length;
    elements.resultCount.textContent = count === state.journeys.length
        ? `${count} ${pluralize(count, "journey", "journeys")} found`
        : `${count} of ${state.journeys.length} journeys match your filters`;
    if (!count) {
        elements.resultsWorkspace.hidden = true;
        showEmpty(true);
        return;
    }
    elements.resultsWorkspace.hidden = false;
    elements.emptyState.hidden = true;
    const fragment = document.createDocumentFragment();
    const fastest = Math.min(...state.journeys.map(item => item.totalJourneyMinutes));
    for (const journey of state.visibleJourneys.slice(0, state.renderedCount)) {
        fragment.appendChild(createJourneyCard(journey, fastest));
    }
    elements.journeyResults.appendChild(fragment);
    elements.showMoreButton.hidden = state.renderedCount >= count;
    if (!elements.showMoreButton.hidden) {
        const remaining = count - state.renderedCount;
        elements.showMoreButton.textContent = `Show ${Math.min(PAGE_SIZE, remaining)} more journeys`;
    }
}

function createJourneyCard(journey, fastestDuration) {
    const fragment = elements.journeyCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".journey-card");
    const summary = fragment.querySelector(".journey-summary");
    const main = fragment.querySelector(".summary-main");
    const details = fragment.querySelector(".journey-details");
    const detailsId = `journey-details-${safeId(journey.id)}`;
    card.dataset.journeyId = journey.id;
    summary.setAttribute("aria-controls", detailsId);
    summary.setAttribute("aria-label", `${journeyTypeLabel(journey)} journey, ${formatDuration(journey.totalJourneyMinutes)}, view details`);
    details.id = detailsId;
    main.innerHTML = renderSummary(journey, journey.totalJourneyMinutes === fastestDuration);
    return fragment;
}

function renderSummary(journey, isFastest) {
    const first = journey.legs[0];
    const last = journey.legs[journey.legs.length - 1];
    const origin = placeLabel(first?.from || journey.departureHub, "Origin");
    const destination = placeLabel(last?.to || journey.arrivalHub, "Destination");
    const transferText = journey.numberOfTransfers === 0
        ? "Direct scheduled service"
        : `${journey.numberOfTransfers} ${pluralize(journey.numberOfTransfers, "transfer", "transfers")}`;
    return `
        <span class="summary-top">
            <span class="journey-badges">
                <span class="badge ${journeyBadgeClass(journey)}">${escapeHtml(journeyTypeLabel(journey))}</span>
                ${isFastest ? '<span class="badge fastest">Fastest</span>' : ""}
            </span>
            <span class="rank-label">Option ${escapeHtml(String(journey.rank || ""))}</span>
        </span>
        <span class="summary-route">
            <span class="endpoint">
                <span class="endpoint-time">${formatTime(journey.departureAt)}</span>
                <span class="endpoint-date">${formatShortDate(journey.departureAt)}</span>
                <span class="endpoint-place" title="${escapeAttribute(origin)}">${escapeHtml(origin)}</span>
            </span>
            <span class="route-visual">
                <span class="duration-label">${formatDuration(journey.totalJourneyMinutes)}</span>
                <span class="route-line"><span class="route-mode-icons">${renderModeIcons(journey.modeSequence)}</span></span>
                <span class="transfer-label">${escapeHtml(transferText)}</span>
            </span>
            <span class="endpoint">
                <span class="endpoint-time">${formatTime(journey.finalArrivalAt)}</span>
                <span class="endpoint-date">${formatShortDate(journey.finalArrivalAt)}</span>
                <span class="endpoint-place" title="${escapeAttribute(destination)}">${escapeHtml(destination)}</span>
            </span>
            <span class="summary-duration">
                <strong>${formatDuration(journey.totalJourneyMinutes)}</strong>
                <span>Total journey</span>
            </span>
        </span>`;
}

function toggleJourneyDetails(event) {
    const summary = event.target.closest(".journey-summary");
    if (!summary) return;
    const card = summary.closest(".journey-card");
    const details = card.querySelector(".journey-details");
    const journey = state.journeyById.get(card.dataset.journeyId);
    const opening = summary.getAttribute("aria-expanded") !== "true";
    summary.setAttribute("aria-expanded", String(opening));
    card.classList.toggle("is-open", opening);
    details.hidden = !opening;
    summary.querySelector(".expand-label").childNodes[0].nodeValue = opening
        ? "Hide details " : "View details ";
    if (opening && !details.dataset.rendered) {
        details.innerHTML = renderTimeline(journey);
        details.dataset.rendered = "true";
    }
}

function renderTimeline(journey) {
    const legs = journey.legs;
    const last = legs[legs.length - 1];
    return `
        <div class="detail-title">
            <h3>Complete journey</h3>
            <span>${legs.length} ${pluralize(legs.length, "leg", "legs")}</span>
        </div>
        <div class="timeline">
            ${legs.map(renderLeg).join("")}
            ${last ? `
                <div class="arrival-row">
                    <div class="timeline-time">${formatTime(last.arrivalAt)}<small>${formatShortDate(last.arrivalAt)}</small></div>
                    <div class="arrival-dot" aria-hidden="true"></div>
                    <div class="arrival-place">Arrive at ${escapeHtml(placeLabel(last.to, "destination"))}</div>
                </div>` : ""}
        </div>`;
}

function renderLeg(leg) {
    const mode = String(leg.mode || "TRANSFER");
    const from = placeLabel(leg.from, "Origin");
    const to = placeLabel(leg.to, "Destination");
    const service = serviceLabel(leg);
    const metadata = legMetadata(leg);
    return `
        <div class="timeline-leg ${mode.toLowerCase()}">
            <div class="timeline-time">${formatTime(leg.departureAt)}<small>${formatShortDate(leg.departureAt)}</small></div>
            <div class="timeline-track">
                <span class="timeline-dot" aria-hidden="true">${modeIcon(mode)}</span>
                <span class="timeline-stem"></span>
            </div>
            <div class="timeline-content">
                <div class="leg-head">
                    <div>
                        <div class="leg-mode">${escapeHtml(legModeLabel(leg))}</div>
                        ${service ? `<div class="leg-service">${escapeHtml(service)}</div>` : ""}
                    </div>
                    <span class="leg-duration">${formatDuration(leg.durationMinutes)}</span>
                </div>
                <div class="leg-route"> ${ from.trim() === to.trim() ? escapeHtml(from) : `${escapeHtml(from)} → ${escapeHtml(to)}` }</div>
                ${metadata ? `<div class="leg-meta">${metadata}</div>` : ""}
            </div>
        </div>`;
}

function legModeLabel(leg) {
    if (leg.mode === "RAIL") return "Train";
    if (leg.mode === "FLIGHT") return "Flight";
    if (leg.mode === "LOCAL") return "Road access";
    if (leg.mode === "WAIT") return waitLabel(leg.transferType);
    if (leg.mode === "TRANSFER") {
        if (leg.transferType === "RAIL_TRANSFER") return "Rail transfer";
        if (leg.transferType === "RAIL_TO_FLIGHT") return "Road transfer · Train to airport";
        if (leg.transferType === "FLIGHT_TO_RAIL") return "Road transfer · Airport to train";
        return "Road transfer";
    }
    return titleCase(leg.mode || "Journey leg");
}

function waitLabel(type) {
    if (type === "INITIAL_BOARDING_BUFFER") return "Boarding buffer";
    if (type === "RAIL_WAIT") return "Wait for train";
    if (type === "FLIGHT_WAIT") return "Wait for flight";
    if (type === "BOARDING_WAIT") return "Boarding wait";
    return "Transfer wait";
}

function serviceLabel(leg) {
    const number = leg.serviceNumber ? String(leg.serviceNumber) : "";
    const name = leg.serviceName ? String(leg.serviceName) : "";
    if (name && number) return `${name} · ${number}`;
    return name || number;
}

function legMetadata(leg) {
    const values = [];
    if (leg.terminalFrom) values.push(`From terminal ${escapeHtml(String(leg.terminalFrom))}`);
    if (leg.terminalTo) values.push(`To terminal ${escapeHtml(String(leg.terminalTo))}`);
    if (Number.isFinite(Number(leg.numberOfStops))) {
        const stops = Number(leg.numberOfStops);
        values.push(`${stops} ${pluralize(stops, "stop", "stops")}`);
    }
    if (leg.estimatedRoadDistanceKm !== null
        && leg.estimatedRoadDistanceKm !== undefined
        && Number.isFinite(Number(leg.estimatedRoadDistanceKm))) {
        values.push(`Est. ${formatDistance(leg.estimatedRoadDistanceKm)} by road`);
    } else if (leg.distanceKm !== null
        && leg.distanceKm !== undefined
        && Number.isFinite(Number(leg.distanceKm))) {
        values.push(formatDistance(leg.distanceKm));
    }
    return values.map(value => `<span>${value}</span>`).join("");
}

function journeyTypeLabel(journey) {
    if (journey.journeyType === "RAIL_ONLY") return "Train only";
    if (journey.journeyType === "FLIGHT_ONLY") return "Flight only";
    if (hasTransition(journey.modeSequence, "RAIL", "FLIGHT")
        && !hasTransition(journey.modeSequence, "FLIGHT", "RAIL")) return "Train → Flight";
    if (hasTransition(journey.modeSequence, "FLIGHT", "RAIL")
        && !hasTransition(journey.modeSequence, "RAIL", "FLIGHT")) return "Flight → Train";
    return "Mixed journey";
}

function placeLabel(place, fallback) {
    const currentLabel = String(place?.name || fallback);
    if (place?.kind !== "AIRPORT") return currentLabel;
    const city = String(place.city || "").trim();
    const iata = String(place.code || "").trim().toUpperCase();
    return city && iata
        ? `${currentLabel} ${city} (${iata})`
        : currentLabel;
}

function journeyBadgeClass(journey) {
    if (journey.journeyType === "RAIL_ONLY") return "rail";
    if (journey.journeyType === "FLIGHT_ONLY") return "flight";
    return "mixed";
}

function renderModeIcons(sequence) {
    return sequence.map(mode => `<span title="${mode === "RAIL" ? "Train" : "Flight"}">${modeIcon(mode)}</span>`).join("");
}

function modeIcon(mode) {
    if (mode === "RAIL") return "▰";
    if (mode === "FLIGHT") return "✈";
    if (mode === "WAIT") return "◷";
    if (mode === "LOCAL" || mode === "TRANSFER") return "↝";
    return "•";
}

function toggleQuickFilter(filter) {
    state.quickFilter = state.quickFilter === filter ? null : filter;
    document.querySelectorAll("[data-quick-filter]").forEach(button =>
        button.setAttribute("aria-pressed", String(button.dataset.quickFilter === state.quickFilter))
    );
    applyFiltersAndSort();
}

function clearFilters() {
    resetFilterControls();
    configureTransferFilter();
    applyFiltersAndSort();
    closeFilters();
}

function resetFilterControls() {
    state.quickFilter = null;
    state.maximumTransferLimit = null;
    document.querySelectorAll("[data-quick-filter]").forEach(button =>
        button.setAttribute("aria-pressed", "false")
    );
    document.querySelectorAll('input[name="journeyType"], input[name="airline"]')
        .forEach(input => { input.checked = false; });
    for (const input of [
        elements.departureAfter, elements.departureBefore,
        elements.arrivalAfter, elements.arrivalBefore
    ]) input.value = "";
    elements.sortBy.value = "duration";
}

function renderActiveFilters() {
    const chips = [];
    if (state.quickFilter) chips.push({ key: "quick", label: titleCase(state.quickFilter) });
    document.querySelectorAll('input[name="journeyType"]:checked').forEach(input =>
        chips.push({ key: `type:${input.value}`, label: journeyTypeFilterLabel(input.value) })
    );
    if (state.maximumTransferLimit !== null) {
        chips.push({ key: "maxTransfers", label: `Up to ${state.maximumTransferLimit} transfers` });
    }
    for (const [key, label, input] of [
        ["departureAfter", "Departs after", elements.departureAfter],
        ["departureBefore", "Departs before", elements.departureBefore],
        ["arrivalAfter", "Arrives after", elements.arrivalAfter],
        ["arrivalBefore", "Arrives before", elements.arrivalBefore]
    ]) if (input.value) chips.push({ key, label: `${label} ${input.value}` });
    document.querySelectorAll('input[name="airline"]:checked').forEach(input =>
        chips.push({ key: `airline:${input.value}`, label: input.value })
    );
    elements.activeFilters.innerHTML = chips.map(chip =>
        `<button type="button" class="filter-chip" data-filter-key="${escapeAttribute(chip.key)}"`
        + ` aria-label="Remove ${escapeAttribute(chip.label)} filter">${escapeHtml(chip.label)}</button>`
    ).join("");
}

function removeFilterFromChip(event) {
    const button = event.target.closest("[data-filter-key]");
    if (!button) return;
    const key = button.dataset.filterKey;
    if (key === "quick") {
        state.quickFilter = null;
        document.querySelectorAll("[data-quick-filter]").forEach(item => item.setAttribute("aria-pressed", "false"));
    } else if (key === "maxTransfers") {
        state.maximumTransferLimit = null;
        elements.maximumTransfers.value = elements.maximumTransfers.max;
        updateMaximumTransfersLabel();
    } else if (key.startsWith("type:")) {
        const input = document.querySelector(`input[name="journeyType"][value="${cssEscape(key.slice(5))}"]`);
        if (input) input.checked = false;
    } else if (key.startsWith("airline:")) {
        const value = key.slice(8);
        [...document.querySelectorAll('input[name="airline"]')]
            .filter(input => input.value === value).forEach(input => { input.checked = false; });
    } else if (elements[key]) {
        elements[key].value = "";
    }
    applyFiltersAndSort();
}

function updateMaximumTransfersLabel() {
    elements.maximumTransfersValue.value = state.maximumTransferLimit === null
        ? "Any" : String(state.maximumTransferLimit);
    elements.maximumTransfersValue.textContent = elements.maximumTransfersValue.value;
}

function checkedValues(selector) {
    return [...document.querySelectorAll(`${selector}:checked`)].map(input => input.value);
}

function withinTimeRange(value, after, before) {
    if (after !== null && before !== null && after > before) {
        return value >= after || value <= before;
    }
    return (after === null || value >= after) && (before === null || value <= before);
}

function timeToMinutes(value) {
    if (!value) return null;
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
}

function clockMinute(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 0;
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: state.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(date);
    const hour = Number(parts.find(part => part.type === "hour")?.value || 0);
    const minute = Number(parts.find(part => part.type === "minute")?.value || 0);
    return hour * 60 + minute;
}

function openFilters() {
    elements.filterPanel.classList.add("is-open");
    elements.filterPanel.removeAttribute("inert");
    elements.filterPanel.removeAttribute("aria-hidden");
    elements.filterBackdrop.hidden = false;
    elements.openFiltersButton.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
}

function closeFilters() {
    elements.filterPanel.classList.remove("is-open");
    elements.filterBackdrop.hidden = true;
    elements.openFiltersButton.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
    syncFilterPanelAccessibility();
}

function syncFilterPanelAccessibility() {
    const hiddenOnMobile = mobileFilterMedia.matches
        && !elements.filterPanel.classList.contains("is-open");
    elements.filterPanel.toggleAttribute("inert", hiddenOnMobile);
    if (hiddenOnMobile) elements.filterPanel.setAttribute("aria-hidden", "true");
    else elements.filterPanel.removeAttribute("aria-hidden");
}

function setLoading(loading, preserveSearchState = false) {
    elements.searchButton.disabled = loading;
    elements.searchButton.classList.toggle("is-loading", loading);
    elements.journeyResults.setAttribute("aria-busy", String(loading));
    if (loading) {
        elements.initialState.hidden = true;
        elements.errorState.hidden = true;
        elements.emptyState.hidden = true;
        elements.resultsWorkspace.hidden = true;
        elements.loadingState.hidden = false;
    } else {
        elements.loadingState.hidden = true;
        if (!preserveSearchState && !state.journeys.length) elements.initialState.hidden = false;
    }
}

function showError(message) {
    hideStandaloneStates();
    elements.resultsWorkspace.hidden = true;
    elements.errorMessage.textContent = message;
    elements.errorState.hidden = false;
}

function showEmpty(filtered) {
    hideStandaloneStates();
    elements.resultsWorkspace.hidden = true;
    elements.emptyTitle.textContent = filtered ? "No journeys match these filters" : "No journeys found";
    elements.emptyMessage.textContent = filtered
        ? "Clear one or more filters to see other available routes."
        : "Try a different departure time or choose nearby locations.";
    elements.emptyActionButton.textContent = filtered ? "Clear filters" : "Change search";
    elements.emptyState.hidden = false;
}

function hideStandaloneStates() {
    elements.initialState.hidden = true;
    elements.loadingState.hidden = true;
    elements.errorState.hidden = true;
    elements.emptyState.hidden = true;
}

function showFormError(message) {
    elements.formError.textContent = message;
    elements.formError.hidden = false;
}

function hideFormError() {
    elements.formError.hidden = true;
    elements.formError.textContent = "";
}

function formatDuration(minutes) {
    const value = Math.max(0, Math.round(Number(minutes) || 0));
    const days = Math.floor(value / 1440);
    const hours = Math.floor((value % 1440) / 60);
    const remainder = value % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (remainder || !parts.length) parts.push(`${remainder}m`);
    return parts.join(" ");
}

function formatTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "—";
    return new Intl.DateTimeFormat("en-IN", {
        timeZone: state.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).format(date);
}

function formatShortDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-IN", {
        timeZone: state.timeZone, weekday: "short", day: "numeric", month: "short"
    }).format(date);
}

function formatDistance(value) {
    const distance = Number(value);
    if (!Number.isFinite(distance)) return "";
    return `${distance < 10 ? distance.toFixed(1) : Math.round(distance)} km`;
}

function journeyTypeFilterLabel(value) {
    return ({
        RAIL_ONLY: "Train only", FLIGHT_ONLY: "Flight only",
        RAIL_TO_FLIGHT: "Train → Flight", FLIGHT_TO_RAIL: "Flight → Train"
    })[value] || titleCase(value);
}

function titleCase(value) {
    return String(value).replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function pluralize(count, singular, plural) {
    return Number(count) === 1 ? singular : plural;
}

function safeTimestamp(value) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function safeId(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function cssEscape(value) {
    return window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
}
