require("dotenv/config");

const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const app = require("../dist/app").default;
const { prisma } = require("../dist/config/database");
const {
    parseMultimodalSearch
} = require("../dist/validators/multimodal-journey.validator");
const {
    findNearbyRoutingHubs,
    loadFlightInstances,
    loadRoutingHubs,
    loadTransferLinks
} = require("../dist/repositories/multimodal-routing.repository");
const {
    compareMultimodalJourneyResults,
    isRailOnlyJourneyTypeSelection,
    selectMultimodalJourneyResults,
    searchMultimodalJourneys
} = require("../dist/services/multimodal-journey.service");

let server;
let baseUrl;

before(async () => {
    await new Promise(resolve => {
        server = app.listen(0, "127.0.0.1", () => {
            baseUrl = `http://127.0.0.1:${server.address().port}`;
            resolve();
        });
    });
});

after(async () => {
    if (server) {
        await new Promise((resolve, reject) =>
            server.close(error => error ? reject(error) : resolve())
        );
    }
    await prisma.$disconnect();
});

test("multimodal search applies bounded phase-one defaults", () => {
    const result = parseMultimodalSearch({
        origin: { latitude: 30.3165, longitude: 78.0322 },
        destination: { latitude: 23.0225, longitude: 72.5714 },
        departureAt: "2026-09-07T08:00:00+05:30"
    });
    assert.equal(result.options.sourceRailRadiusKm, 200);
    assert.equal(result.options.sourceAirportRadiusKm, 300);
    assert.equal(result.options.maximumTransfers, undefined);
    assert.equal(result.options.journeyTypes, undefined);
    assert.equal(result.options.resultOffset, undefined);
    assert.equal(result.options.pageSize, undefined);
    assert.equal(result.options.resultLimit, 20);
    assert.equal(result.options.sortBy, "recommended");
    assert.equal(result.departureAt, "2026-09-07T08:00:00+05:30");
});

test("multimodal search accepts server-side journey type filters", () => {
    const result = parseMultimodalSearch({
        origin: { latitude: 30.3165, longitude: 78.0322 },
        destination: { latitude: 23.0225, longitude: 72.5714 },
        departureAt: "2026-09-07T08:00:00+05:30",
        options: { journeyTypes: ["RAIL_ONLY", "RAIL_TO_FLIGHT"] }
    });
    assert.deepEqual(result.options.journeyTypes, ["RAIL_ONLY", "RAIL_TO_FLIGHT"]);
});

test("multimodal search accepts server-side sorting", () => {
    const result = parseMultimodalSearch({
        origin: { latitude: 22.7196, longitude: 75.8577 },
        destination: { latitude: 32.7266, longitude: 74.857 },
        departureAt: "2026-09-07T08:00:00+05:30",
        options: { sortBy: "arrival" }
    });
    assert.equal(result.options.sortBy, "arrival");
});

test("multimodal search accepts bounded server-side pagination", () => {
    const result = parseMultimodalSearch({
        origin: { latitude: 30.3165, longitude: 78.0322 },
        destination: { latitude: 23.0225, longitude: 72.5714 },
        departureAt: "2026-09-07T08:00:00+05:30",
        options: { resultOffset: 2, pageSize: 3, resultLimit: 5 }
    });
    assert.equal(result.options.resultOffset, 2);
    assert.equal(result.options.pageSize, 3);
    assert.equal(result.options.resultLimit, 5);
});

test("multimodal search clamps legacy pagination to twenty results", () => {
    const result = parseMultimodalSearch({
        origin: { latitude: 30.3165, longitude: 78.0322 },
        destination: { latitude: 23.0225, longitude: 72.5714 },
        departureAt: "2026-09-07T08:00:00+05:30",
        options: { resultOffset: 40, pageSize: 20, resultLimit: 50 }
    });
    assert.equal(result.options.resultOffset, 20);
    assert.equal(result.options.pageSize, 20);
    assert.equal(result.options.resultLimit, 20);
});

