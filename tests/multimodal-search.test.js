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
    loadRoutingHubs
} = require("../dist/repositories/multimodal-routing.repository");
const {
    compareMultimodalJourneyResults,
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
        departureAt: "2026-09-07"
    });
    assert.equal(result.options.sourceRailRadiusKm, 200);
    assert.equal(result.options.sourceAirportRadiusKm, 300);
    assert.equal(result.options.maximumTransfers, undefined);
    assert.equal(result.options.resultLimit, 50);
    assert.equal(result.departureAt, "2026-09-07");
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

test("multimodal search rejects an invalid calendar date", () => {
    assert.throws(() => parseMultimodalSearch({
        origin: { latitude: 30.3165, longitude: 78.0322 },
        destination: { latitude: 23.0225, longitude: 72.5714 },
        departureAt: "2026-02-30"
    }));
});

test("multimodal search requires a date-only departureAt", () => {
    assert.throws(() => parseMultimodalSearch({
        origin: { latitude: 30.3165, longitude: 78.0322 },
        destination: { latitude: 23.0225, longitude: 72.5714 },
        departureAt: "2026-09-07T05:00:00+05:30"
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

test("loadFlightInstances only returns scheduled-service airlines", async t => {
    const start = new Date("2026-09-18T00:00:00.000+05:30");
    const end = new Date("2026-09-21T00:00:00.000+05:30");
    const nonScheduledCount = await prisma.aviationAirline.count({
        where: { serviceType: { not: "scheduled" } }
    });
    if (nonScheduledCount === 0) {
        t.skip("No non-scheduled airlines are present in this database.");
        return;
    }
    const flights = await loadFlightInstances(start, end);
    if (flights.length === 0) {
        t.skip("No flight instances are present in this database for the window.");
        return;
    }
    assert.ok(flights.every(flight => flight.airline !== null));
    assert.ok(flights.every(flight => flight.airline.serviceType === "scheduled"));
});

test("imported flight instances are domestic operating services", async t => {
    const count = await prisma.aviationFlightInstance.count();
    if (count === 0) {
        t.skip("Aviation Edge schedules have not been imported in this database.");
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
        departureAt: "2026-09-18",
        options: {
            sourceRailRadiusKm: 200,
            sourceAirportRadiusKm: 300,
            destinationRailRadiusKm: 50,
            destinationAirportRadiusKm: 100,
            candidatesPerMode: 5,
            resultLimit: 30
        }
    });

    const flightResults = result.journeyResults.filter(r => r.modes.includes("FLIGHT"));
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
