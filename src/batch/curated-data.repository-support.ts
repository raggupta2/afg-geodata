import {
    findCuratedUsersWithinRadius,
    findNearestCuratedUsers,
    upsertCuratedData
} from "../repositories/curated-data.repository";

export const curatedDataRepository = {
    upsert: upsertCuratedData,
    findWithinRadius: findCuratedUsersWithinRadius,
    findNearest: findNearestCuratedUsers
};