test("multimodal search rejects unknown journey type filters", () => {
    assert.throws(() => parseMultimodalSearch({
        origin: { latitude: 30.3165, longitude: 78.0322 },
        destination: { latitude: 23.0225, longitude: 72.5714 },
        departureAt: "2026-09-07T08:00:00+05:30",
        options: { journeyTypes: ["TRAIN"] }
    }));
});

test("only an exclusive train-only filter uses the rail fast path", () => {
    assert.equal(isRailOnlyJourneyTypeSelection(["RAIL_ONLY"]), true);
    assert.equal(isRailOnlyJourneyTypeSelection(["FLIGHT_ONLY"]), false);
    assert.equal(isRailOnlyJourneyTypeSelection(["RAIL_TO_FLIGHT"]), false);
    assert.equal(isRailOnlyJourneyTypeSelection(["FLIGHT_TO_RAIL"]), false);
    assert.equal(
        isRailOnlyJourneyTypeSelection(["RAIL_ONLY", "FLIGHT_ONLY"]),
        false
    );
    assert.equal(isRailOnlyJourneyTypeSelection(undefined), false);
});

test("multimodal candidates are filtered, limited, and reranked", () => {
    const result = (id, journeyType, modes, minutes) => ({
        id,
        rank: 0,
        journeyType,
        departureHub: {},
        arrivalHub: {},
        departureAt: "2026-09-15T00:00:00.000+05:30",
        finalArrivalAt: "2026-09-15T12:00:00.000+05:30",
        totalJourneyMinutes: minutes,
        numberOfTransfers: 0,
        scheduledLegs: modes.length,
        modes: [...new Set(modes)],
        legs: modes.map(mode => ({ mode }))
    });
    const candidates = [
        result("flight", "FLIGHT_ONLY", ["FLIGHT"], 300),
        result("rail", "RAIL_ONLY", ["RAIL"], 400),
        result("mixed", "MIXED", ["RAIL", "FLIGHT"], 500)
    ];

    const selected = selectMultimodalJourneyResults(
        candidates,
        ["RAIL_ONLY", "RAIL_TO_FLIGHT"],
        5
    );

    assert.deepEqual(selected.map(item => item.id), ["rail", "mixed"]);
    assert.deepEqual(selected.map(item => item.rank), [1, 2]);
});

test("multimodal server sorting defaults to transfers and honors overrides", () => {
    const candidate = (id, transfers, minutes) => ({
        id,
        rank: 0,
        journeyType: transfers === 0 ? "RAIL_ONLY" : "MIXED",
        departureHub: {},
        arrivalHub: {},
        departureAt: "2026-09-15T08:00:00+05:30",
        finalArrivalAt: `2026-09-15T${transfers === 0 ? "20" : "16"}:00:00+05:30`,
        totalJourneyMinutes: minutes,
        numberOfTransfers: transfers,
        scheduledLegs: transfers + 1,
        modes: ["RAIL"],
        legs: []
    });
    const direct = candidate("direct", 0, 720);
    const transfer = candidate("transfer", 1, 480);

    assert.deepEqual(
        selectMultimodalJourneyResults([transfer, direct], undefined, 5)
            .map(item => item.id),
        ["direct", "transfer"]
    );
    assert.deepEqual(
        selectMultimodalJourneyResults(
            [transfer, direct],
            undefined,
            5,
            "duration"
        ).map(item => item.id),
        ["transfer", "direct"]
    );
});

test("rail-only ranking prefers an earlier-arriving direct train over a shorter trip days later", () => {
    const railOnly = (id, departureAt, finalArrivalAt, minutes, roadMinutes) => ({
        id,
        rank: 0,
        journeyType: "RAIL_ONLY",
        departureHub: {},
        arrivalHub: {},
        departureAt,
        finalArrivalAt,
        totalJourneyMinutes: minutes,
        numberOfTransfers: 0,
        scheduledLegs: 1,
        modes: ["RAIL"],
        legs: [{ mode: "LOCAL", durationMinutes: roadMinutes }]
    });
    // Haridwar -> Kota, 2026-11-05 15:15: daily 12402 arrives on 6 Nov,
    // while the Sunday-only 09102 is shorter but arrives on 9 Nov.
    const earlier = railOnly(
        "earlier", "2026-11-05T23:49:00+05:30", "2026-11-06T10:41:00+05:30", 652, 51
    );
    const later = railOnly(
        "later", "2026-11-08T16:22:00+05:30", "2026-11-09T04:08:00+05:30", 706, 27
    );

    assert.deepEqual(
        selectMultimodalJourneyResults([later, earlier], undefined, 5)
            .map(item => item.id),
        ["earlier", "later"]
    );
});

