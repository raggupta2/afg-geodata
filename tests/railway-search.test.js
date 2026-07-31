require("dotenv/config");

const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const app = require("../dist/app").default;
const { prisma } = require("../dist/config/database");
const {
    calculateStationAccess,
    AVERAGE_ROAD_SPEED_KPH,
    ROAD_DISTANCE_DETOUR_FACTOR
} = require("../dist/services/station-access.service");
const {
    parseJourneySearch
} = require("../dist/validators/journey-search.validator");

let server;
let baseUrl;

const requestBody = {
    origin: {
        latitude: 30.3165,
        longitude: 78.0322,
        label: "Dehradun"
    },
    destination: {
        latitude: 19.076,
        longitude: 72.8777,
        label: "Mumbai"
    },
    departureAt: "2026-07-31T08:00:00+05:30",
    options: {
        sourceRadiusKm: 120,
        destinationRadiusKm: 50,
        sourceCandidateLimit: 8,
        destinationCandidateLimit: 4,
        boardingStationLimit: 4,
        routesPerBoardingStation: 2,
        resultLimit: 8
    }
};

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

test("journey search applies coordinate-search defaults", () => {
    const result = parseJourneySearch({
        origin: requestBody.origin,
        destination: requestBody.destination,
        departureAt: requestBody.departureAt
    });
    assert.equal(result.options.sourceCandidateLimit, 6);
    assert.equal(result.options.destinationCandidateLimit, 4);
    assert.equal(result.options.boardingStationLimit, 5);
});

test("journey search accepts a date without inventing a departure time", () => {
    const result = parseJourneySearch({
        origin: requestBody.origin,
        destination: requestBody.destination,
        departureDate: "2026-08-04"
    });
    assert.equal(result.departureDate, "2026-08-04");
    assert.equal(result.departureAt, undefined);
});

test("station access keeps aerial and estimated road distance separate", () => {
    const access = calculateStationAccess(100);
    assert.equal(access.aerialDistanceKm, 100);
    assert.equal(
        access.estimatedRoadDistanceKm,
        100 * ROAD_DISTANCE_DETOUR_FACTOR
    );
    assert.equal(
        access.travelMinutes,
        Math.ceil(
            access.estimatedRoadDistanceKm
            / AVERAGE_ROAD_SPEED_KPH
            * 60
        )
    );
});

test("old railway search endpoints are removed", async () => {
    const [legacy, previousJourney] = await Promise.all([
        fetch(`${baseUrl}/api/v1/railways/routes`),
        fetch(`${baseUrl}/api/routes?departure=DDN&arrival=CSMT`)
    ]);
    assert.equal(legacy.status, 404);
    assert.equal(previousJourney.status, 404);
});

test("station autocomplete returns station coordinates for codes and names", async () => {
    const [originResponse, destinationResponse] = await Promise.all([
        fetch(`${baseUrl}/api/v1/railways/stations?q=dd&limit=10`),
        fetch(`${baseUrl}/api/v1/railways/stations?q=dw&limit=10`)
    ]);
    const [originBody, destinationBody] = await Promise.all([
        originResponse.json(),
        destinationResponse.json()
    ]);
    assert.equal(originResponse.status, 200);
    assert.equal(destinationResponse.status, 200);
    const ddn = originBody.data.features.find(
        feature => feature.properties.station_code === "DDN"
    );
    const dwx = destinationBody.data.features.find(
        feature => feature.properties.station_code === "DWX"
    );
    assert.ok(ddn);
    assert.ok(dwx);
    assert.equal(ddn.geometry.coordinates.length, 2);
    assert.equal(dwx.geometry.coordinates.length, 2);
});