test("multimodal search accepts the recommended sort", () => {
    const result = parseMultimodalSearch({
        origin: { latitude: 30.3165, longitude: 78.0322 },
        destination: { latitude: 23.0225, longitude: 72.5714 },
        departureAt: "2026-09-07T08:00:00+05:30",
        options: { sortBy: "recommended" }
    });
    assert.equal(result.options.sortBy, "recommended");
});

test("recommended ranking weighs final arrival against a per-transfer penalty", () => {
    const railOnly = (id, departureAt, finalArrivalAt, transfers) => ({
        id,
        rank: 0,
        journeyType: "RAIL_ONLY",
        departureHub: {},
        arrivalHub: {},
        departureAt,
        finalArrivalAt,
        totalJourneyMinutes: Math.round(
            (Date.parse(finalArrivalAt) - Date.parse(departureAt)) / 60_000
        ),
        numberOfTransfers: transfers,
        scheduledLegs: transfers + 1,
        modes: ["RAIL"],
        legs: [{ mode: "LOCAL", durationMinutes: 0 }]
    });
    // Dehradun -> Chennai, 2026-10-28 16:30: the direct train leaves two days
    // later and arrives 34h after a one-transfer journey leaving the same day.
    const laterDirect = railOnly(
        "laterDirect", "2026-10-30T08:52:00+05:30", "2026-11-01T02:10:00+05:30", 0
    );
    const sameDayTransfer = railOnly(
        "sameDayTransfer", "2026-10-28T22:25:00+05:30", "2026-10-30T16:01:00+05:30", 1
    );
    assert.deepEqual(
        selectMultimodalJourneyResults(
            [laterDirect, sameDayTransfer], undefined, 5, "recommended", 240
        ).map(item => item.id),
        ["sameDayTransfer", "laterDirect"]
    );
    // A direct train arriving within the penalty of the connection still wins.
    const nearDirect = railOnly(
        "nearDirect", "2026-10-28T20:00:00+05:30", "2026-10-30T19:00:00+05:30", 0
    );
    assert.deepEqual(
        selectMultimodalJourneyResults(
            [sameDayTransfer, nearDirect], undefined, 5, "recommended", 240
        ).map(item => item.id),
        ["nearDirect", "sameDayTransfer"]
    );
});

test("multimodal ranking prefers practicality over raw duration alone", () => {
    const base = {
        id: "base",
        rank: 0,
        journeyType: "FLIGHT_ONLY",
        departureHub: {},
        arrivalHub: {},
        departureAt: "2026-09-15T00:00:00.000+05:30",
        finalArrivalAt: "2026-09-15T12:00:00.000+05:30",
        scheduledLegs: 1,
        modes: ["FLIGHT"],
        legs: []
    };
    const slowerDirect = {
        ...base,
        id: "slower-direct",
        totalJourneyMinutes: 600,
        numberOfTransfers: 0
    };

    // A single extra transfer that only buys back a few minutes is not worth it -
    // the flat per-transfer penalty should outweigh a 10 minute saving.
    const marginallyFasterConnection = {
        ...base,
        id: "marginally-faster-connection",
        totalJourneyMinutes: 590,
        numberOfTransfers: 1
    };
    assert.ok(
        compareMultimodalJourneyResults(slowerDirect, marginallyFasterConnection) < 0
    );

    // But a genuinely large time saving still justifies the extra transfer.
    const substantiallyFasterConnection = {
        ...base,
        id: "substantially-faster-connection",
        totalJourneyMinutes: 500,
        numberOfTransfers: 1
    };
    assert.ok(
        compareMultimodalJourneyResults(substantiallyFasterConnection, slowerDirect) < 0
    );

    // Equal duration: fewer transfers wins outright.
    const equalDirect = {
        ...slowerDirect,
        id: "equal-direct",
        totalJourneyMinutes: 590
    };
    assert.ok(compareMultimodalJourneyResults(equalDirect, marginallyFasterConnection) < 0);

    // Four transfers should only outrank a single-transfer route when the benefit
    // is substantial, not when it merely ties on duration.
    const fourTransferSameDuration = {
        ...base,
        id: "four-transfer-same-duration",
        totalJourneyMinutes: 590,
        numberOfTransfers: 4
    };
    assert.ok(
        compareMultimodalJourneyResults(marginallyFasterConnection, fourTransferSameDuration) < 0
    );
});

test("multimodal ranking prefers a much shorter flight distance over a marginally faster route", () => {
    const flightLeg = (distanceKm, durationMinutes) => ({
        mode: "FLIGHT",
        from: {},
        to: {},
        departureAt: "2026-09-15T01:00:00.000+05:30",
        arrivalAt: "2026-09-15T03:00:00.000+05:30",
        durationMinutes,
        distanceKm
    });
    const base = {
        rank: 0,
        journeyType: "FLIGHT_ONLY",
        departureHub: {},
        arrivalHub: {},
        departureAt: "2026-09-15T00:00:00.000+05:30",
        finalArrivalAt: "2026-09-15T12:00:00.000+05:30",
        scheduledLegs: 1,
        numberOfTransfers: 0,
        modes: ["FLIGHT"]
    };
    const longFlightFasterOverall = {
        ...base,
        id: "long-flight-faster-overall",
        totalJourneyMinutes: 580,
        legs: [flightLeg(2000, 150)]
    };
    const shortFlightSlightlySlower = {
        ...base,
        id: "short-flight-slightly-slower",
        totalJourneyMinutes: 610,
        legs: [flightLeg(600, 90)]
    };
    assert.ok(
        compareMultimodalJourneyResults(shortFlightSlightlySlower, longFlightFasterOverall) < 0
    );

    // A much longer duration should not be overridden by a shorter flight distance.
    const shortFlightMuchSlower = {
        ...base,
        id: "short-flight-much-slower",
        totalJourneyMinutes: 1200,
        legs: [flightLeg(600, 90)]
    };
    assert.ok(
        compareMultimodalJourneyResults(longFlightFasterOverall, shortFlightMuchSlower) < 0
    );
});

test("origin discovery can include every airport inside its configured radius", async t => {
    const hubs = await findNearbyRoutingHubs(
        30.343858626744293,
        78.04765623456036,
        200,
        300,
        1,
        true
    );
    const airports = hubs.filter(hub => hub.type === "AIRPORT");
    if (airports.length === 0) {
        t.skip("Airport hubs have not been imported in this database.");
        return;
    }
    assert.ok(airports.length > 1);
    assert.ok(airports.some(hub => hub.code === "DEL"));
});

test("multimodal search rejects an invalid calendar datetime", () => {
    assert.throws(() => parseMultimodalSearch({
        origin: { latitude: 30.3165, longitude: 78.0322 },
        destination: { latitude: 23.0225, longitude: 72.5714 },
        departureAt: "2026-02-30T08:00:00+05:30"
    }));
});

test("multimodal search normalizes a legacy date-only departure", () => {
    const result = parseMultimodalSearch({
        origin: { latitude: 30.3165, longitude: 78.0322 },
        destination: { latitude: 23.0225, longitude: 72.5714 },
        departureAt: "2026-09-07"
    });
    assert.equal(result.departureAt, "2026-09-07T00:00:00+05:30");
});

test("multimodal search requires an offset when a time is supplied", () => {
    assert.throws(() => parseMultimodalSearch({
        origin: { latitude: 30.3165, longitude: 78.0322 },
        destination: { latitude: 23.0225, longitude: 72.5714 },
        departureAt: "2026-09-07T05:00"
    }));
});