test("coordinate search returns ranked nearby-station journeys", async () => {
    const response = await fetch(`${baseUrl}/api/v1/railways/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.ok(body.count > 0);
    assert.ok(body.data.boardingStations.length >= 2);
    assert.ok(body.data.boardingStations.length <= 4);
    assert.equal(body.data.assumptions.aerialDistanceMethod, "POSTGIS_GEODESIC");
    assert.equal(body.data.request.timeZone, "Asia/Kolkata");

    const first = body.data.trainResults[0];
    assert.equal(first.rank, 1);
    assert.ok(first.sourceAccess.aerialDistanceKm >= 0);
    assert.ok(first.availableDestinationStations.length > 0);
    assert.ok(first.totalJourneyMinutes >= first.railwayElapsedMinutes);
    assert.match(first.firstTrainDepartureAt, /\+05:30$/);
    assert.ok(first.legs.some(leg => leg.mode === "LOCAL"));
    assert.ok(first.legs.some(leg => leg.mode === "RAIL"));
    assert.ok(first.trains.every(train =>
        train.distanceKm === null || Number.isFinite(train.distanceKm)
    ));
    const availableTrainDistances = first.trains
        .map(train => train.distanceKm)
        .filter(Number.isFinite);
    const expectedTotalTrainDistance = availableTrainDistances.length === 0
        ? null
        : Math.round(
            availableTrainDistances.reduce(
                (total, distance) => total + distance,
                0
            ) * 10
        ) / 10;
    assert.equal(
        first.totalTrainDistanceKm,
        expectedTotalTrainDistance
    );
    assert.equal(
        new Set(body.data.trainResults.map(option => option.itineraryKey)).size,
        body.data.trainResults.length
    );
    const firstTransferIndex = body.data.trainResults.findIndex(
        option => option.journeyType === "TRANSFER"
    );
    assert.ok(
        firstTransferIndex === -1
        || body.data.trainResults
            .slice(0, firstTransferIndex)
            .every(option => option.journeyType === "DIRECT")
    );
});

test("date-only search includes the direct HW to LMNR train", async () => {
    const response = await fetch(`${baseUrl}/api/v1/railways/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            origin: {
                latitude: 30.34382480994622,
                longitude: 78.04758895044175
            },
            destination: {
                latitude: 22.719568,
                longitude: 75.857727
            },
            departureDate: "2026-08-04",
            options: {
                sourceRadiusKm: 120,
                destinationRadiusKm: 50,
                sourceCandidateLimit: 6,
                destinationCandidateLimit: 4,
                boardingStationLimit: 6,
                routesPerBoardingStation: 5,
                resultLimit: 30
            }
        })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.request.searchMode, "DATE_ONLY");
    assert.equal(body.data.request.departureAt, null);

    const direct = body.data.trainResults.find(option =>
        option.itineraryKey === "DIRECT|14310@2026-08-04"
    );
    assert.ok(direct, "Expected one grouped 14310 direct-train result.");
    assert.equal(direct.journeyType, "DIRECT");
    assert.equal(direct.numberOfTransfers, 0);
    assert.ok(
        direct.availableDestinationStations.some(
            destination => destination.station.code === "LMNR"
        )
    );
    const haridwarBoarding = direct.recommendedBoardingStation.code === "HW"
        ? { trainDepartureAt: direct.firstTrainDepartureAt }
        : direct.alternativeBoardingStations.find(
            alternative => alternative.station.code === "HW"
        );
    assert.ok(haridwarBoarding);
    assert.match(
        haridwarBoarding.trainDepartureAt,
        /^2026-08-04T07:45:00\+05:30$/
    );
    assert.ok(
        Date.parse(direct.legs[0].departureAt)
        < Date.parse(direct.firstTrainDepartureAt)
    );
});

test("identical concurrent cache misses share in-flight routing work", async () => {
    const uncachedRequest = {
        ...requestBody,
        departureAt: "2026-07-31T08:03:00+05:30"
    };
    const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
            fetch(`${baseUrl}/api/v1/railways/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(uncachedRequest)
            })
        )
    );
    assert.ok(responses.every(response => response.status === 200));
    const bodies = await Promise.all(responses.map(response => response.json()));
    assert.ok(bodies.every(body => body.data.trainResults[0].id ===
        bodies[0].data.trainResults[0].id));
});