test("multimodal journey endpoint is registered and validates requests", async () => {
    const response = await fetch(`${baseUrl}/api/v1/journeys/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.match(body.message, /multimodal journey search/i);
});

test("loadFlightInstances applies time, service, and per-route limits in SQL", async t => {
    const start = new Date("2026-11-16T00:00:00.000+05:30");
    const end = new Date("2026-11-19T00:00:00.000+05:30");
    const nonScheduledCount = await prisma.aviationAirline.count({
        where: { serviceType: { not: "scheduled" } }
    });
    if (nonScheduledCount === 0) {
        t.skip("No non-scheduled airlines are present in this database.");
        return;
    }
    const flights = await loadFlightInstances(start, end, 5);
    if (flights.length === 0) {
        t.skip("No flight instances are present in this database for the window.");
        return;
    }
    assert.ok(flights.every(flight => flight.airline !== null));
    assert.ok(flights.every(flight => flight.airline.serviceType === "scheduled"));
    assert.ok(flights.every(flight =>
        flight.departureAt >= start && flight.departureAt <= end
    ));
    const countsByRoute = new Map();
    for (const flight of flights) {
        const route = `${flight.departureAirport.hub.id}>${flight.arrivalAirport.hub.id}`;
        countsByRoute.set(route, (countsByRoute.get(route) ?? 0) + 1);
    }
    assert.ok([...countsByRoute.values()].every(count => count <= 5));
});

test("busy airports keep later flights: Delhi to Mangaluru finds the afternoon direct", async t => {
    const direct = await prisma.aviationFlightInstance.findFirst({
        where: {
            active: true,
            departureAt: {
                gte: new Date("2026-11-16T12:00:00+05:30"),
                lt: new Date("2026-11-17T00:00:00+05:30")
            },
            departureAirport: { iataCode: "DEL" },
            arrivalAirport: { iataCode: "IXE" }
        }
    });
    if (!direct) {
        t.skip("No afternoon DEL -> IXE flight on 2026-11-16 in this database.");
        return;
    }
    // A 06:00 search used to load only Delhi's first 150 departures (to about
    // 11:00), so the afternoon direct flight never entered the search.
    const response = await fetch(`${baseUrl}/api/v1/journeys/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            origin: { latitude: 28.6139, longitude: 77.2090 },
            destination: { latitude: 12.9141, longitude: 74.8560 },
            departureAt: "2026-11-16T06:00:00+05:30",
            options: { journeyTypes: ["FLIGHT_ONLY"], resultOffset: 0, pageSize: 20 }
        })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(body.data.journeyResults.some(journey => {
        const flights = journey.legs.filter(leg => leg.mode === "FLIGHT");
        return flights.length === 1
            && flights[0].from.code === "DEL"
            && flights[0].to.code === "IXE";
    }), "Expected the direct DEL -> IXE flight among the results.");
});

test("Mixed search finds the same-day train-then-flight trip: Jhansi to Bengaluru", async t => {
    const flight = await prisma.aviationFlightInstance.findFirst({
        where: {
            active: true,
            departureAt: {
                gte: new Date("2026-11-16T12:00:00+05:30"),
                lt: new Date("2026-11-16T18:00:00+05:30")
            },
            departureAirport: { iataCode: "DEL" },
            arrivalAirport: { iataCode: "BLR" }
        }
    });
    if (!flight) {
        t.skip("No afternoon DEL -> BLR flight on 2026-11-16 in this database.");
        return;
    }
    // The search used to stop at the first 20 matches it met. Flight-then-
    // train trips are found first, so the best option was a Bhopal evening
    // flight arriving the next morning, not a morning train to Delhi and an
    // afternoon flight arriving the same day.
    const response = await fetch(`${baseUrl}/api/v1/journeys/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            origin: { latitude: 25.4484, longitude: 78.5685 },
            destination: { latitude: 12.9716, longitude: 77.5946 },
            departureAt: "2026-11-16T06:00:00+05:30",
            options: {
                journeyTypes: ["RAIL_TO_FLIGHT", "FLIGHT_TO_RAIL"],
                resultOffset: 0,
                pageSize: 20
            }
        })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    const best = body.data.journeyResults[0];
    const scheduledModes = best.legs
        .filter(leg => leg.mode === "RAIL" || leg.mode === "FLIGHT")
        .map(leg => leg.mode);
    assert.deepEqual(scheduledModes, ["RAIL", "FLIGHT"]);
    assert.ok(
        best.finalArrivalAt.startsWith("2026-11-16"),
        `Expected a same-day arrival; got ${best.finalArrivalAt}`
    );
});

test("all-types search expands origin airports first: Dehradun to Chennai finds the IXC direct", async t => {
    const direct = await prisma.aviationFlightInstance.findFirst({
        where: {
            active: true,
            departureAt: {
                gte: new Date("2026-11-16T09:00:00+05:30"),
                lt: new Date("2026-11-17T00:00:00+05:30")
            },
            departureAirport: { iataCode: "IXC" },
            arrivalAirport: { iataCode: "MAA" }
        }
    });
    if (!direct) {
        t.skip("No IXC -> MAA flight on 2026-11-16 in this database.");
        return;
    }
    // With trains allowed, trains heading south used to keep the Chandigarh
    // airport (about 2,000 km from Chennai) from ever being expanded.
    const response = await fetch(`${baseUrl}/api/v1/journeys/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            origin: { latitude: 30.3165, longitude: 78.0322 },
            destination: { latitude: 13.0827, longitude: 80.2707 },
            departureAt: "2026-11-16T06:00:00+05:30",
            options: { resultOffset: 0, pageSize: 20 }
        })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(body.data.journeyResults.some(journey => {
        const scheduled = journey.legs.filter(leg =>
            leg.mode === "RAIL" || leg.mode === "FLIGHT");
        return scheduled.length === 1
            && scheduled[0].from.code === "IXC"
            && scheduled[0].to.code === "MAA";
    }), "Expected the direct IXC -> MAA flight among the results.");
});

test("imported flight instances are domestic operating services", async t => {
    const count = await prisma.aviationFlightInstance.count();
    if (count === 0) {
        t.skip("Flight schedules have not been imported in this database.");
        return;
    }
    const invalid = await prisma.aviationFlightInstance.count({
        where: {
            OR: [
                { departureAirport: { countryCode: { not: "IN" } } },
                { arrivalAirport: { countryCode: { not: "IN" } } },
                { arrivalAt: { lte: new Date("2000-01-01T00:00:00Z") } }
            ]
        }
    });
    assert.equal(invalid, 0);
});

test("airport hubs expose their existing city and IATA data", async t => {
    const hubs = await loadRoutingHubs();
    const airport = [...hubs.values()].find(hub =>
        hub.type === "AIRPORT" && hub.cityId !== null
    );
    if (!airport) {
        t.skip("No city-linked airport hub is available in this database.");
        return;
    }
    assert.ok(airport.cityName);
    assert.match(airport.code, /^[A-Z]{3}$/);
});

test("DDN to DEL on 2026-09-18 ranks the direct DED flight ahead of rail-only routes", async t => {
    const dedAirport = await prisma.aviationAirport.findUnique({ where: { iataCode: "DED" } });
    const delAirport = await prisma.aviationAirport.findUnique({ where: { iataCode: "DEL" } });
    if (!dedAirport || !delAirport) {
        t.skip("DED/DEL airports have not been imported in this database.");
        return;
    }
    const directFlightExists = await prisma.aviationFlightInstance.count({
        where: {
            departureAirportId: dedAirport.id,
            arrivalAirportId: delAirport.id,
            serviceDate: new Date("2026-09-18T00:00:00.000Z"),
            active: true
        }
    });
    if (directFlightExists === 0) {
        t.skip("No direct DED->DEL flight instance on 2026-09-18 in this database.");
        return;
    }

    const result = await searchMultimodalJourneys({
        origin: { latitude: 30.3143365, longitude: 78.0335573, label: "Dehradun" },
        destination: { latitude: 28.6419258, longitude: 77.2217499, label: "New Delhi" },
        departureAt: "2026-09-18T00:00:00+05:30",
        options: {
            sourceRailRadiusKm: 200,
            sourceAirportRadiusKm: 300,
            destinationRailRadiusKm: 50,
            destinationAirportRadiusKm: 100,
            candidatesPerMode: 5,
            resultLimit: 5
        }
    });

    assert.equal(
        result.request.departureAt,
        "2026-09-18T00:00:00+05:30"
    );
    assert.ok(result.journeyResults.every(journey =>
        Date.parse(journey.departureAt)
            >= Date.parse(result.request.departureAt)
    ));
    const flightResults = result.journeyResults.filter(r => r.modes.includes("FLIGHT"));
    assert.ok(result.journeyResults.length <= 5);
    assert.ok(
        flightResults.length > 0,
        `Expected at least one FLIGHT-inclusive result; got modes: ${result.journeyResults.map(r => r.journeyType).join(", ")}`
    );

    assert.equal(result.journeyResults[0].rank, 1);
    assert.ok(
        result.journeyResults[0].modes.includes("FLIGHT"),
        `Expected the fastest-ranked (rank 1) result to include FLIGHT; got ${result.journeyResults[0].journeyType}`
    );

    const bestFlightRank = Math.min(...flightResults.map(r => r.rank));
    const railOnlyRanks = result.journeyResults
        .filter(r => r.journeyType === "RAIL_ONLY")
        .map(r => r.rank);
    const bestRailOnlyRank = railOnlyRanks.length > 0 ? Math.min(...railOnlyRanks) : Infinity;
    assert.ok(
        bestFlightRank < bestRailOnlyRank,
        `Expected the direct flight to outrank rail-only options (flight rank ${bestFlightRank}, best rail rank ${bestRailOnlyRank})`
    );

    for (let index = 1; index < result.journeyResults.length; index += 1) {
        assert.ok(
            compareMultimodalJourneyResults(
                result.journeyResults[index - 1],
                result.journeyResults[index]
            ) <= 0,
            "journeyResults must be sorted by ascending practicality score"
        );
    }
});

test("RAIL_ONLY returns departures after the requested time with server pagination", async () => {
    const requestedDeparture = "2026-08-04T07:44:00+05:30";
    const response = await fetch(`${baseUrl}/api/v1/journeys/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            origin: {
                latitude: 30.34382480994622,
                longitude: 78.04758895044175
            },
            destination: {
                latitude: 22.719568,
                longitude: 75.857727
            },
            departureAt: requestedDeparture,
            options: {
                journeyTypes: ["RAIL_ONLY"],
                sortBy: "transfers",
                resultOffset: 0,
                pageSize: 2,
                resultLimit: 5
            }
        })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.ok(body.data.journeyResults.length <= 2);
    assert.ok(body.data.journeyResults.length > 0);
    assert.ok(body.data.journeyResults.every(journey => {
        const firstTrain = journey.legs.find(leg => leg.mode === "RAIL");
        return firstTrain
            && Date.parse(firstTrain.departureAt)
                >= Date.parse(requestedDeparture);
    }));
    assert.ok(body.data.journeyResults.some(journey =>
        journey.legs.some(leg =>
            leg.mode === "RAIL" && leg.serviceNumber === "14310"
        )
    ));
});

test("RAIL_ONLY Haridwar to Kota boards trains at Haridwar and ranks later weekly trains last", async () => {
    const response = await fetch(`${baseUrl}/api/v1/journeys/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            origin: { latitude: 29.9456906, longitude: 78.1642478 },
            destination: { latitude: 25.2138156, longitude: 75.8647527 },
            departureAt: "2026-11-05T15:15:00+05:30",
            options: {
                journeyTypes: ["RAIL_ONLY"],
                sortBy: "transfers",
                resultOffset: 0,
                pageSize: 20
            }
        })
    });
    const body = await response.json();
    assert.equal(response.status, 200);

    const results = body.data.journeyResults;
    const firstRail = journey => journey.legs.find(leg => leg.mode === "RAIL");
    // 12402 and 19020 both stop at Haridwar; they must not be offered only
    // from Roorkee/Jwalapur, which are farther down the line.
    for (const trainNumber of ["12402", "19020"]) {
        assert.ok(
            results.some(journey =>
                firstRail(journey)?.serviceNumber === trainNumber
                && firstRail(journey).from.code === "HW"
            ),
            `Expected ${trainNumber} boarding at HW.`
        );
    }
    const direct = results.filter(journey => journey.numberOfTransfers === 0);
    for (let index = 1; index < direct.length; index += 1) {
        assert.ok(
            Date.parse(direct[index - 1].finalArrivalAt)
                <= Date.parse(direct[index].finalArrivalAt)
        );
    }
});

test("RAIL_ONLY recommended Dehradun to Chennai starts on the requested day with the full boarding buffer", async t => {
    const response = await fetch(`${baseUrl}/api/v1/journeys/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            origin: { latitude: 30.3143365, longitude: 78.0335573 },
            destination: { latitude: 13.0865965, longitude: 80.2745107 },
            departureAt: "2026-10-28T16:30:00+05:30",
            options: {
                journeyTypes: ["RAIL_ONLY"],
                sortBy: "recommended",
                resultOffset: 0,
                pageSize: 20
            }
        })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    const results = body.data.journeyResults;
    if (results.length === 0) {
        t.skip("No Dehradun -> Chennai railway journeys in this database.");
        return;
    }
    // Every journey keeps the full policy boarding buffer: one that could
    // only be caught with a shorter wait is not offered at all.
    const bufferMinutes = body.data.policy.initialRailBufferMinutes;
    for (const journey of results) {
        const access = journey.legs[0];
        const firstTrain = journey.legs.find(leg => leg.mode === "RAIL");
        assert.equal(access.mode, "LOCAL");
        assert.ok(
            Date.parse(firstTrain.departureAt) - Date.parse(access.arrivalAt)
                >= bufferMinutes * 60_000,
            `${firstTrain.serviceNumber} from ${firstTrain.from.code} leaves less than ${bufferMinutes} min to board.`
        );
    }
    const penaltyMs = body.data.policy.transferPenaltyMinutes * 60_000;
    const score = journey => Date.parse(journey.finalArrivalAt)
        + journey.numberOfTransfers * penaltyMs;
    for (let index = 1; index < results.length; index += 1) {
        assert.ok(score(results[index - 1]) <= score(results[index]));
    }
    // The Mon/Fri direct service (first one on 30 Oct) must not outrank
    // connections that leave on 28 Oct and arrive more than a day earlier.
    assert.ok(Date.parse(results[0].departureAt)
        < Date.parse("2026-10-29T00:00:00+05:30"));
    const firstDirect = results.findIndex(
        journey => journey.numberOfTransfers === 0
    );
    if (firstDirect !== -1) {
        assert.ok(firstDirect > 0);
        assert.ok(Date.parse(results[0].finalArrivalAt)
            < Date.parse(results[firstDirect].finalArrivalAt));
    }
});

test("station-airport links are directional and use positive road estimates", async t => {
    const link = await prisma.hubTransferLink.findFirst({
        include: { fromHub: true, toHub: true }
    });
    if (!link) {
        t.skip("Hub transfers have not been generated in this database.");
        return;
    }
    assert.notEqual(link.fromHub.hubType, link.toHub.hubType);
    assert.ok(link.travelMinutes > 0);
    assert.ok(Number(link.estimatedRoadDistanceKm) >= Number(link.aerialDistanceKm));
});

test("transfer-link loading is capped per active source hub", async t => {
    const links = await loadTransferLinks(3);
    if (links.length === 0) {
        t.skip("Hub transfers have not been generated in this database.");
        return;
    }
    const countsBySourceHub = new Map();
    for (const link of links) {
        const hubId = link.fromHubId.toString();
        countsBySourceHub.set(
            hubId,
            (countsBySourceHub.get(hubId) ?? 0) + 1
        );
    }
    assert.ok([...countsBySourceHub.values()].every(count => count <= 3));
});
